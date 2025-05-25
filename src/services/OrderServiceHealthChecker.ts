// src/services/OrderServiceHealthChecker.ts
import { request } from 'undici';
import { config } from '../config/config';
import LoggerService from './LoggerService';
import RedisService from './RedisService';
import { defaultHttpAgent } from '../utils/httpClient'; // 确保您有这个

const HEALTH_CHECK_URL = `${config.ORDER_SERVICE_BASE_URL}${config.ORDER_SERVICE_HEALTH_CHECK_ENDPOINT}`;
const HEALTH_STATUS_KEY = config.ORDER_SERVICE_HEALTH_STATUS_REDIS_KEY;
const HEALTH_STATUS_TTL = config.ORDER_SERVICE_HEALTH_STATUS_TTL_S;
const CHECK_INTERVAL = config.ORDER_SERVICE_HEALTH_CHECK_INTERVAL_MS;
const HEALTH_CHECK_TIMEOUT = Math.min(
  config.DEFAULT_HTTP_TIMEOUT_MS,
  CHECK_INTERVAL - 1000
); // 健康检查的超时应小于检查间隔

let intervalId: NodeJS.Timeout | null = null;
let currentHealthStatus: boolean = false; // 本地缓存一份状态，减少Redis读取（可选）

async function checkOrderStatus(): Promise<boolean> {
  LoggerService.debug(
    '[HealthChecker] Performing Order Service health check...'
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

  try {
    const { statusCode } = await request(HEALTH_CHECK_URL, {
      method: 'GET', // 或订单服务健康检查所需的其他方法
      dispatcher: defaultHttpAgent,
      signal: controller.signal,
      headers: {
        // 如果健康检查也需要Token，在这里添加
        // 'Authorization': `Bearer ${config.ORDER_SERVICE_TOKEN}`,
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (statusCode >= 200 && statusCode < 300) {
      LoggerService.debug('[HealthChecker] Order Service is healthy.');
      return true;
    } else {
      LoggerService.warn(
        `[HealthChecker] Order Service health check failed with status: ${statusCode}`
      );
      return false;
    }
  } catch (error: any) {
    clearTimeout(timeoutId); // 确保清理
    if (error.name === 'AbortError') {
      LoggerService.warn(
        '[HealthChecker] Order Service health check timed out.'
      );
    } else {
      LoggerService.warn(
        '[HealthChecker] Order Service health check failed with error:',
        error.message
      );
    }
    return false;
  }
}

async function updateHealthStatusInRedis(isHealthy: boolean): Promise<void> {
  try {
    // 将状态写入Redis并设置TTL，这样即使本检测器实例挂掉，状态也会在一段时间后过期
    // 其他服务实例可以通过读取这个key来获取最新状态
    await RedisService.set(
      HEALTH_STATUS_KEY,
      isHealthy ? '1' : '0',
      HEALTH_STATUS_TTL
    );
    currentHealthStatus = isHealthy; // 更新本地缓存
    LoggerService.debug(
      `[HealthChecker] Updated Order Service health status in Redis to: ${isHealthy}`
    );
  } catch (error) {
    LoggerService.error(
      '[HealthChecker] Failed to update health status in Redis:',
      error
    );
    // 如果Redis更新失败，依赖本地缓存的 currentHealthStatus 可能不准确，但检测会继续
  }
}

async function runCheckCycle(): Promise<void> {
  if (!config.ORDER_SERVICE_HEALTH_CHECK_ENABLED) {
    LoggerService.info(
      '[HealthChecker] Order Service health check is disabled via config.'
    );
    // 如果禁用，可以考虑在Redis中设置一个默认的健康状态或不设置
    // 为了简单，如果禁用，则假定服务是健康的，或者让依赖方自行处理无状态的情况
    // 或者，如果禁用，则不启动定时器，调用 isOrderServiceHealthy() 时返回一个默认值。
    await updateHealthStatusInRedis(true); // 禁用时，默认服务是健康的
    return;
  }

  const isHealthy = await checkOrderStatus();
  await updateHealthStatusInRedis(isHealthy);
}

export class OrderServiceHealthChecker {
  public static async start(): Promise<void> {
    if (!config.ORDER_SERVICE_HEALTH_CHECK_ENABLED) {
      LoggerService.info(
        '[HealthChecker] Order Service health check is disabled. Not starting checker.'
      );
      // 确保在禁用时，Redis中有一个表示“健康”的值或没有值（让读取方处理默认）
      // 我们可以在禁用时，也写入一个 "1" 到 Redis，并设置TTL，或者根本不写，让 getHealthStatus 处理默认
      // 简单起见，如果禁用，我们可以在首次调用 isOrderServiceHealthy 时返回true
      await RedisService.set(HEALTH_STATUS_KEY, '1', HEALTH_STATUS_TTL * 2); // 禁用时也设置一个较长的健康状态
      return;
    }

    if (intervalId) {
      LoggerService.warn('[HealthChecker] Health checker is already running.');
      return;
    }
    LoggerService.info(
      `[HealthChecker] Starting Order Service health checker. Interval: ${CHECK_INTERVAL}ms`
    );
    // 立即执行一次检查，然后设置定时器
    await runCheckCycle();
    intervalId = setInterval(runCheckCycle, CHECK_INTERVAL);
  }

  public static stop(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      LoggerService.info(
        '[HealthChecker] Order Service health checker stopped.'
      );
    }
  }

  /**
   * 获取当前已知的订单服务健康状态。
   * 优先从本地缓存读取，如果需要更实时可以改为直接读Redis。
   * @returns Promise<boolean> - true 如果健康，false 如果不健康或未知（例如Redis读取失败）
   */
  public static async isOrderServiceHealthy(): Promise<boolean> {
    if (!config.ORDER_SERVICE_HEALTH_CHECK_ENABLED) {
      return true; // 如果禁用了健康检查，默认服务是健康的
    }
    try {
      const status = await RedisService.get(HEALTH_STATUS_KEY);
      if (status === '1') {
        return true;
      } else if (status === '0') {
        return false;
      } else {
        // Redis中没有状态 (可能首次启动，或TTL过期，或checker未运行/失败)
        // 这种情况下，可以返回一个默认的不健康状态，或者触发一次立即检查
        LoggerService.warn(
          `[HealthChecker] Health status key '${HEALTH_STATUS_KEY}' not found in Redis or value invalid. Assuming unhealthy or triggering check.`
        );
        // 为避免在首次检查前都返回不健康，可以考虑返回 currentHealthStatus (本地缓存)
        // 或者更保守地返回 false
        return currentHealthStatus; // 或者 return false;
      }
    } catch (error) {
      LoggerService.error(
        '[HealthChecker] Failed to get health status from Redis. Assuming unhealthy.',
        error
      );
      return false; // Redis 故障，保守假设不健康
    }
  }
}
