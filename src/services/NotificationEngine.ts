// src/services/NotificationEngine.ts
import {
  StreamMessage,
  OrderInfo,
  NotificationChannelConfig,
  NotificationStatus,
  NotificationEventType,
  ChannelType,
} from '../types'; // 确保 StreamMessage 和其他类型已更新以反映 storeCode (如果适用)
import { NotificationPayload } from '../types/strategies.types';
import OrderService from './OrderService';
import { CriticalOrderInfoError } from '../types';
import ConfigService from './ConfigService';
import NotificationLogService from './NotificationLogService';
import { getNotificationStrategy } from '../strategies/StrategyFactory';
import LoggerService from './LoggerService';

const CONFIG_ISSUE_CHANNEL_MARKER = ChannelType.NO_CONFIG; // 用于配置或数据问题时的日志标记

class NotificationEngine {
  public static async processNotificationEvent(
    streamMessage: StreamMessage,
    originalMessageId: string
  ): Promise<void> {
    const storeCodeFromStream = streamMessage.storeCode; // 假设这是您全局使用的字符串店铺标识

    const logPrefix = `[NotificationEngine order:${streamMessage.orderId} event:${streamMessage.event} msgId:${originalMessageId} storeCode:${storeCodeFromStream}]`;
    LoggerService.info(`${logPrefix} Received event.`);

    let orderInfo: OrderInfo; // OrderService.getOrderInfo 成功时必有值

    // 校验 storeCodeFromStream (如果需要)
    if (
      !storeCodeFromStream ||
      typeof storeCodeFromStream !== 'string' ||
      storeCodeFromStream.trim() === ''
    ) {
      LoggerService.error(
        `${logPrefix} 无效或空的 storeCode from stream: '${storeCodeFromStream}'`
      );
      await NotificationLogService.logAttempt({
        order_id: streamMessage.orderId,
        // store_id: undefined, // 或 store_code: storeCodeFromStream 如果 NotificationLog 已更新
        event_type: streamMessage.event,
        channel_type: CONFIG_ISSUE_CHANNEL_MARKER,
        status: NotificationStatus.FAILED,
        error_message: `无效或空的 storeCode in stream message: '${storeCodeFromStream}'`,
      });
      // 这种基础解析错误，应 ACK 掉，让 Consumer ACK。
      return;
    }

    // 1. 获取订单信息
    try {
      // OrderService.getOrderInfo 的第二个参数是 store_code (string)
      orderInfo = await OrderService.getOrderInfo(
        streamMessage.orderId,
        storeCodeFromStream, // 传递字符串 storeCode
        streamMessage.token,
        streamMessage.timestamp
      );
      // OrderService.getOrderInfo 失败时会抛出 CriticalOrderInfoError
    } catch (error: any) {
      LoggerService.error(
        `${logPrefix} 获取订单信息失败. Error: ${error.message}`
      );

      let attemptsMade = 0;
      if (error instanceof CriticalOrderInfoError) {
        attemptsMade = error.attemptsMade;
      }

      // 记录日志: 使用 store_code (string) 还是 store_id (number)?
      // 假设 NotificationLog 类型已更新为接受 store_code: string
      // 或者 NotificationLogService 内部处理转换
      await NotificationLogService.logAttempt({
        order_id: streamMessage.orderId,
        store_code: storeCodeFromStream, // 使用 store_code
        event_type: streamMessage.event,
        channel_type: CONFIG_ISSUE_CHANNEL_MARKER,
        status: NotificationStatus.FAILED,
        error_message: `Critical: 获取订单信息失败. ${error.message}`,
        retry_count: attemptsMade,
      });

      if (error instanceof CriticalOrderInfoError) {
        throw error;
      } else {
        // 对于 OrderService 抛出的其他未知错误，也视为关键失败
        throw new CriticalOrderInfoError(
          `未处理的错误, OrderService: ${error.message}`,
          attemptsMade, // 或 0
          error
        );
      }
    }

    // 2. 获取渠道配置
    const channelConfigs: NotificationChannelConfig[] =
      await ConfigService.getStoreChannelConfigs(
        storeCodeFromStream, // 传递字符串 storeCode
        orderInfo.order_type
      );

    if (!channelConfigs || channelConfigs.length === 0) {
      LoggerService.info(
        `${logPrefix} No enabled notification channels found for storeCode: ${storeCodeFromStream}, orderType: ${orderInfo.order_type}, event: ${streamMessage.event}. Skipping.`
      );
      await NotificationLogService.logAttempt({
        order_id: streamMessage.orderId,
        store_code: storeCodeFromStream, // 使用 store_code
        event_type: streamMessage.event,
        channel_type: CONFIG_ISSUE_CHANNEL_MARKER,
        status: NotificationStatus.SKIPPED,
        error_message: '没有启用的通知渠道配置, 店铺/订单类型/事件组合.',
      });
      return;
    }

    LoggerService.info(
      `${logPrefix} Found ${channelConfigs.length} channel(s) for storeCode: ${storeCodeFromStream}.`
    );

    // 3. 遍历启用的渠道配置并发送通知
    for (const channelConfig of channelConfigs) {
      // channelConfig.store_id 仍然是 number 类型 (来自 NotificationChannelConfig 定义)
      // 如果需要与 storeCodeFromStream 比较或使用，注意类型。
      // 但这里主要用 channelConfig.channel_type 和 channelConfig.enabled

      if (!channelConfig.enabled) {
        LoggerService.debug(
          `${logPrefix} Channel ${channelConfig.channel_type} for store_code ${channelConfig.store_code} (code: ${storeCodeFromStream}) is internally marked disabled. Skipping.`
        );
        continue;
      }

      const strategy = getNotificationStrategy(channelConfig.channel_type);

      if (!strategy) {
        LoggerService.warn(
          `${logPrefix} No strategy found for channel type: ${channelConfig.channel_type}. Skipping channel.`
        );
        await NotificationLogService.logAttempt({
          order_id: streamMessage.orderId,
          store_code: storeCodeFromStream, // 使用 store_code
          event_type: streamMessage.event,
          channel_type: channelConfig.channel_type,
          status: NotificationStatus.SKIPPED,
          error_message: `没有找到通知策略, channel type: ${channelConfig.channel_type}.`,
        });
        continue;
      }

      const notificationPayload: NotificationPayload = {
        orderInfo: orderInfo, // orderInfo.store_id 是 number
        event: streamMessage.event,
        channelConfig: channelConfig, // channelConfig.store_id 是 number
      };

      const startTime = Date.now();
      let sendResult;
      try {
        LoggerService.info(
          `${logPrefix} 尝试发送通知, channel type: ${channelConfig.channel_type}.`
        );
        sendResult = await strategy.send(notificationPayload);

        await NotificationLogService.logAttempt({
          order_id: streamMessage.orderId,
          store_code: storeCodeFromStream, // 使用 store_code

          event_type: streamMessage.event,
          channel_type: channelConfig.channel_type,
          status: sendResult.success
            ? NotificationStatus.SUCCESS
            : NotificationStatus.FAILED,
          request_data: {
            orderId: streamMessage.orderId,
            event: streamMessage.event,
          }, // 示例：精简记录
          response_data: sendResult.responseData,
          error_message: sendResult.error,
          duration_ms: Date.now() - startTime,
          retry_count: 0,
        });

        if (sendResult.success) {
          LoggerService.info(
            `${logPrefix} 通知发送成功, channel type: ${channelConfig.channel_type}. MessageId: ${sendResult.messageId || 'N/A'}`
          );
        } else {
          LoggerService.error(
            `${logPrefix} 通知发送失败, channel type: ${channelConfig.channel_type}. Error: ${sendResult.error}`
          );
        }
      } catch (error: any) {
        const durationMs = Date.now() - startTime;
        LoggerService.error(
          `${logPrefix} 未处理的异常, channel type: ${channelConfig.channel_type}:`,
          error
        );
        await NotificationLogService.logAttempt({
          order_id: streamMessage.orderId,
          store_code: storeCodeFromStream, // 使用 store_code
          event_type: streamMessage.event,
          channel_type: channelConfig.channel_type,
          status: NotificationStatus.FAILED,
          request_data: {
            orderId: streamMessage.orderId,
            event: streamMessage.event,
          },
          error_message: error.message || '未处理的异常, 策略',
          duration_ms: durationMs,
        });
      }
    }
    LoggerService.info(`${logPrefix} 处理所有渠道完成.`);
  }
}

export default NotificationEngine;
