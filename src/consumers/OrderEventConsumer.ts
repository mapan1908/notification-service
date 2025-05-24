// src/consumers/OrderEventConsumer.ts
import Redis from 'ioredis';
import RedisService from '../services/RedisService';
import LoggerService from '../services/LoggerService';
import { config } from '../config/config';
import { StreamMessage, NotificationEventType } from '../types'; // StreamMessage 接口已在 types/index.ts 定义
// 假设 NotificationEngine 未来会有一个 process 方法
// import NotificationEngine from '../services/NotificationEngine';

const STREAM_KEY = config.STREAM_KEY; // 'order:events'
const CONSUMER_GROUP = config.CONSUMER_GROUP; // 'notification-service'
const CONSUMER_NAME = `consumer-${process.pid}`; // 唯一的消费者名称，例如基于进程ID

class OrderEventConsumer {
  private redis: Redis;
  private isRunning: boolean = false;
  private lastMessageId: string = '0-0'; // 用于在消费者重启时从未处理的消息开始

  constructor() {
    this.redis = RedisService.getInstance();
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      LoggerService.warn('[Consumer] OrderEventConsumer is already running.');
      return;
    }

    LoggerService.info('[Consumer] Starting OrderEventConsumer...');
    await this.ensureConsumerGroup();
    this.isRunning = true;
    this.lastMessageId = '0-0'; // 或者从持久化存储中读取上一次的 ID
    this.pollMessages();
    LoggerService.info(`[Consumer] OrderEventConsumer started. Group: ${CONSUMER_GROUP}, Consumer: ${CONSUMER_NAME}, Stream: ${STREAM_KEY}`);
  }

  public stop(): void {
    this.isRunning = false;
    LoggerService.info('[Consumer] Stopping OrderEventConsumer...');
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      // 尝试创建消费者组，如果已存在，则忽略错误
      // XGROUP CREATE mystream group1 0 MKSTREAM
      await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
      LoggerService.info(`[Consumer] Consumer group ${CONSUMER_GROUP} created or already exists for stream ${STREAM_KEY}.`);
    } catch (error: any) {
      if (error.message.includes('BUSYGROUP')) {
        LoggerService.info(`[Consumer] Consumer group ${CONSUMER_GROUP} already exists for stream ${STREAM_KEY}.`);
      } else {
        LoggerService.error('[Consumer] Failed to create consumer group:', error);
        throw error; // 关键错误，需要抛出
      }
    }
  }

  private async pollMessages(): Promise<void> {
    while (this.isRunning) {
      try {
        // XREADGROUP GROUP group1 consumer1 COUNT 1 BLOCK 2000 STREAMS mystream >
        // '>' 表示只读取尚未传递给组中其他消费者的消息
        const messages = await this.redis.xreadgroup(
          'GROUP',
          CONSUMER_GROUP,
          CONSUMER_NAME,
          'COUNT',
          10, // 一次拉取多少条消息
          'BLOCK',
          5000, // 阻塞等待5秒
          'STREAMS',
          STREAM_KEY,
          '>' // 读取新消息
        );

        if (messages && messages.length > 0) {
          // messages 结构: [ [streamName, [ [messageId, [key, value, ...]], ... ]] ]
          const streamMessages = messages[0][1]; // 获取第一个 stream 的消息列表
          for (const [messageId, fields] of streamMessages) {
            LoggerService.debug(`[Consumer] Received message ${messageId}`, { fields });
            this.lastMessageId = messageId; // 更新最后处理的消息ID
            
            const parsedMessage = this.parseMessage(fields);
            if (parsedMessage) {
              // TODO: 调用 NotificationEngine.process(parsedMessage, messageId);
              // 示例：
              LoggerService.info(`[Consumer] Processing message: ${messageId}`, parsedMessage);
              // await NotificationEngine.process(parsedMessage, messageId); // 假设有这个方法
              
              // 模拟处理完成，然后确认消息
              await this.ackMessage(messageId);
            } else {
              LoggerService.warn(`[Consumer] Failed to parse message ${messageId}. Skipping.`, { fields });
              // 对于无法解析的消息，也应该确认，避免重复处理坏消息
              // 或者根据策略将其移至死信队列
              await this.ackMessage(messageId);
            }
          }
        }
        // 如果没有消息，BLOCK 会超时，循环会继续
      } catch (error) {
        LoggerService.error('[Consumer] Error polling messages:', error);
        // 避免因错误导致循环过快，可以稍作等待
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    LoggerService.info('[Consumer] Message polling stopped.');
  }

  private parseMessage(fields: string[]): StreamMessage | null {
    // fields 结构: [key1, value1, key2, value2, ...]
    // 我们期望的 StreamMessage 结构: { orderId: string, token: string, event: NotificationEventType, storeId: string, timestamp: number }
    try {
      const messageObject: Record<string, any> = {};
      for (let i = 0; i < fields.length; i += 2) {
        messageObject[fields[i]] = fields[i + 1];
      }

      // 类型转换和验证
      const streamMessage: StreamMessage = {
        orderId: String(messageObject.orderId),
        token: String(messageObject.token), // 假设 token 存在
        event: messageObject.event as NotificationEventType, // 需要确保 event 值在枚举中
        storeCode: messageObject.storeCode, // 之前是 number，根据 StreamMessage 接口，这里应为 string
        timestamp: Number(messageObject.timestamp),
      };

      // 基础验证
      if (!streamMessage.orderId || !streamMessage.event || !streamMessage.storeCode || isNaN(streamMessage.timestamp)) {
        LoggerService.warn('[Consumer] Invalid message content:', streamMessage);
        return null;
      }
      // 验证 event 是否是有效的 NotificationEventType
      if (!Object.values(NotificationEventType).includes(streamMessage.event)) {
        LoggerService.warn('[Consumer] Invalid event type in message:', streamMessage.event);
        return null;
      }

      return streamMessage;
    } catch (error) {
      LoggerService.error('[Consumer] Error parsing message fields:', { fields, error });
      return null;
    }
  }

  private async ackMessage(messageId: string): Promise<void> {
    try {
      // XACK mystream group1 messageId
      await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, messageId);
      LoggerService.debug(`[Consumer] Message ${messageId} acknowledged.`);
    } catch (error) {
      LoggerService.error(`[Consumer] Failed to acknowledge message ${messageId}:`, error);
      // ACK 失败可能导致消息重传，需要监控
    }
  }

  // TODO: (可选) 实现处理未被ACK的旧消息的逻辑 (XPENDING, XCLAIM)
  // 可以在启动时检查 PENDING 列表，并尝试认领和处理这些消息
}

export default OrderEventConsumer;