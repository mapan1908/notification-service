// src/services/OrderService.ts
import { request } from 'undici';
import { config } from '../config/config';
import LoggerService from './LoggerService';
import RedisService from './RedisService';
import { OrderInfo, StreamMessage } from '../types'; // 确保 OrderInfo 和 StreamMessage 中店铺标识一致
import { defaultHttpAgent } from '../utils/httpClient';
import { OrderServiceHealthChecker } from './OrderServiceHealthChecker'; // 引入健康检查器

// CriticalOrderInfoError 应该在 types/index.ts 中定义或从这里导出，以供 NotificationEngine 使用
export class CriticalOrderInfoError extends Error {
  public readonly originalError?: any;
  public readonly attemptsMade: number;

  constructor(message: string, attemptsMade: number, originalError?: any) {
    super(message);
    this.name = 'CriticalOrderInfoError';
    this.attemptsMade = attemptsMade;
    this.originalError = originalError;
    Object.setPrototypeOf(this, CriticalOrderInfoError.prototype);
  }
}

const ORDER_SERVICE_BASE_URL = config.ORDER_SERVICE_BASE_URL;
const FALLBACK_ORDER_SERVICE_TOKEN = config.ORDER_SERVICE_TOKEN;
const SHARED_ORDER_CACHE_PREFIX = 'shared_cache:order_info:'; // 与订单服务约定

class OrderService {
  /**
   * 内部方法：执行单次从API获取订单信息的尝试。
   */
  private static async _fetchOrderInfoFromApiOnce(
    orderId: string,
    storeCode: string, // 统一使用 storeCode (string)
    apiToken?: string,
    attemptNumber?: number
  ): Promise<OrderInfo | null> {
    const logPrefix = `[OrderService._fetchOnce order:${orderId} storeCode:${storeCode} attempt:${attemptNumber || 1}]`;
    LoggerService.debug(`${logPrefix} Attempting API call.`);

    const requestUrl = `${ORDER_SERVICE_BASE_URL}/orders/${orderId}?store_code=${storeCode}`; // API端点应使用 storeCode
    const effectiveToken = apiToken || FALLBACK_ORDER_SERVICE_TOKEN;

    if (!effectiveToken) {
      LoggerService.error(`${logPrefix} Missing API token.`);
      throw new Error('API token is missing for OrderService request.');
    }

    let timeoutId: NodeJS.Timeout | undefined;
    const controller = new AbortController();

    try {
      timeoutId = setTimeout(() => {
        LoggerService.warn(
          `${logPrefix} API request is aborting due to timeout (${config.DEFAULT_HTTP_TIMEOUT_MS}ms).`
        );
        controller.abort();
      }, config.DEFAULT_HTTP_TIMEOUT_MS);

      const { statusCode, body } = await request(requestUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${effectiveToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: controller.signal,
        dispatcher: defaultHttpAgent,
      });
      clearTimeout(timeoutId); // 清除超时，因为请求已收到响应（无论成功与否）

      const responseText = await body.text();

      if (statusCode === 200) {
        const responseData = JSON.parse(responseText);
        const orderInfoData = responseData.data || responseData;

        if (
          orderInfoData &&
          typeof orderInfoData === 'object' &&
          orderInfoData.order_id // 假设API返回order_id
        ) {
          // 类型转换和数据整理
          // 确保 OrderInfo 类型定义与此处的字段和类型匹配 (特别是 store_code)
          const orderInfo: OrderInfo = {
            ...orderInfoData,
            order_id: String(orderInfoData.order_id),
            // 假设 OrderInfo 类型中有 store_code: string
            // 如果 OrderInfo 仍然是 store_id: number，则需要从 orderInfoData.store_id 转换
            // 这里我们根据全局使用 storeCode 的前提，假设 orderInfoData 中有 store_code
            // 或者 orderInfoData.store_id 可以映射到 storeCode
            // store_id: Number(orderInfoData.store_id), // 保持原样，但需与 OrderInfo 定义一致
            store_code: String(orderInfoData.store_code || storeCode), // 确保 OrderInfo 有 store_code
            user_id: Number(orderInfoData.user_id),
            total_amount: parseFloat(orderInfoData.total_amount),
            payable_amount: parseFloat(orderInfoData.payable_amount),
            created_at: new Date(orderInfoData.created_at),
            updated_at: new Date(orderInfoData.updated_at),
          };
          LoggerService.debug(
            `${logPrefix} Successfully fetched and parsed order info from API.`
          );
          return orderInfo;
        } else {
          LoggerService.warn(
            `${logPrefix} API returned 200 but data is invalid or missing order_id. Response:`,
            responseData
          );
          return null; // 数据无效
        }
      } else if (statusCode === 404) {
        LoggerService.warn(
          `${logPrefix} API returned 404 Not Found. Order likely does not exist.`
        );
        return null; // 订单不存在
      } else if (statusCode >= 500) {
        LoggerService.error(
          `${logPrefix} API server error. Status: ${statusCode}. Response: ${responseText}`
        );
        throw new Error(`Order API server error: ${statusCode}`); // 抛出以触发快速重试
      } else {
        LoggerService.warn(
          `${logPrefix} API client error (e.g., 4xx other than 404). Status: ${statusCode}. Response: ${responseText}`
        );
        return null; // 其他客户端错误，通常不重试
      }
    } catch (error: any) {
      // 如果 timeoutId 存在且 AbortController 触发了 abort，error.name 会是 'AbortError'
      // 确保在 finally 之前处理或记录特定错误类型
      if (timeoutId && !controller.signal.aborted) {
        // 如果不是由我们的AbortController中止的，也清理
        clearTimeout(timeoutId);
      }
      if (error.name === 'AbortError') {
        LoggerService.error(`${logPrefix} API request timed out.`);
      } else {
        LoggerService.error(
          `${logPrefix} API request failed: ${error.message}`
        );
      }
      throw error; // 将错误向上抛，由 getOrderInfo 的快速重试逻辑处理
    }
    // finally 块在您之前的代码中是正确的，这里省略以突出改动
    // 但实际代码中 _fetchOrderInfoFromApiOnce 应该有自己的 finally 来 clearTimeout
  }

  public static async getOrderInfo(
    orderId: string,
    storeCode: string, // 统一使用 storeCode (string)
    streamToken?: string,
    originalEventTimestamp?: number // Unix ms
  ): Promise<OrderInfo> {
    const logPrefix = `[OrderService.getOrderInfo order:${orderId} storeCode:${storeCode}]`;
    let attemptsMade = 0;

    // 1. 检查初始时效性
    if (
      originalEventTimestamp &&
      Date.now() - originalEventTimestamp >
        config.ORDER_SERVICE_MAX_NOTIFICATION_AGE_MS
    ) {
      LoggerService.warn(
        `${logPrefix} 通知已过时 (event ts: ${originalEventTimestamp}). 终止.`
      );
      throw new CriticalOrderInfoError(
        `通知已过时 (超过 ${config.ORDER_SERVICE_MAX_NOTIFICATION_AGE_MS / 1000 / 60} 分钟), order ${orderId}.`,
        attemptsMade
      );
    }

    // 2. 尝试从共享 Redis 缓存获取
    const sharedCacheKey = `${SHARED_ORDER_CACHE_PREFIX}${storeCode}:${orderId}`;
    try {
      const cachedOrderString = await RedisService.get(sharedCacheKey);
      if (cachedOrderString) {
        const orderInfoFromCache = JSON.parse(cachedOrderString) as OrderInfo;
        // 假设 OrderInfo 类型已更新为包含 store_code: string
        if (
          orderInfoFromCache &&
          orderInfoFromCache.order_id &&
          orderInfoFromCache.store_code === storeCode
        ) {
          orderInfoFromCache.created_at = new Date(
            orderInfoFromCache.created_at
          );
          orderInfoFromCache.updated_at = new Date(
            orderInfoFromCache.updated_at
          );
          LoggerService.info(`${logPrefix} 从共享缓存中获取到订单信息.`);
          return orderInfoFromCache;
        } else {
          LoggerService.warn(
            `${logPrefix} 共享缓存中数据无效或店铺不匹配, ${sharedCacheKey}. 将尝试API.`
          );
        }
      } else {
        LoggerService.debug(
          `${logPrefix} 共享缓存中没有找到订单信息. 将尝试API.`
        );
      }
    } catch (redisError: any) {
      LoggerService.warn(
        `${logPrefix} 访问共享Redis缓存失败, ${sharedCacheKey}. 将尝试API. 错误: ${redisError.message}`
      );
    }

    // 3. 检查订单服务健康状态 (集成健康检查器)
    if (config.ORDER_SERVICE_HEALTH_CHECK_ENABLED) {
      const isHealthy = await OrderServiceHealthChecker.isOrderServiceHealthy();
      if (!isHealthy) {
        LoggerService.warn(
          `${logPrefix} 订单服务当前标记为不健康. 快速失败并不ACK消息.`
        );
        throw new CriticalOrderInfoError(
          `订单服务 (${ORDER_SERVICE_BASE_URL}) 当前不健康，获取订单 ${orderId} 失败.`,
          attemptsMade // 0 次API尝试
        );
      }
      LoggerService.debug(`${logPrefix} 订单服务健康检查通过.`);
    }

    // 4. API 调用与快速重试 (不再有长时间的梯度延迟)
    let lastError: any = null;
    const quickRetryAttempts = config.ORDER_SERVICE_QUICK_RETRY_ATTEMPTS; // 例如 1 或 2

    for (attemptsMade = 1; attemptsMade <= quickRetryAttempts; attemptsMade++) {
      const currentAttemptLogPrefix = `${logPrefix} API_QuickAttempt-${attemptsMade}/${quickRetryAttempts}`;
      LoggerService.info(`${currentAttemptLogPrefix} 尝试从API获取订单信息.`);

      // 4a. 每次尝试前再次检查时效性
      if (
        originalEventTimestamp &&
        Date.now() - originalEventTimestamp >
          config.ORDER_SERVICE_MAX_NOTIFICATION_AGE_MS
      ) {
        LoggerService.warn(
          `${currentAttemptLogPrefix} 通知在快速重试期间已过时 (event ts: ${originalEventTimestamp}). 终止.`
        );
        throw new CriticalOrderInfoError(
          `通知已过时, order ${orderId}.`,
          attemptsMade - 1, // 之前的尝试次数
          lastError
        );
      }

      try {
        const orderInfoFromApi = await this._fetchOrderInfoFromApiOnce(
          orderId,
          storeCode,
          streamToken,
          attemptsMade
        );
        if (orderInfoFromApi) {
          LoggerService.info(
            `${currentAttemptLogPrefix} 从API获取订单信息成功.`
          );
          return orderInfoFromApi;
        }
        // 如果 _fetchOrderInfoFromApiOnce 返回 null (例如 404, 或业务上无效数据)
        // 这被视为确定性失败，不应因这个原因继续重试。
        LoggerService.warn(
          `${currentAttemptLogPrefix} API返回null (例如, 订单不存在或数据无效). 判定为关键失败.`
        );
        throw new CriticalOrderInfoError(
          `API明确返回无法获取订单数据 (如404或无效数据) for order ${orderId}.`,
          attemptsMade,
          new Error('API indicated data not found or invalid') // 构造一个错误对象
        );
      } catch (error: any) {
        lastError = error;
        LoggerService.warn(
          `${currentAttemptLogPrefix} API快速尝试失败. 错误: ${error.message}`
        );
        if (attemptsMade === quickRetryAttempts) {
          // 这是最后一次快速尝试也失败了
          LoggerService.error(
            `${currentAttemptLogPrefix} 所有 ${quickRetryAttempts} 次API快速尝试均失败, order ${orderId}.`
          );
          throw new CriticalOrderInfoError(
            `从API获取订单信息失败 (所有快速尝试均失败), order ${orderId}.`,
            attemptsMade,
            lastError
          );
        }
      }

      // 准备下一次快速重试 (如果不是最后一次)
      if (attemptsMade < quickRetryAttempts) {
        const delay = config.ORDER_SERVICE_QUICK_RETRY_DELAY_MS;
        LoggerService.info(
          `${currentAttemptLogPrefix} 等待 ${delay}ms 后进行下一次API快速尝试 (${attemptsMade + 1}/${quickRetryAttempts}).`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // 防御性代码，理论上不应执行到这里
    LoggerService.error(`${logPrefix} 意外退出快速重试循环, order ${orderId}.`);
    throw new CriticalOrderInfoError(
      `从API获取订单信息失败 (意外退出重试循环), order ${orderId}.`,
      attemptsMade, // 应该是 quickRetryAttempts
      lastError
    );
  }
}

export default OrderService;
