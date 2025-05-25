// scripts/send-test-event.ts
import Redis from 'ioredis';
import { config } from '../src/config/config';
import { NotificationEventType, StreamMessage } from '../src/types';

// --- 配置区 ---
const DEFAULT_TEST_EVENT_BASE: Omit<StreamMessage, 'timestamp' | 'orderId'> = {
  storeCode: 'TEST001', // 您的测试店铺代码
  event: NotificationEventType.ORDER_CREATED, // 要测试的事件类型
  token: 'test-order-api-token-if-needed', // 可选的API token
};

const STREAM_KEY = config.STREAM_KEY;
let numberOfMessagesToSend = 5; // 默认发送5条消息
let delayBetweenMessagesMs = 100; // 每条消息之间的发送间隔（毫秒），设为0则无间隔
// --- 结束配置区 ---

const redisOptions = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
  username: config.REDIS_USERNAME || undefined,
  connectTimeout: 10000,
};

const redis = new Redis(redisOptions);

redis.on('error', (err) => {
  console.error('[Redis Sender] Redis connection error:', err);
  if (redis.status !== 'ready' && redis.status !== 'end') {
    // process.exit(1); // 错误时交由 main().catch() 处理退出码
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

async function sendSingleEventToStream(eventData: Partial<StreamMessage> = {}, sequence: number) {
  // 这个函数现在假设 Redis 已经 ready

  const uniqueOrderId = eventData.orderId || `${sequence}`;

  const messageToSend: StreamMessage = {
    orderId: uniqueOrderId,
    storeCode: eventData.storeCode || DEFAULT_TEST_EVENT_BASE.storeCode,
    event: eventData.event || DEFAULT_TEST_EVENT_BASE.event,
    token: eventData.token !== undefined ? eventData.token : DEFAULT_TEST_EVENT_BASE.token,
    timestamp: Date.now(),
  };

  const flatMessage = flattenStreamMessage(messageToSend);

  if (flatMessage.length === 0) {
    console.error('[Redis Sender] Error: Message to send is empty after flattening for orderId:', uniqueOrderId);
    return; // 继续发送下一条
  }

  console.log(`[Redis Sender] Sending event ${sequence}/${numberOfMessagesToSend} to stream '${STREAM_KEY}':`, messageToSend);

  try {
    const messageId = await redis.xadd(STREAM_KEY, '*', ...flatMessage);
    console.log(`[Redis Sender] Event ${sequence} sent successfully! Message ID: ${messageId}`);
  } catch (error) {
    console.error(`[Redis Sender] Failed to send event ${sequence} (orderId: ${uniqueOrderId}) to stream:`, error);
    // 可以选择在这里抛出错误以停止整个发送过程，或者记录错误并继续
    // throw error; // 如果希望一个失败就停止所有
  }
}

async function main() {
  console.log('[Redis Sender] Attempting to connect to Redis...');
  let readyTimeout: NodeJS.Timeout | undefined;

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      if (readyTimeout) clearTimeout(readyTimeout);
      console.log('[Redis Sender] Redis is ready.');
      redis.removeListener('error', onErrorDuringConnect);
      resolve();
    };
    const onErrorDuringConnect = (err: Error) => {
      if (readyTimeout) clearTimeout(readyTimeout);
      console.error('[Redis Sender] Error during initial connection:', err.message);
      redis.removeListener('ready', onReady);
      reject(err);
    };
    if (redis.status === 'ready') {
      console.log('[Redis Sender] Redis was already ready.');
      return resolve();
    }
    redis.once('ready', onReady);
    redis.once('error', onErrorDuringConnect);
    const connectTimeoutMs = redisOptions.connectTimeout;
    readyTimeout = setTimeout(() => {
      if (redis.status !== 'ready' && redis.status !== 'end') {
        console.error(`[Redis Sender] Timeout waiting for Redis 'ready' event after ${connectTimeoutMs}ms. Current status: ${redis.status}`);
        redis.removeListener('ready', onReady);
        redis.removeListener('error', onErrorDuringConnect);
        reject(new Error('Timeout waiting for Redis ready event'));
      } else if (redis.status === 'ready' && readyTimeout) {
        clearTimeout(readyTimeout);
      }
    }, connectTimeoutMs + 1000);
  });

  // --- 命令行参数处理 ---
  const args = process.argv.slice(2);
  const baseCustomEventData: Partial<StreamMessage> = {};

  // 示例: node scripts/send-test-event.ts count=20 delay=50 event=order_paid storeCode=S002
  args.forEach((arg) => {
    const [key, value] = arg.split('=');
    if (key && value) {
      if (key === 'count') {
        const num = parseInt(value, 10);
        if (!isNaN(num) && num > 0) numberOfMessagesToSend = num;
      } else if (key === 'delay') {
        const num = parseInt(value, 10);
        if (!isNaN(num) && num >= 0) delayBetweenMessagesMs = num;
      } else if (key === 'timestamp') {
        // 通常我们会用 Date.now()，但允许覆盖
        (baseCustomEventData as any)[key] = Number(value);
      } else if (key === 'event' && Object.values(NotificationEventType).includes(value as NotificationEventType)) {
        baseCustomEventData.event = value as NotificationEventType;
      } else if (key === 'orderId' || key === 'storeCode' || key === 'token') {
        // 这些字段如果提供，将作为每次发送消息的模板，但 orderId 会被序列号覆盖
        (baseCustomEventData as any)[key] = value;
      }
    }
  });

  if (Object.keys(baseCustomEventData).length > 0 || args.some((a) => a.startsWith('count=') || a.startsWith('delay='))) {
    console.log('[Redis Sender] Parsed command line arguments:', {
      numberOfMessages: numberOfMessagesToSend,
      delayBetweenMessagesMs,
      baseEventData: baseCustomEventData,
    });
  }
  // --- 结束命令行参数处理 ---

  console.log(`[Redis Sender] Preparing to send ${numberOfMessagesToSend} messages with ${delayBetweenMessagesMs}ms delay between each.`);

  for (let i = 1; i <= numberOfMessagesToSend; i++) {
    // 可以为每条消息创建略微不同的数据，例如通过 baseCustomEventData 传递基础模板
    const eventDataForThisMessage: Partial<StreamMessage> = { ...baseCustomEventData };
    // orderId 会在 sendSingleEventToStream 中被唯一化，除非在 baseCustomEventData 中指定了 orderId 且希望它不变（不推荐用于批量）

    await sendSingleEventToStream(eventDataForThisMessage, i);
    if (i < numberOfMessagesToSend && delayBetweenMessagesMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenMessagesMs));
    }
  }
  console.log(`[Redis Sender] All ${numberOfMessagesToSend} messages have been queued for sending.`);
}

main()
  .catch((err) => {
    console.error('[Redis Sender] Error in main execution:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (redis.status !== 'end') {
      console.log('[Redis Sender] Ensuring Redis connection is closed...');
      try {
        await redis.quit();
        console.log('[Redis Sender] Redis connection closed successfully.');
      } catch (quitError: any) {
        console.error('[Redis Sender] Error during redis.quit():', quitError.message);
        redis.disconnect();
      }
    } else {
      console.log('[Redis Sender] Redis connection was already closed.');
    }
  });
