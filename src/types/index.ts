// 通知渠道类型
export enum ChannelType {
  WECHAT_MP = 'wechat_mp',
  WECOM_BOT = 'wecom_bot',
  CLOUD_SPEAKER = 'cloud_speaker',
  NO_CONFIG = 'no_config',
}

// 通知事件类型
export enum NotificationEventType {
  ORDER_CREATED = 'order_created',
  ORDER_PAID = 'order_paid',
  ORDER_CONFIRMED = 'order_confirmed',
  ORDER_PREPARING = 'order_preparing',
  ORDER_READY_FOR_PICKUP = 'order_ready_for_pickup',
  ORDER_DELIVERING = 'order_delivering',
  ORDER_COMPLETED = 'order_completed',
  ORDER_CANCELLED = 'order_cancelled',
}

// 通知状态
export enum NotificationStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  RETRYING = 'retrying',
  SKIPPED = 'skipped',
}

// 订单类型
export enum OrderType {
  DINE_IN = 'dine_in',
  PICKUP = 'pickup',
  DELIVERY = 'delivery',
}

// 通知渠道配置接口
export interface NotificationChannelConfig {
  id: number;
  store_id: number;
  order_type: OrderType;
  channel_type: ChannelType;
  channel_config: Record<string, any>;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

// 订单信息接口
export interface OrderInfo {
  order_id: string;
  order_number?: string;
  store_id: number;
  user_id: number;
  order_type: OrderType;
  contact_name?: string;
  contact_phone?: string;
  table_name?: string;
  address?: string;
  total_amount: number;
  payable_amount: number;
  created_at: Date;
  updated_at: Date;
}

// Redis Stream 消息接口
export interface StreamMessage {
  orderId: string;
  token: string;
  event: NotificationEventType;
  storeCode: string;
  timestamp: number;
}

// 通知日志接口
export interface NotificationLog {
  id?: number;
  order_id: string;
  store_code: string;
  event_type: NotificationEventType;
  channel_type: ChannelType;
  status: NotificationStatus;
  request_data?: Record<string, any>;
  response_data?: Record<string, any>;
  error_message?: string;
  duration_ms?: number;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
}