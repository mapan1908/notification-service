// src/strategies/WecomBotStrategy.ts
import { request } from 'undici';
import { NotificationPayload, SendResult } from '../types/strategies.types'; // 或者 '../types/strategies.types'
import LoggerService from '../services/LoggerService'; //
import { OrderInfo, NotificationEventType, NotificationStatus, OrderType } from '../types'; //
import { INotificationStrategy } from './NotificationStrategy';
import { defaultHttpAgent } from '../utils/httpClient';
import { config } from '../config/config';

interface WecomBotChannelConfig {
  webhook_url: string;
  mention_list?: string[]; // 例如 ["userid1", "@all"]
  mention_mobile_list?: string[]; // 例如 ["13800001111", "@all"]
}

export class WecomBotStrategy implements INotificationStrategy {
  async send(payload: NotificationPayload): Promise<SendResult> {
    const { orderInfo, event, channelConfig } = payload;

    // 1. 从 channelConfig.channel_config 中提取企微机器人配置
    // channelConfig.channel_config 是 Record<string, any> 类型
    // 我们需要安全地转换为我们期望的 WecomBotChannelConfig
    const botConfig = channelConfig.channel_config as WecomBotChannelConfig;

    if (!botConfig || !botConfig.webhook_url || typeof botConfig.webhook_url !== 'string') {
      LoggerService.error('[WecomBotStrategy] Webhook URL is missing or invalid in channel_config.', {
        channelId: channelConfig.id,
        storeCode: channelConfig.store_code,
      });
      return {
        success: false,
        error: 'Webhook URL is missing or invalid.',
        status: NotificationStatus.FAILED,
      };
    }

    // 2. 根据订单信息和事件类型构造消息内容
    // 这里我们简单地构造一个 Markdown 格式的消息
    const messageContent = this.formatMessage(orderInfo, event);

    // 3. 构造发送给企微机器人的请求体
    // 参考企微机器人文档: https://developer.work.weixin.qq.com/document/path/91770
    const requestBody: any = {
      msgtype: 'markdown',
      markdown: {
        content: messageContent,
      },
    };

    if (botConfig.mention_list && botConfig.mention_list.length > 0) {
      // Markdown 消息中 @成员，需要在 content 中包含 <@userid>
      // 这里简单处理，实际可能需要更复杂的逻辑来嵌入到 markdown content 中
      // requestBody.markdown.mentioned_list = botConfig.mention_list; // Markdown类型不支持这个字段，需要在content里实现
    }
    if (botConfig.mention_mobile_list && botConfig.mention_mobile_list.length > 0) {
      // requestBody.markdown.mentioned_mobile_list = botConfig.mention_mobile_list; // Markdown类型不支持这个字段
    }

    // 4. 发送 HTTP POST 请求到 Webhook URL
    LoggerService.debug('[WecomBotStrategy] Sending message to WeCom Bot.', {
      webhook: botConfig.webhook_url,
      requestBody,
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.DEFAULT_HTTP_TIMEOUT_MS);
    try {
      const { statusCode, body } = await request(botConfig.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        dispatcher: defaultHttpAgent,
        signal: controller.signal,
      });

      const responseText = await body.text();
      const responseData = responseText ? JSON.parse(responseText) : {}; // 尝试解析JSON

      if (statusCode === 200 && responseData.errcode === 0) {
        LoggerService.info('[WecomBotStrategy] Message sent successfully to WeCom Bot.', {
          webhook: botConfig.webhook_url,
          response: responseData,
        });
        return {
          success: true,
          messageId: responseData.msgid, // 企微机器人不直接返回 msgid 在这个响应体中，但可以记录响应
          responseData: responseData,
          status: NotificationStatus.SUCCESS,
        };
      } else {
        LoggerService.error('[WecomBotStrategy] Failed to send message to WeCom Bot.', {
          webhook: botConfig.webhook_url,
          statusCode,
          response: responseData,
          requestBodySent: requestBody, // 记录发送的内容以供调试
        });
        return {
          success: false,
          error: `WeCom Bot API Error: ${responseData.errmsg || 'Unknown error'} (Code: ${responseData.errcode || statusCode})`,
          responseData: responseData,
          status: NotificationStatus.FAILED,
        };
      }
    } catch (error: any) {
      LoggerService.error('[WecomBotStrategy] Exception while sending message to WeCom Bot:', {
        webhook: botConfig.webhook_url,
        error: error.message,
        stack: error.stack,
        requestBodySent: requestBody,
      });
      return {
        success: false,
        error: error.message || 'Exception occurred',
        status: NotificationStatus.FAILED,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 根据订单信息和事件类型格式化消息内容。
   * @param orderInfo - 订单信息
   * @param event - 事件类型
   * @returns 格式化后的 Markdown 字符串
   */
  private formatMessage(orderInfo: OrderInfo, event: NotificationEventType): string {
    // 这里可以根据不同的事件类型生成不同的消息内容
    // 以下是一个简单的示例
    let title = '📢 新消息提醒';
    switch (event) {
      case NotificationEventType.ORDER_CREATED:
        title = '🎉 新订单来啦！';
        break;
      case NotificationEventType.ORDER_PAID:
        title = '💰 订单已支付';
        break;
      // ...可以为其他事件类型添加 case
      default:
        title = `🔔 ${event.replace(/_/g, ' ')} 事件提醒`;
    }

    // 构造 Markdown 格式的消息体
    // 注意：企微 Markdown 语法与标准 Markdown 略有不同
    // 例如，颜色: <font color="info|comment|warning">文本</font>
    // 换行: 直接使用 \n
    let content = `**${title}**\n`;
    content += `> 订单号: <font color="comment">${orderInfo.order_number || orderInfo.order_id}</font>\n`;
    content += `> 订单类型: ${this.formatOrderType(orderInfo.order_type)}\n`;
    if (orderInfo.table_name) {
      content += `> 桌台号: ${orderInfo.table_name}\n`;
    }
    if (orderInfo.contact_name) {
      content += `> 顾客: ${orderInfo.contact_name}\n`;
    }
    content += `> 金额: <font color="warning">¥${orderInfo.payable_amount.toFixed(2)}</font>\n`;
    content += `> 下单时间: ${new Date(orderInfo.created_at).toLocaleString('zh-CN', { hour12: false })}\n\n`;
    content += `请及时处理。`;
    // 如果需要 @成员，需要在这里拼接类似 "<@userid1>" 的字符串
    // 例如: content += "\n<@zhangsan>";

    return content;
  }

  private formatOrderType(orderType: OrderType): string {
    switch (orderType) {
      case OrderType.DINE_IN:
        return '堂食'; //
      case OrderType.PICKUP:
        return '自提'; //
      case OrderType.DELIVERY:
        return '外卖'; //
      default:
        return orderType;
    }
  }
}
