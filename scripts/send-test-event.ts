// scripts/send-test-event.ts
import Redis from 'ioredis';
import { config } from '../src/config/config';
import { NotificationEventType, StreamMessage } from '../src/types';

const DEFAULT_TEST_EVENT: Omit<StreamMessage, 'timestamp'> = {
  orderId: `ORD-TEST-${Date.now().toString().slice(-6)}`,
  storeCode: 'STORE001',
  event: NotificationEventType.ORDER_CREATED,
  token: 'test-order-api-token-if-needed',
};

const STREAM_KEY = config.STREAM_KEY;

const redisOptions = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
  username: config.REDIS_USERNAME || undefined,
  // ioredis 默认的 connectTimeout 是 10000ms，通常足够
  // connectTimeout: 10000,
  // commandTimeout: 5000, // 对于发送脚本，单个XADD通常很快，默认即可
};

const redis = new Redis(redisOptions);

redis.on('error', (err) => {
  console.error('[Redis Sender] Redis connection error:', err);
  // 如果在连接过程中发生错误，确保脚本退出
  if (redis.status !== 'ready' && redis.status !== 'end') {
    process.exit(1);
  }
});

function flattenStreamMessage(message: StreamMessage): string[] {
  const flatArray: string[] = [];
  for (const [key, value] of Object.entries(message)) {
    if (value !== undefined && value !== null) {
      flatArray.push(key);
      flatArray.push(String(value));
    }
  }
  return flatArray;
}

async function sendEventToStream(eventData: Partial<StreamMessage> = {}) {
  // 这个函数现在假设 Redis 已经 ready

  const messageToSend: StreamMessage = {
    orderId: eventData.orderId || DEFAULT_TEST_EVENT.orderId,
    storeCode: eventData.storeCode || DEFAULT_TEST_EVENT.storeCode,
    event: eventData.event || DEFAULT_TEST_EVENT.event,
    token:
      eventData.token !== undefined
        ? eventData.token
        : DEFAULT_TEST_EVENT.token,
    timestamp: Date.now(),
  };

  const flatMessage = flattenStreamMessage(messageToSend);

  if (flatMessage.length === 0) {
    console.error(
      '[Redis Sender] Error: Message to send is empty after flattening.'
    );
    return; // 不退出进程，让 main 中的 finally 处理 quit
  }

  console.log(
    `[Redis Sender] Sending event to stream '${STREAM_KEY}':`,
    messageToSend
  );

  try {
    const messageId = await redis.xadd(STREAM_KEY, '*', ...flatMessage);
    console.log(
      `[Redis Sender] Event sent successfully! Message ID: ${messageId}`
    );
  } catch (error) {
    console.error('[Redis Sender] Failed to send event to stream:', error);
  }
}

async function main() {
  console.log('[Redis Sender] Attempting to connect to Redis...');

  // 等待 Redis 'ready' 事件
  await new Promise<void>((resolve, reject) => {
    redis.on('ready', () => {
      console.log('[Redis Sender] Redis is ready.');
      resolve();
    });
    // 如果在等待 ready 期间发生连接错误，ioredis 的 'error' 事件会触发
    // 也可以在这里加一个超时，防止无限等待
    const connectTimeoutMs = 10000; // 使用ioredis的连接超时或默认
    const readyTimeout = setTimeout(() => {
      if (redis.status !== 'ready') {
        console.error(
          `[Redis Sender] Timeout waiting for Redis 'ready' event after ${connectTimeoutMs}ms. Current status: ${redis.status}`
        );
        redis.disconnect(); // 主动断开，避免进程挂起
        reject(new Error('Timeout waiting for Redis ready event'));
      }
    }, connectTimeoutMs + 1000); // 比连接超时稍长一点

    // 如果连接已经建立了 (可能在添加监听器之前就ready了)
    if (redis.status === 'ready') {
      clearTimeout(readyTimeout);
      console.log('[Redis Sender] Redis was already ready.');
      resolve();
    }
  });

  // --- 命令行参数处理 ---
  const args = process.argv.slice(2);
  const customEventData: Partial<StreamMessage> = {};
  if (args.length > 0) {
    // ... (命令行参数解析逻辑不变) ...
    args.forEach((arg) => {
      const [key, value] = arg.split('=');
      if (key && value) {
        if (key === 'timestamp') {
          (customEventData as any)[key] = Number(value);
        } else if (
          key === 'event' &&
          Object.values(NotificationEventType).includes(
            value as NotificationEventType
          )
        ) {
          customEventData.event = value as NotificationEventType;
        } else {
          (customEventData as any)[key] = value;
        }
      }
    });
    console.log('[Redis Sender] Parsed custom event data:', customEventData);
  }
  // --- 结束命令行参数处理 ---

  await sendEventToStream(customEventData);
}

main()
  .catch((err) => {
    console.error('[Redis Sender] Unhandled error in main:', err);
    process.exitCode = 1; // 设置退出码为1，表示错误
  })
  .finally(async () => {
    // 确保 Redis 连接在脚本结束时关闭
    if (redis.status !== 'end') {
      console.log('[Redis Sender] Closing Redis connection...');
      await redis.quit();
      console.log('[Redis Sender] Redis connection closed.');
    }
  });
