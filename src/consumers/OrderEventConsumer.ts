// src/consumers/OrderEventConsumer.ts
import Redis from 'ioredis';
import pLimit from 'p-limit';
import RedisService from '../services/RedisService';
import LoggerService from '../services/LoggerService';
import { config } from '../config/config';
import { StreamMessage, NotificationEventType, CriticalOrderInfoError } from '../types'; // CriticalOrderInfoError 从 types 导入
import NotificationEngine from '../services/NotificationEngine';
import { OrderServiceHealthChecker } from '../services/OrderServiceHealthChecker'; // 引入健康检查器

const STREAM_KEY = config.STREAM_KEY;
const CONSUMER_GROUP = config.CONSUMER_GROUP;
const CONSUMER_NAME = `consumer-${config.NODE_ENV}-${process.pid}-${Date.now().toString(36)}`;

type RedisRawMessageEntry = [messageId: string, fields: string[]];
type RedisStreamMessagesArray = RedisRawMessageEntry[];
type RedisStreamResultPayload = [streamName: string, messages: RedisStreamMessagesArray | null];
type XReadGroupSingleStreamResponse = [RedisStreamResultPayload] | null;

class OrderEventConsumer {
  private redis: Redis;
  private isRunning: boolean = false;
  private limit: ReturnType<typeof pLimit>;
  private pollTimeoutId: NodeJS.Timeout | null = null;

  constructor() {
    this.redis = RedisService.getInstance();
    const maxConcurrentTasks = config.STREAM_MAX_CONCURRENT_TASKS;
    this.limit = pLimit(maxConcurrentTasks);
    LoggerService.info(`[Consumer] ${CONSUMER_NAME} P-Limit initialized with concurrency: ${maxConcurrentTasks}`);
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      LoggerService.warn(`[Consumer] ${CONSUMER_NAME} OrderEventConsumer 已经运行.`);
      return;
    }

    LoggerService.info(`[Consumer] ${CONSUMER_NAME} 开启 OrderEventConsumer...`);
    try {
      await this.ensureConsumerGroup();
      this.isRunning = true;
      this.pollMessages().catch((pollingError) => {
        LoggerService.error(`[Consumer] ${CONSUMER_NAME} pollMessages 循环意外退出或发生未捕获的严重错误:`, pollingError);
        this.isRunning = false;
      });
      LoggerService.info(`[Consumer] ${CONSUMER_NAME} OrderEventConsumer 启动. Group: ${CONSUMER_GROUP}, Stream: ${STREAM_KEY}`);
    } catch (error) {
      LoggerService.error(`[Consumer] ${CONSUMER_NAME} 启动 OrderEventConsumer 失败:`, error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    const wasRunning = this.isRunning;
    this.isRunning = false;

    if (!wasRunning && this.limit.activeCount === 0 && this.limit.pendingCount === 0) {
      LoggerService.warn(`[Consumer] ${CONSUMER_NAME} OrderEventConsumer 没有运行或已完全停止.`);
      return;
    }

    LoggerService.info(`[Consumer] ${CONSUMER_NAME} 尝试停止 OrderEventConsumer... Active: ${this.limit.activeCount}, Pending: ${this.limit.pendingCount}`);

    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
      LoggerService.debug(`[Consumer] ${CONSUMER_NAME} Cleared active pollTimeoutId during stop.`);
    }

    const gracefulShutdownTimeout = 30000;
    const pollInterval = 500;
    let waited = 0;

    while ((this.limit.activeCount > 0 || this.limit.pendingCount > 0) && waited < gracefulShutdownTimeout) {
      LoggerService.info(`[Consumer] ${CONSUMER_NAME} 优雅关闭: 等待 ${this.limit.activeCount} 个活动和 ${this.limit.pendingCount} 个待处理任务完成...`);
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      waited += pollInterval;
    }

    if (this.limit.activeCount > 0 || this.limit.pendingCount > 0) {
      LoggerService.warn(`[Consumer] ${CONSUMER_NAME} 优雅关闭超时. ${this.limit.activeCount} 个活动或 ${this.limit.pendingCount} 个待处理任务可能仍在运行.`);
    } else {
      LoggerService.info(`[Consumer] ${CONSUMER_NAME} 所有任务完成. 消费者已完全停止.`);
    }
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
      LoggerService.info(`[Consumer] ${CONSUMER_NAME} 消费者组 ${CONSUMER_GROUP} 创建或已存在, stream: ${STREAM_KEY}.`);
    } catch (error: any) {
      if (error.message && error.message.includes('BUSYGROUP')) {
        LoggerService.info(`[Consumer] ${CONSUMER_NAME} 消费者组 ${CONSUMER_GROUP} 已存在, stream: ${STREAM_KEY}.`);
      } else {
        LoggerService.error(`[Consumer] ${CONSUMER_NAME} 创建/确保消费者组失败:`, error);
        throw error;
      }
    }
  }

  private async _processSingleMessageWork(messageId: string, fields: string[]): Promise<void> {
    const parsedMessage = this.parseMessage(fields, messageId);
    const logPrefix = `[ConsumerWorker ${CONSUMER_NAME} msg:${messageId} order:${parsedMessage?.orderId || 'N/A'}]`;

    if (parsedMessage) {
      LoggerService.info(`${logPrefix} 开始处理.`);
      try {
        await NotificationEngine.processNotificationEvent(parsedMessage, messageId);
        LoggerService.debug(`${logPrefix} NotificationEngine 处理完毕. 确认中...`);
        await this.ackMessage(messageId);
      } catch (engineError: any) {
        if (engineError instanceof CriticalOrderInfoError) {
          LoggerService.error(`${logPrefix} CriticalOrderInfoError. 不确认. 错误: ${engineError.message}`, { originalEngineError: engineError.originalError });
        } else {
          LoggerService.error(`${logPrefix} 未处理的严重错误来自 NotificationEngine. 确认以防阻塞, 但需调查! 错误: ${engineError.message}`, engineError);
          await this.ackMessage(messageId);
        }
      }
      LoggerService.info(`${logPrefix} 处理完成.`);
    } else {
      LoggerService.warn(`${logPrefix} 解析消息失败. 确认以丢弃.`, { fields });
      await this.ackMessage(messageId);
    }
  }

  private async pollMessages(): Promise<void> {
    LoggerService.info(`[Consumer] ${CONSUMER_NAME} 开始主消息轮询循环...`);
    while (this.isRunning) {
      try {
        // 1. 检查订单服务健康状态
        if (config.ORDER_SERVICE_HEALTH_CHECK_ENABLED) {
          const isOrderServiceHealthy = await OrderServiceHealthChecker.isOrderServiceHealthy();
          LoggerService.debug(`[Consumer] ${CONSUMER_NAME} 健康检查结果: ${isOrderServiceHealthy}`); // 添加日志
          if (!isOrderServiceHealthy) {
            const unhealthyPauseMs = config.STREAM_POLL_INTERVAL_IF_ORDER_SERVICE_UNHEALTHY_MS;
            LoggerService.warn(`[Consumer] ${CONSUMER_NAME} 检测到订单服务不健康，将暂停轮询 ${unhealthyPauseMs / 1000} 秒. (Raw ms: ${unhealthyPauseMs}, Type: ${typeof unhealthyPauseMs})`);

            LoggerService.info(`[Consumer] ${CONSUMER_NAME} 开始暂停轮询 (因订单服务不健康) @ ${new Date().toLocaleString()}`);
            const pauseStarted = Date.now();

            await new Promise((resolve) => {
              // 确保 this.pollTimeoutId 在 Promise 外部声明，以便 stop() 可以访问
              // 但 setTimeout 的 ID 赋值给 this.pollTimeoutId 是正确的
              this.pollTimeoutId = setTimeout(resolve, unhealthyPauseMs);
            });
            const pauseDuration = Date.now() - pauseStarted;
            LoggerService.info(`[Consumer] ${CONSUMER_NAME} 结束暂停轮询 (因订单服务不健康) @ ${new Date().toLocaleString()}. 实际暂停: ${pauseDuration}ms`);

            this.pollTimeoutId = null; // 清理 pollTimeoutId
            if (!this.isRunning) {
              LoggerService.info(`[Consumer] ${CONSUMER_NAME} isRunning 变为 false (在订单服务不健康暂停后)，退出轮询。`);
              break;
            }
            continue;
          }
        }

        // 2. 检查并发槽位是否已满
        const currentActiveTasks = this.limit.activeCount + this.limit.pendingCount;
        if (currentActiveTasks >= config.STREAM_MAX_CONCURRENT_TASKS) {
          const fullPauseMs = config.STREAM_POLL_INTERVAL_IF_FULL_MS;
          LoggerService.debug(`[Consumer] ${CONSUMER_NAME} 并发任务数已达上限 (${currentActiveTasks}/${config.STREAM_MAX_CONCURRENT_TASKS}). 将暂停轮询 ${fullPauseMs / 1000}秒. (Raw ms: ${fullPauseMs}`);

          LoggerService.info(`[Consumer] ${CONSUMER_NAME} 开始暂停轮询 (因并发满) @ ${new Date().toLocaleString()}`);
          const pauseStarted = Date.now();

          await new Promise((resolve) => {
            this.pollTimeoutId = setTimeout(resolve, fullPauseMs);
          });
          const pauseDuration = Date.now() - pauseStarted;
          LoggerService.info(`[Consumer] ${CONSUMER_NAME} 结束暂停轮询 (因并发满) @ ${new Date().toLocaleString()}. 实际暂停: ${pauseDuration}ms`);

          this.pollTimeoutId = null;
          if (!this.isRunning) {
            LoggerService.info(`[Consumer] ${CONSUMER_NAME} isRunning 变为 false (在并发满暂停后)，退出轮询。`);
            break;
          }
          continue;
        }

        const availableSlots = config.STREAM_MAX_CONCURRENT_TASKS - currentActiveTasks;
        const countToFetch = Math.max(1, Math.min(availableSlots, config.STREAM_CONSUMER_BATCH_SIZE));

        LoggerService.debug(`[Consumer] ${CONSUMER_NAME} 正在尝试拉取消息 (XREADGROUP), COUNT: ${countToFetch}...`);
        const apiResponse: XReadGroupSingleStreamResponse = (await this.redis.xreadgroup('GROUP', CONSUMER_GROUP, CONSUMER_NAME, 'COUNT', countToFetch, 'BLOCK', config.STREAM_CONSUMER_BLOCK_TIMEOUT_MS, 'STREAMS', STREAM_KEY, '>')) as XReadGroupSingleStreamResponse;

        if (!this.isRunning) {
          LoggerService.info(`[Consumer] ${CONSUMER_NAME} isRunning 变为 false (在XREADGROUP后)，退出轮询。`);
          break;
        }

        if (!apiResponse || !apiResponse[0]) {
          LoggerService.debug(`[Consumer] ${CONSUMER_NAME} 未拉取到新消息 (BLOCK 超时或Stream为空).`);
          continue;
        }

        const streamPayload = apiResponse[0];
        const actualMessages = streamPayload[1];

        if (actualMessages && actualMessages.length > 0) {
          LoggerService.info(`[Consumer] ${CONSUMER_NAME} 收到 ${actualMessages.length} 条新消息. 派发给并发处理器...`);

          for (const [messageId, fields] of actualMessages) {
            if (!this.isRunning) break;

            this.limit(() => this._processSingleMessageWork(messageId, fields)).catch((taskError) => {
              LoggerService.error(`[Consumer] ${CONSUMER_NAME} p-limit 任务执行中发生顶层错误 (消息ID: ${messageId}):`, taskError);
            });
          }
          LoggerService.debug(`[Consumer] ${CONSUMER_NAME} 已派发 ${actualMessages.length} 条消息给处理器.`);
        } else {
          LoggerService.debug(`[Consumer] ${CONSUMER_NAME} 拉取到消息，但消息列表为空或null.`);
        }
      } catch (error: any) {
        LoggerService.error(`[Consumer] ${CONSUMER_NAME} 主轮询循环中发生错误 (例如 Redis 连接问题):`, error);
        if (!this.isRunning) {
          LoggerService.info(`[Consumer] ${CONSUMER_NAME} isRunning 变为 false (在catch块中)，退出轮询。`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, config.STREAM_CONSUMER_ERROR_RETRY_DELAY_MS));
      }
    }
    LoggerService.info(`[Consumer] 主消息轮询循环停止, consumer: ${CONSUMER_NAME}.`);
  }

  private parseMessage(fields: string[], messageId: string): StreamMessage | null {
    try {
      const messageObject: Record<string, any> = {};
      if (!fields || fields.length % 2 !== 0) {
        LoggerService.warn(`[Consumer] 消息 ${messageId} 字段数组无效: 不是偶数长度或 null.`, { fields });
        return null;
      }
      for (let i = 0; i < fields.length; i += 2) {
        messageObject[fields[i]] = fields[i + 1];
      }

      const streamMessage: Partial<StreamMessage> = {
        orderId: messageObject.orderId ? String(messageObject.orderId) : undefined,
        token: messageObject.token ? String(messageObject.token) : undefined,
        event: messageObject.event as NotificationEventType,
        storeCode: messageObject.storeCode ? String(messageObject.storeCode) : undefined,
        timestamp: messageObject.timestamp ? Number(messageObject.timestamp) : undefined,
      };

      if (!streamMessage.orderId || !streamMessage.event || !streamMessage.storeCode || streamMessage.timestamp === undefined || isNaN(streamMessage.timestamp)) {
        LoggerService.warn(`[Consumer] 消息 ${messageId} 核心字段无效或缺失:`, { received: messageObject, parsed: streamMessage });
        return null;
      }

      if (!Object.values(NotificationEventType).includes(streamMessage.event!)) {
        LoggerService.warn(`[Consumer] 消息 ${messageId} 事件类型无效:`, streamMessage.event);
        return null;
      }

      if (streamMessage.token === '') streamMessage.token = undefined;

      return streamMessage as StreamMessage;
    } catch (error: any) {
      LoggerService.error(`[Consumer] 解析消息 ${messageId} 字段失败:`, { fields, error: error.message });
      return null;
    }
  }

  private async ackMessage(messageId: string): Promise<void> {
    if (!messageId || messageId === '0-0') {
      LoggerService.warn(`[Consumer] 尝试确认无效消息Id: ${messageId}`);
      return;
    }
    try {
      const result = await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, messageId);
      if (result === 1) {
        LoggerService.debug(`[Consumer] 消息 ${messageId} 确认成功.`);
      } else {
        LoggerService.warn(`[Consumer] 消息 ${messageId} 确认命令返回 ${result}. 可能已经确认或未挂起此消费者.`);
      }
    } catch (error: any) {
      LoggerService.error(`[Consumer] 确认消息 ${messageId} 失败:`, error);
    }
  }
}

export default OrderEventConsumer;
