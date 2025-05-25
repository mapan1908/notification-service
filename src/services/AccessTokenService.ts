// src/services/AccessTokenService.ts
import { request } from 'undici';
import { config as appConfig } from '../config/config'; // App-level config
import LoggerService from './LoggerService';
import RedisService from './RedisService';
import { defaultHttpAgent } from '../utils/httpClient';

const ACCESS_TOKEN_CACHE_PREFIX = 'wechat_mp_access_token:';
// 微信 Access Token 有效期为 7200 秒 (2小时)
// 我们缓存时，可以稍微提前一点过期，例如 7000 秒，以防止临界点问题
const ACCESS_TOKEN_CACHE_TTL_SECONDS = 7000;

interface WechatAccessTokenResponse {
  access_token?: string;
  expires_in?: number; // 通常是 7200
  errcode?: number;
  errmsg?: string;
}

interface ChannelSpecificWechatConfig {
  app_id: string;
  app_secret: string;
}

class AccessTokenService {
  /**
   * 获取微信公众号的 Access Token。
   * 会优先从 Redis 缓存读取，如果缓存中没有或已过期，则从微信API获取并缓存。
   * @param channelWechatConfig - 包含 app_id 和 app_secret 的对象
   * @returns Promise<string | null> - Access Token 或 null (获取失败时)
   */
  public static async getAccessToken(channelWechatConfig: ChannelSpecificWechatConfig): Promise<string | null> {
    const { app_id, app_secret } = channelWechatConfig;

    if (!app_id || !app_secret) {
      LoggerService.error('[AccessTokenService] AppID or AppSecret is 缺失 for getAccessToken.', { app_id });
      return null;
    }

    const cacheKey = `${ACCESS_TOKEN_CACHE_PREFIX}${app_id}`;

    // 1. 尝试从缓存获取
    try {
      const cachedToken = await RedisService.get(cacheKey);
      if (cachedToken) {
        LoggerService.debug(`[AccessTokenService] Access token for app_id cache 中找到 ${app_id}.`);
        return cachedToken;
      }
    } catch (cacheError) {
      LoggerService.error(`[AccessTokenService] 错误 while fetching access token from cache for app_id ${app_id}.`, { error: cacheError });
      // 即使缓存读取失败，也继续尝试从API获取
    }

    LoggerService.info(`[AccessTokenService] Access token for app_id ${app_id}  从缓存中找不到或已过期，从微信API获取.`);

    // 2. 从微信API获取
    // API文档: https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Get_access_token.html
    const requestUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${app_id}&secret=${app_secret}`;

    let timeoutId: NodeJS.Timeout | undefined;
    const controller = new AbortController();

    try {
      timeoutId = setTimeout(() => {
        LoggerService.warn(`[AccessTokenService] WeChat token API request for app_id ${app_id} is aborting due to timeout.`);
        controller.abort();
      }, appConfig.DEFAULT_HTTP_TIMEOUT_MS); // 使用全局HTTP超时配置

      const { statusCode, body } = await request(requestUrl, {
        method: 'GET',
        dispatcher: defaultHttpAgent, // 假设您已创建并导入 defaultHttpAgent
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });
      clearTimeout(timeoutId);

      const responseText = await body.text();
      const responseData = JSON.parse(responseText) as WechatAccessTokenResponse;

      if (statusCode === 200 && responseData.access_token && responseData.expires_in) {
        LoggerService.info(`[AccessTokenService] Successfully fetched new access token for app_id ${app_id}.`);
        // 3. 写入缓存
        // expires_in 是秒，RedisService.set 的 ttl 通常也是秒
        // 我们使用一个稍短于微信官方的过期时间
        await RedisService.set(cacheKey, responseData.access_token, ACCESS_TOKEN_CACHE_TTL_SECONDS);
        LoggerService.debug(`[AccessTokenService] Access token for app_id ${app_id} cached for ${ACCESS_TOKEN_CACHE_TTL_SECONDS}s.`);
        return responseData.access_token;
      } else {
        LoggerService.error(`[AccessTokenService] Failed to fetch access token for app_id ${app_id}. Status: ${statusCode}`, {
          response: responseData, // 包含 errcode 和 errmsg
        });
        return null;
      }
    } catch (error: any) {
      if (timeoutId && !controller.signal.aborted) {
        clearTimeout(timeoutId);
      }
      if (error.name === 'AbortError') {
        LoggerService.error(`[AccessTokenService] WeChat token API request for app_id ${app_id} timed out.`);
      } else {
        LoggerService.error(`[AccessTokenService] Exception while fetching access token for app_id ${app_id}:`, {
          error: error.message,
          stack: error.stack,
        });
      }
      return null;
    }
  }
}

export default AccessTokenService;
