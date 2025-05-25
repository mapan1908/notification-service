// src/services/NotificationLogService.ts
import DatabaseService from './DatabaseService'; //
import LoggerService from './LoggerService'; //
import { NotificationLog, NotificationStatus, NotificationEventType, ChannelType } from '../types'; //

class NotificationLogService {
  /**
   * 记录一次通知尝试的日志。
   * @param logEntry - 包含通知日志详细信息的对象，部分字段可选。
   */
  public static async logAttempt(logEntry: Partial<NotificationLog>): Promise<number | null> {
    const now = new Date();
    const entryToInsert: Omit<NotificationLog, 'id' | 'created_at' | 'updated_at'> & { created_at: Date; updated_at: Date } = {
      order_id: logEntry.order_id || 'N/A',
      store_code: logEntry.store_code || '', // 提供一个默认值或确保调用时提供
      event_type: logEntry.event_type || NotificationEventType.ORDER_CREATED, // 示例默认值，实际应准确传入
      channel_type: logEntry.channel_type || ChannelType.WECHAT_MP, // 示例默认值，实际应准确传入
      status: logEntry.status || NotificationStatus.PENDING,
      request_data: logEntry.request_data || undefined,
      response_data: logEntry.response_data || undefined,
      error_message: logEntry.error_message || undefined,
      duration_ms: logEntry.duration_ms || undefined,
      retry_count: logEntry.retry_count || 0,
      created_at: logEntry.created_at || now, // 允许传入，否则使用当前时间
      updated_at: logEntry.updated_at || now, // 允许传入，否则使用当前时间
    };

    // 确保必填字段有值
    if (!entryToInsert.order_id || !entryToInsert.store_code || !entryToInsert.event_type || !entryToInsert.channel_type || !entryToInsert.status) {
      LoggerService.error('[NotificationLogService] Missing required fields for logging notification attempt.', entryToInsert);
      return null;
    }
    // TOFIX: 需要修改为使用store_code
    const query = `
      INSERT INTO notification_logs 
      (order_id, store_code, event_type, channel_type, status, request_data, response_data, error_message, duration_ms, retry_count, created_at, updated_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
      // 统一将 undefined 转为 null，防止 SQL 报错
      const params = [
        entryToInsert.order_id,
        entryToInsert.store_code,
        entryToInsert.event_type,
        entryToInsert.channel_type,
        entryToInsert.status,
        entryToInsert.request_data ? JSON.stringify(entryToInsert.request_data) : null,
        entryToInsert.response_data ? JSON.stringify(entryToInsert.response_data) : null,
        entryToInsert.error_message,
        entryToInsert.duration_ms ? JSON.stringify(entryToInsert.duration_ms) : null,
        entryToInsert.retry_count,
        entryToInsert.created_at,
        entryToInsert.updated_at,
      ].map((v) => (v === undefined ? null : v));

      const result = await DatabaseService.execute(query, params);

      // DatabaseService.execute 返回的是 [rows, fields] 或 ResultSetHeader
      // 对于 INSERT，我们需要从 ResultSetHeader 中获取 insertId
      const insertId = (result as any).insertId;
      if (insertId) {
        LoggerService.debug(`[NotificationLogService] Notification attempt logged with ID: ${insertId}`, entryToInsert);
        return insertId;
      } else {
        LoggerService.warn('[NotificationLogService] Notification log insertId not found.', { result, entryToInsert });
        return null;
      }
    } catch (error) {
      LoggerService.error('[NotificationLogService] Failed to log notification attempt to database:', {
        error,
        logEntry: entryToInsert,
      });
      return null;
    }
  }

  // 未来可以添加其他方法，例如:
  // public static async updateLogStatus(id: number, status: NotificationStatus, errorMessage?: string): Promise<boolean> { ... }
  // public static async getLogsForOrder(orderId: string): Promise<NotificationLog[]> { ... }
}

export default NotificationLogService;
