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
const HEALTH_CHECK_TIMEOUT = Math.min(config.DEFAULT_HTTP_TIMEOUT_MS, CHECK_INTERVAL - 1000); // 健康检查的超时应小于检查间隔

let intervalId: NodeJS.Timeout | null = null;
let currentHealthStatus: boolean = false; // 本地缓存一份状态，减少Redis读取（可选）

async function checkOrderStatus(): Promise<boolean> {
  LoggerService.debug('[HealthChecker] 开始订单服务健康检查...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

  try {
    const { statusCode } = await request(HEALTH_CHECK_URL, {
      method: 'GET', // 或订单服务健康检查所需的其他方法
      dispatcher: defaultHttpAgent,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (statusCode >= 200 && statusCode < 300) {
      LoggerService.debug('[HealthChecker] 订单服务健康检查成功.');
      return true;
    } else {
      LoggerService.warn(`[HealthChecker] 订单服务健康检查失败，状态码: ${statusCode}`);
      return false;
    }
  } catch (error: any) {
    clearTimeout(timeoutId); // 确保清理
    if (error.name === 'AbortError') {
      LoggerService.warn('[HealthChecker] 订单服务健康检查超时.');
    } else {
      LoggerService.warn('[HealthChecker] 订单服务健康检查失败，错误信息:', error.message);
    }
    return false;
  }
}

async function updateHealthStatusInRedis(isHealthy: boolean): Promise<void> {
  try {
    // 将状态写入Redis并设置TTL，这样即使本检测器实例挂掉，状态也会在一段时间后过期
    // 其他服务实例可以通过读取这个key来获取最新状态
    await RedisService.set(HEALTH_STATUS_KEY, isHealthy ? '1' : '0', HEALTH_STATUS_TTL);
    currentHealthStatus = isHealthy; // 更新本地缓存
    LoggerService.debug(`[HealthChecker] 更新订单服务健康状态到Redis: ${isHealthy}`);
  } catch (error) {
    LoggerService.error('[HealthChecker] 更新订单服务健康状态到Redis失败:', error);
    // 如果Redis更新失败，依赖本地缓存的 currentHealthStatus 可能不准确，但检测会继续
  }
}

async function runCheckCycle(): Promise<void> {
  if (!config.ORDER_SERVICE_HEALTH_CHECK_ENABLED) {
    LoggerService.info('[HealthChecker] 订单服务健康检查已禁用.');
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
      LoggerService.info('[HealthChecker] 订单服务健康检查已禁用. 不启动检查器.');
      // 确保在禁用时，Redis中有一个表示“健康”的值或没有值（让读取方处理默认）
      // 我们可以在禁用时，也写入一个 "1" 到 Redis，并设置TTL，或者根本不写，让 getHealthStatus 处理默认
      // 简单起见，如果禁用，我们可以在首次调用 isOrderServiceHealthy 时返回true
      await RedisService.set(HEALTH_STATUS_KEY, '1', HEALTH_STATUS_TTL * 2); // 禁用时也设置一个较长的健康状态
      return;
    }

    if (intervalId) {
      LoggerService.warn('[HealthChecker] 订单服务健康检查器已运行.');
      return;
    }
    LoggerService.info(`[HealthChecker] 启动订单服务健康检查. 间隔: ${CHECK_INTERVAL}ms`);
    // 立即执行一次检查，然后设置定时器
    await runCheckCycle();
    intervalId = setInterval(runCheckCycle, CHECK_INTERVAL);
  }

  public static stop(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      LoggerService.info('[HealthChecker] 订单服务健康检查器已停止.');
    }
  }

  /**
   * 获取当前已知的订单服务健康状态。
   * 优先从本地缓存读取，如果需要更实时可以改为直接读Redis。
   * @returns Promise<boolean> - true 如果健康，false 如果不健康或未知（例如Redis读取失败）
   */
  public static async isOrderServiceHealthy(): Promise<boolean> {
    LoggerService.debug('[HealthChecker] 检查订单服务健康状态...');
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
        LoggerService.warn(`[HealthChecker] Redis中没有健康状态键 '${HEALTH_STATUS_KEY}' 或值无效. 假设不健康或触发检查.`);
        // 为避免在首次检查前都返回不健康，可以考虑返回 currentHealthStatus (本地缓存)
        // 或者更保守地返回 false
        return currentHealthStatus; // 或者 return false;
      }
    } catch (error) {
      LoggerService.error('[HealthChecker] 从Redis获取健康状态失败. 假设不健康.', error);
      return false; // Redis 故障，保守假设不健康
    }
  }
}
