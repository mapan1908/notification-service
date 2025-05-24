// src/services/NotificationEngine.ts
import { StreamMessage, OrderInfo, NotificationChannelConfig , NotificationStatus, NotificationEventType, ChannelType } from '../types'; //
import { NotificationPayload } from '../types/strategies.types'; //
import OrderService from './OrderService';
import ConfigService from './ConfigService'; //
import NotificationLogService from './NotificationLogService';
import { getNotificationStrategy } from '../strategies/StrategyFactory';
import LoggerService from './LoggerService'; //

class NotificationEngine {
  /**
   * 处理从 Redis Stream 消费到的单个通知事件。
   * 这是通知引擎的主要入口点。
   * @param streamMessage - 从 Redis Stream 解析出的消息对象。
   * @param originalMessageId - Redis Stream 中的原始消息 ID，用于 ACK。
   */
  public static async processNotificationEvent(
    streamMessage: StreamMessage,
    originalMessageId: string // 用于最终ACK，虽然ACK本身在Consumer中
  ): Promise<void> {
    LoggerService.info(`[NotificationEngine] Processing event for orderId: ${streamMessage.orderId}, event: ${streamMessage.event}, messageId: ${originalMessageId}`);

    // 1. 获取订单信息
    const orderInfo: OrderInfo | null = await OrderService.getOrderInfo(
      streamMessage.orderId,
      streamMessage.storeCode,
      streamMessage.token // 传递 stream 中的 token
    );

    if (!orderInfo) {
      LoggerService.error(`[NotificationEngine] Failed to get order info for orderId: ${streamMessage.orderId}. Skipping notification processing.`);
      // 考虑: 是否需要记录一条特殊的“处理失败”的 NotificationLog？
      // 此时还没有 channel_type，但可以记录一个概要日志。
      // 例如：
      await NotificationLogService.logAttempt({
        order_id: streamMessage.orderId,
        store_code: streamMessage.storeCode, // 注意类型转换
        event_type: streamMessage.event,
        status: NotificationStatus.FAILED,
        error_message: 'Failed to retrieve order details.',
        // channel_type: 'N/A' or a special value
      });
      return; // 无法获取订单信息，则无法继续
    }

    // 2. 获取商家通知渠道配置
    // 注意: ConfigService.getStoreChannelConfigs 的 storeId 是 number，而 streamMessage.storeId 是 string
    const storeCode = streamMessage.storeCode;
    if (storeCode === '') {
        LoggerService.error(`[NotificationEngine] Invalid storeId format: ${streamMessage.storeCode} for orderId: ${streamMessage.orderId}`);
        return;
    }

    // getStoreChannelConfigs 可能需要根据 order_type 过滤，orderInfo 中有 order_type
    const channelConfigs: NotificationChannelConfig[] = await ConfigService.getStoreChannelConfigs(
      storeCode,
      orderInfo.order_type // 使用获取到的订单的 order_type
    ); //

    if (!channelConfigs || channelConfigs.length === 0) {
      LoggerService.info(`[NotificationEngine] No enabled notification channels found for storeCode: ${storeCode}, orderType: ${orderInfo.order_type}, event: ${streamMessage.event}. Skipping.`);
      // 记录一条 SKIPPED 状态的日志
      await NotificationLogService.logAttempt({
        order_id: streamMessage.orderId,
            store_code: streamMessage.storeCode,
        event_type: streamMessage.event,
        channel_type: ChannelType.NO_CONFIG, // 或一个特定的 'NO_CONFIG' 值
        status: NotificationStatus.SKIPPED, //
        error_message: 'No enabled notification channels configured for this store/order_type/event combination.',
      });
      return;
    }

    LoggerService.info(`[NotificationEngine] Found ${channelConfigs.length} channel(s) for storeCode: ${storeCode}, orderId: ${streamMessage.orderId}`);

    // 3. 遍历启用的渠道配置并发送通知
    for (const channelConfig of channelConfigs) {
      if (!channelConfig.enabled) { // 双重保险，虽然 getStoreChannelConfigs 应该只返回 enabled=true 的
        LoggerService.debug(`[NotificationEngine] Channel ${channelConfig.channel_type} for store ${storeCode} is disabled. Skipping.`);
        continue;
      }

      const strategy = getNotificationStrategy(channelConfig.channel_type);

      if (!strategy) {
        LoggerService.warn(`[NotificationEngine] No strategy found for channel type: ${channelConfig.channel_type}. Skipping channel for order ${streamMessage.orderId}.`);
        await NotificationLogService.logAttempt({
          order_id: streamMessage.orderId,
          store_code: streamMessage.storeCode,
          event_type: streamMessage.event,
          channel_type: channelConfig.channel_type,
          status: NotificationStatus.SKIPPED,
          error_message: `No notification strategy available for channel type ${channelConfig.channel_type}.`,
        });
        continue;
      }

      // 准备 NotificationPayload
      const notificationPayload: NotificationPayload = {
        orderInfo: orderInfo,
        event: streamMessage.event,
        channelConfig: channelConfig,
        // wechatTemplateConfig: undefined, // 特定于渠道的逻辑可以在策略内部或这里准备
      };

      // 特定于渠道的额外配置加载 (例如微信模板)
      // if (channelConfig.channel_type === ChannelType.WECHAT_MP) {
      //   const wechatTemplate = await ConfigService.getWechatTemplateConfig(storeIdNumber, streamMessage.event);
      //   if (!wechatTemplate) {
      //     LoggerService.warn(`[NotificationEngine] WeChat MP template not found for store ${storeIdNumber}, event ${streamMessage.event}. Skipping WeChat MP notification.`);
      //     await NotificationLogService.logAttempt({ /* ... log skipped ... */ });
      //     continue;
      //   }
      //   // 将模板信息整合到 payload 中，或由策略自行获取
      //   // (notificationPayload as any).wechatSpecificTemplate = wechatTemplate; // 示例
      // }


      // 发送通知并记录结果
      const startTime = Date.now();
      let sendResult;
      try {
        LoggerService.info(`[NotificationEngine] Attempting to send notification via ${channelConfig.channel_type} for order ${streamMessage.orderId}`);
        sendResult = await strategy.send(notificationPayload);
        
        await NotificationLogService.logAttempt({
          order_id: streamMessage.orderId,
          store_code: streamMessage.storeCode,
          event_type: streamMessage.event,
          channel_type: channelConfig.channel_type,
          status: sendResult.success ? NotificationStatus.SUCCESS : NotificationStatus.FAILED,
          request_data: notificationPayload, // 注意：payload可能很大，考虑只记录关键部分或脱敏
          response_data: sendResult.responseData,
          error_message: sendResult.error,
          duration_ms: Date.now() - startTime,
          // retry_count: 0, // 如果有重试机制，这里会变化
        });

        if(sendResult.success) {
            LoggerService.info(`[NotificationEngine] Notification sent successfully via ${channelConfig.channel_type} for order ${streamMessage.orderId}. MessageId: ${sendResult.messageId}`);
        } else {
            LoggerService.error(`[NotificationEngine] Failed to send notification via ${channelConfig.channel_type} for order ${streamMessage.orderId}. Error: ${sendResult.error}`);
        }

      } catch (error: any) {
        const durationMs = Date.now() - startTime;
        LoggerService.error(`[NotificationEngine] Unhandled exception during strategy.send via ${channelConfig.channel_type} for order ${streamMessage.orderId}:`, error);
        await NotificationLogService.logAttempt({
          order_id: streamMessage.orderId,
          store_code: streamMessage.storeCode,
          event_type: streamMessage.event,
          channel_type: channelConfig.channel_type,
          status: NotificationStatus.FAILED,
          request_data: notificationPayload, // 脱敏
          error_message: error.message || 'Unhandled exception in strategy',
          duration_ms: durationMs,
        });
      }
    }
    // 所有渠道尝试完毕
    LoggerService.info(`[NotificationEngine] Finished processing all channels for orderId: ${streamMessage.orderId}, event: ${streamMessage.event}`);
  }
}

export default NotificationEngine;