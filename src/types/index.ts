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
  store_code: string;
  order_type: OrderType;
  channel_type: ChannelType;
  channel_config: Record<string, any>;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItem {
  order_item_id: string;
  order_id: string;
  item_id: number;
  quantity: number;
  price_at_order: number;
  specification_id: number;
  options: any | null;
  item_name: string;
  spec_name: string;
  created_at: string;
  updated_at: string;
}

export interface Store {
  name: string;
  address: string;
  phone: string;
  store_code: string;
  id: number;
  store_type: string;
  status: string;
}

export interface OrderInfo {
  order_id: string;
  order_number: string;
  pickup_code: string;
  pickup_code_date: string;
  store_id: number;
  user_id: number;
  order_type: OrderType;
  contact_name: string;
  contact_phone: string;
  table_name: string | null;
  guest_count: number;
  address: string | null;
  total_amount: number;
  packaging_fee: number;
  service_fee: number;
  delivery_fee: number;
  discount_amount: number;
  payable_amount: number;
  payment_method: string;
  payment_status: string;
  remark: string;
  order_status: string;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  order_items: OrderItem[];
  store: Store;
  payments: any[]; // adjust to a more specific type if known
}

const order: OrderInfo = {
  order_id: '4',
  order_number: 'TEST001-20250519-114303-2663',
  pickup_code: '0004',
  pickup_code_date: '2025-05-19T00:00:00.000Z',
  store_id: 1,
  user_id: 2,
  order_type: OrderType.PICKUP,
  contact_name: '没什么',
  contact_phone: '18382222061',
  table_name: null,
  guest_count: 1,
  address: null,
  total_amount: 700,
  packaging_fee: 50,
  service_fee: 0,
  delivery_fee: 0,
  discount_amount: 0,
  payable_amount: 750,
  payment_method: 'friend_qr',
  payment_status: 'unpaid',
  remark: '',
  order_status: 'pending_confirmation',
  created_at: '2025-05-19T11:43:03.182Z',
  updated_at: '2025-05-19T11:43:03.182Z',
  paid_at: null,
  order_items: [
    {
      order_item_id: '10',
      order_id: '4',
      item_id: 1788,
      quantity: 1,
      price_at_order: 200,
      specification_id: 1664,
      options: null,
      item_name: '矿泉水',
      spec_name: '标准',
      created_at: '2025-05-19T11:43:03.184Z',
      updated_at: '2025-05-19T11:43:03.184Z',
    },
    {
      order_item_id: '11',
      order_id: '4',
      item_id: 1789,
      quantity: 1,
      price_at_order: 500,
      specification_id: 1665,
      options: null,
      item_name: '果汁',
      spec_name: '标准',
      created_at: '2025-05-19T11:43:03.184Z',
      updated_at: '2025-05-19T11:43:03.184Z',
    },
  ],
  store: {
    name: '全家便利店',
    address: '天河路123号首层',
    phone: '020-87654321',
    store_code: 'TEST001',
    id: 1,
    store_type: '便利店',
    status: 'open',
  },
  payments: [],
};

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

/**
 * 自定义错误，表示获取订单信息时发生严重且已重试多次的失败，或通知已过时。
 */
export class CriticalOrderInfoError extends Error {
  public readonly originalError?: any;
  public readonly attemptsMade: number;

  constructor(message: string, attemptsMade: number, originalError?: any) {
    super(message);
    this.name = 'CriticalOrderInfoError';
    this.attemptsMade = attemptsMade;
    this.originalError = originalError;
    // Ensures the prototype chain is correct for custom errors
    Object.setPrototypeOf(this, CriticalOrderInfoError.prototype);
  }
}

/**
 * 微信模板消息中单个数据项的映射配置
 * 对应 wechat_template_configs 表中 field_mapping JSON 对象的值
 */
export interface WechatTemplateDataMappingItem {
  value_if_missing: undefined;
  field: string; // 从 OrderInfo 中取值的路径，例如 'pricing.totalAmount' หรือ 'address'
  value?: string; // 可选的固定值，如果 field 取不到或想强制使用固定值
  color?: string; // 微信模板消息允许为 data 项指定颜色 (例如 "#173177")
  format_type?: 'currency' | 'datetime' | 'default'; // 建议的格式化类型
  currency_symbol?: string; // 例如 '元', '$', 仅当 format_type 是 currency 时
  datetime_format?: string; // 例如 'yyyy-MM-dd HH:mm:ss', 仅当 format_type 是 datetime 时
}

/**
 * 微信模板消息跳转小程序配置
 * 对应 wechat_template_configs 表中 miniprogram 字段 (如果表结构是JSON对象)
 * 或者对应扁平化的 miniprogram_appid 和 miniprogram_pagepath 字段
 */
export interface WechatTemplateMiniprogramConfig {
  appid: string; // 所需跳转到的小程序appid（该小程序appid必须与发模板消息的公众号是绑定关联关系）
  pagepath?: string; // 所需跳转到小程序的具体页面路径，支持带参数,（示例index?foo=bar）
}

/**
 * 微信公众号模板消息的完整配置条目
 * 对应从 wechat_template_configs 数据库表读取的一条记录
 */
export interface WechatTemplateConfig {
  id: number;
  store_id: number; // 来自数据库，是数字类型。确保与 ConfigService 的查询参数匹配
  store_code?: string; // 如果 ConfigService 返回的配置中也包含 store_code，则添加
  template_name: string; // 模板名称，来自数据库
  event_type: NotificationEventType;
  template_id: string; // 微信后台生成的完整模板ID
  // template_id_short?: string; // 如果数据库有此列 (例如，微信模板库的编号)
  field_mapping: Record<string, WechatTemplateDataMappingItem>; // 模板字段映射配置
  miniprogram?: WechatTemplateMiniprogramConfig | null; // 跳转小程序配置 (如果数据库是JSON对象)
  miniprogram_appid?: string; // 如果数据库是扁平化字段 miniprogram_appid
  miniprogram_page?: string; // 如果数据库是扁平化字段 miniprogram_page
  url?: string; // 跳转网页URL (如果不用小程序)
  enabled: boolean;
  // created_at 和 updated_at 通常在业务逻辑中不需要
}

// --- 结束新增类型定义 ---
