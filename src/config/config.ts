import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  // =========================
  // 服务基础配置 (Server)
  // =========================
  /** 服务监听端口 */
  PORT: parseInt(process.env.PORT || '3000'),
  /** 运行环境（development/production） */
  NODE_ENV: process.env.NODE_ENV || 'development',

  // =========================
  // 数据库配置 (Database)
  // =========================
  /** 数据库主机地址 */
  DATABASE_HOST: process.env.DATABASE_HOST || 'localhost',
  /** 数据库端口 */
  DATABASE_PORT: parseInt(process.env.DATABASE_PORT || '3306'),
  /** 数据库用户名 */
  DATABASE_USER: process.env.DATABASE_USER || 'root',
  /** 数据库密码 */
  DATABASE_PASSWORD: process.env.DATABASE_PASSWORD || 'password',
  /** 数据库名称 */
  DATABASE_NAME: process.env.DATABASE_NAME || 'notifications',

  // =========================
  // Redis 配置 (Redis)
  // =========================
  /** Redis 主机地址 */
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  /** Redis 端口 */
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379'),
  /** Redis 用户名（可选） */
  REDIS_USERNAME: process.env.REDIS_USERNAME || '',
  /** Redis 密码（可选） */
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',

  // =========================
  // Redis Stream 配置 (消息队列)
  // =========================
  /** Redis Stream 的 Key */
  STREAM_KEY: process.env.STREAM_KEY || 'order:events',
  /** Redis Stream 消费者组名 */
  CONSUMER_GROUP: process.env.CONSUMER_GROUP || 'notification-service',
  /** 每批次拉取的消息数量 */
  STREAM_CONSUMER_BATCH_SIZE: parseInt(process.env.STREAM_CONSUMER_BATCH_SIZE || '10'),
  /** Stream 消费者阻塞超时时间（毫秒） */
  STREAM_CONSUMER_BLOCK_TIMEOUT_MS: parseInt(process.env.STREAM_CONSUMER_BLOCK_TIMEOUT_MS || '5000'),
  /** Stream 消费出错后的重试延迟（毫秒） */
  STREAM_CONSUMER_ERROR_RETRY_DELAY_MS: parseInt(process.env.STREAM_CONSUMER_ERROR_RETRY_DELAY_MS || '5000'),
  /** Stream 最大并发处理任务数 */
  STREAM_MAX_CONCURRENT_TASKS: parseInt(process.env.STREAM_MAX_CONCURRENT_TASKS || '10'),
  /** 当任务已满时，Stream 轮询间隔（毫秒） */
  STREAM_POLL_INTERVAL_IF_FULL_MS: parseInt(process.env.STREAM_POLL_INTERVAL_IF_FULL_MS || '1000'),
  /** 当订单服务不健康时，Stream 轮询间隔（毫秒） */
  STREAM_POLL_INTERVAL_IF_ORDER_SERVICE_UNHEALTHY_MS: parseInt(process.env.STREAM_POLL_INTERVAL_IF_ORDER_SERVICE_UNHEALTHY_MS || '15000'),

  // =========================
  // 日志配置 (Logging)
  // =========================
  /** 日志级别（info/warn/error/debug） */
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // =========================
  // 订单服务相关配置 (Order Service)
  // =========================
  /** 订单服务基础 URL */
  ORDER_SERVICE_BASE_URL: process.env.ORDER_SERVICE_BASE_URL || 'http://localhost:3000/api',
  /** 订单服务访问 Token */
  ORDER_SERVICE_TOKEN: process.env.ORDER_SERVICE_TOKEN || '',
  /** 订单服务重试延迟（毫秒数组，逗号分隔） */
  ORDER_SERVICE_RETRY_DELAYS_MS: process.env.ORDER_SERVICE_RETRY_DELAYS_MS?.split(',')
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0) || [60000, 120000, 240000], // 默认 1m, 2m, 4m
  /** 订单服务通知最大时效（毫秒） */
  ORDER_SERVICE_MAX_NOTIFICATION_AGE_MS: parseInt(process.env.ORDER_SERVICE_MAX_NOTIFICATION_AGE_MS || `${10 * 60 * 1000}`), // 默认10分钟
  /** 订单服务 API 快速重试次数 */
  ORDER_SERVICE_QUICK_RETRY_ATTEMPTS: parseInt(process.env.ORDER_SERVICE_QUICK_RETRY_ATTEMPTS || '2'),
  /** 订单服务 API 快速重试间隔（毫秒） */
  ORDER_SERVICE_QUICK_RETRY_DELAY_MS: parseInt(process.env.ORDER_SERVICE_QUICK_RETRY_DELAY_MS || '1000'),

  // =========================
  // HTTP 客户端配置 (HTTP Client)
  // =========================
  /** HTTP 请求默认超时时间（毫秒） */
  DEFAULT_HTTP_TIMEOUT_MS: parseInt(process.env.DEFAULT_HTTP_TIMEOUT_MS || '5000'),

  // =========================
  // 健康检查相关配置 (Health Check)
  // =========================
  /** 是否启用订单服务健康检查 */
  ORDER_SERVICE_HEALTH_CHECK_ENABLED: (process.env.ORDER_SERVICE_HEALTH_CHECK_ENABLED || 'true') === 'true',
  /** 订单服务健康检查端点 */
  ORDER_SERVICE_HEALTH_CHECK_ENDPOINT: process.env.ORDER_SERVICE_HEALTH_CHECK_ENDPOINT || '/health',
  /** 健康检查间隔（毫秒） */
  ORDER_SERVICE_HEALTH_CHECK_INTERVAL_MS: parseInt(process.env.ORDER_SERVICE_HEALTH_CHECK_INTERVAL_MS || '10000'),
  /** 健康状态在 Redis 中的 Key */
  ORDER_SERVICE_HEALTH_STATUS_REDIS_KEY: process.env.ORDER_SERVICE_HEALTH_STATUS_REDIS_KEY || 'notification_aux:order_service_healthy',
  /** 健康状态在 Redis 中的有效期（秒） */
  ORDER_SERVICE_HEALTH_STATUS_TTL_S: parseInt(process.env.ORDER_SERVICE_HEALTH_STATUS_TTL_S || '30'),
} as const;
