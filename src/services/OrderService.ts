// src/services/OrderService.ts
import { request } from 'undici';
import { config } from '../config/config';
import LoggerService from './LoggerService';
import RedisService from './RedisService';
import { OrderInfo, StreamMessage } from '../types'; // StreamMessage 包含 token
import { defaultHttpAgent } from '@/utils/httpClient';

const ORDER_SERVICE_BASE_URL = config.ORDER_SERVICE_BASE_URL; //
// 全局备用Token，如果Stream中没有提供
const FALLBACK_ORDER_SERVICE_TOKEN = config.ORDER_SERVICE_TOKEN; //

// 假设订单服务缓存订单信息时使用的 Redis Key 前缀和模式
// 这个需要与订单服务团队约定
const SHARED_ORDER_CACHE_PREFIX = 'order_service_cache:order:'; // 示例：具体前缀需约定

class OrderService {
  /**
   * 获取订单信息。
   * 1. 尝试从共享 Redis 缓存读取。
   * 2. 如果缓存未命中，则从外部订单服务API获取。
   * @param orderId - 订单ID
   * @param storeId - 店铺ID (来自 StreamMessage，string 类型)
   * @param streamToken - 从 StreamMessage 中获取的用于API调用的认证令牌
   * @returns OrderInfo 或 null
   */
  public static async getOrderInfo(
    orderId: string,
    storeCode: string,
    streamToken?: string // 来自 StreamMessage.token
  ): Promise<OrderInfo | null> {
    const sharedCacheKey = `${SHARED_ORDER_CACHE_PREFIX}${storeCode}:${orderId}`; // Key需要与订单服务约定

    // 1. 尝试从共享 Redis 缓存获取
    try {
      const cachedOrderString = await RedisService.get(sharedCacheKey); //
      if (cachedOrderString) {
        LoggerService.debug(`[OrderService] Order info for ${orderId} (store: ${storeCode}) found in SHARED cache.`);
        try {
          const orderInfo = JSON.parse(cachedOrderString) as OrderInfo;
          // 日期转换
          orderInfo.created_at = new Date(orderInfo.created_at);
          orderInfo.updated_at = new Date(orderInfo.updated_at);
          // 基本验证，确保缓存数据结构符合预期
          if (orderInfo && orderInfo.order_id) {
            return orderInfo;
          } else {
            LoggerService.warn(`[OrderService] Invalid data structure in shared cache for ${orderId}. Proceeding to API call.`, orderInfo);
          }
        } catch (parseError) {
          LoggerService.error(`[OrderService] Failed to parse shared cached order info for ${orderId}. Proceeding to API call.`, parseError);
        }
      } else {
        LoggerService.debug(`[OrderService] Order info for ${orderId} (store: ${storeCode}) NOT found in shared cache. Calling API.`);
      }
    } catch (redisError) {
      LoggerService.error(`[OrderService] Error accessing shared Redis cache for ${orderId}. Proceeding to API call.`, redisError);
    }

    // 2. 如果缓存未命中或出错，则从API获取
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.DEFAULT_HTTP_TIMEOUT_MS);
    try {
        LoggerService.debug(`[OrderService] Fetching order info for ${orderId} (store: ${storeCode}) from API.`);
      // 示例URL，请根据订单服务API文档调整，可能需要包含 storeCode
      const requestUrl = `${ORDER_SERVICE_BASE_URL}/orders/${orderId}?store_code=${storeCode}`;
      
      // 确定使用的Token
      const effectiveToken = streamToken || FALLBACK_ORDER_SERVICE_TOKEN;
      if (!effectiveToken) {
        LoggerService.error(`[OrderService] Missing token for API call to fetch order ${orderId}. Cannot proceed.`);
        return null;
      }
      const { statusCode, body } = await request(requestUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${effectiveToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        signal: controller.signal,  
        dispatcher: defaultHttpAgent,
      });
     

      const responseText = await body.text(); // 用于日志记录

      if (statusCode === 200) {
        const responseData = JSON.parse(responseText);
        // 假设API返回 { success: true, data: OrderInfo } 或直接是 OrderInfo
        // 需要根据订单服务实际的API响应结构进行调整
        const orderInfo = responseData.data || responseData as OrderInfo;

        if (!orderInfo || !orderInfo.order_id) { // 基本验证
            LoggerService.warn(`[OrderService] Invalid order data received from API for ${orderId}. API Response:`, responseData);
            return null;
        }
        
        // 日期转换
        orderInfo.created_at = new Date(orderInfo.created_at);
        orderInfo.updated_at = new Date(orderInfo.updated_at);

        // 注意：通知服务本身不再写入这个订单信息的缓存。
        // 如果需要，订单服务在提供API响应时，应确保其自身已更新/写入了共享缓存。

        return orderInfo;
      } else {
        LoggerService.error(`[OrderService] Failed to fetch order info for ${orderId} from API. Status: ${statusCode}`, {
          url: requestUrl,
          response: responseText,
        });
        return null;
      }
    } catch (error) {
      LoggerService.error(`[OrderService] Error getting order info for ${orderId} from API:`, error);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export default OrderService;