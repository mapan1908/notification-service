// src/types/index.ts (或者新建 src/types/strategies.types.ts 并从这里导出)

import { OrderInfo, NotificationEventType, NotificationChannelConfig, NotificationStatus } from './index'; // 假设这些已存在
// 如果 WechatTemplateConfig 需要从 ConfigService 独立获取，也需要引入
// import { WechatTemplateConfig } from './index';

/**
 * 传递给具体通知策略的载荷数据
 */
export interface NotificationPayload {
  orderInfo: OrderInfo; // 订单详细信息
  event: NotificationEventType; // 当前触发通知的事件类型
  channelConfig: NotificationChannelConfig; // 该渠道的完整配置信息 (包含数据库中的 channel_config 字段)
  // channel_config.channel_config 通常是 Record<string, any>
  // 例如，对于企微机器人，它会包含 webhook_url
  // 对于微信公众号，它可能包含 app_id, open_id 等基础信息

  // 可选: 针对特定渠道的更具体的配置或模板信息。
  // 例如，微信公众号的模板消息，其 template_id 和 field_mapping 可能通过 ConfigService.getWechatTemplateConfig 获取
  // 并在这里传入，而不是直接从 channelConfig.channel_config 中解析。
  // 这取决于您希望 ConfigService 和策略如何协作。
  // 一种方式是 channelConfig.channel_config 包含所有必需信息，另一种是 payload 包含更结构化的信息。
  // 为简化起步，我们假设 channelConfig.channel_config 包含足够信息，或策略内部会按需查询。
  // 如果需要更结构化的，可以添加如下字段：
  // wechatTemplate?: { templateId: string; data: Record<string, any>; miniProgram?: object; url?: string };
  // wecomBotMessage?: { content: string; mentioned_list?: string[] };
  // cloudSpeakerContent?: string;
}

/**
 * 通知策略 send 方法的返回结果
 */
export interface SendResult {
  success: boolean; // 是否发送成功
  messageId?: string; // 由外部通知服务商返回的消息ID (如果适用)
  error?: string; // 如果发送失败，具体的错误信息
  responseData?: any; // 外部通知服务商返回的原始响应数据 (可选，用于调试)
  status?: NotificationStatus; // 可以直接返回一个建议的 NotificationStatus
}
