// src/strategies/NotificationStrategy.ts
import { NotificationPayload, SendResult } from '../types/strategies.types'; // 或 '../types/strategies.types'

/**
 * 通知策略接口
 * 所有具体的通知渠道实现都需要实现此接口。
 */
export interface INotificationStrategy {
  /**
   * 发送通知。
   * @param payload - 包含发送通知所需全部信息的载荷对象。
   * @returns Promise<SendResult> - 包含发送结果的对象。
   */
  send(payload: NotificationPayload): Promise<SendResult>;
}
