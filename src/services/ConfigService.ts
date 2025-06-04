import DatabaseService from './DatabaseService';
import RedisService from './RedisService';
import LoggerService from './LoggerService';
import { NotificationChannelConfig, ChannelType, OrderType, NotificationEventType, WechatTemplateConfig } from '../types';

class ConfigService {
  private static readonly CACHE_PREFIX = 'notification_config:';
  private static readonly CACHE_TTL = 300; // 5分钟缓存

  // 获取商家通知渠道配置
  public static async getStoreChannelConfigs(storeCode: string, orderType?: OrderType): Promise<NotificationChannelConfig[]> {
    const cacheKey = `${this.CACHE_PREFIX}channels:${storeCode}:${orderType || 'all'}`;

    try {
      // 先从缓存获取
      const cached = await RedisService.get(cacheKey);
      if (cached) {
        LoggerService.debug('Store channel configs loaded from cache', {
          storeCode,
          orderType,
        });
        return JSON.parse(cached);
      }

      // 从数据库获取
      let query = `
        SELECT a.id, b.store_code, a.order_type, a.channel_type, a.channel_config, a.enabled, a.created_at, a.updated_at
        FROM notification_channels as a left join stores as b on a.store_id = b.id
        WHERE b.store_code = ? AND a.enabled = 1
      `;

      const params: any[] = [storeCode];

      if (orderType) {
        query += ' AND a.order_type = ?';
        params.push(orderType);
      }

      query += ' ORDER BY id';

      const configs = await DatabaseService.query<NotificationChannelConfig[]>(query, params);

      // 写入缓存
      await RedisService.setex(cacheKey, this.CACHE_TTL, JSON.stringify(configs));

      LoggerService.debug('Store channel configs loaded from database', {
        storeCode,
        orderType,
        configCount: configs.length,
      });

      return configs;
    } catch (error) {
      LoggerService.error('Failed to get store channel configs', {
        storeCode,
        orderType,
        error,
      });
      return [];
    }
  }

  // 获取特定渠道配置
  public static async getChannelConfig(storeCode: string, orderType: OrderType, channelType: ChannelType): Promise<NotificationChannelConfig | null> {
    try {
      const query = `
        SELECT a.id, b.store_code, a.order_type, a.channel_type, a.channel_config, a.enabled, a.created_at, a.updated_at
        FROM notification_channels as a left join stores as b on a.store_id = b.id
        WHERE b.store_code = ? AND a.order_type = ? AND a.channel_type = ? AND a.enabled = 1
        LIMIT 1
      `;

      const configs = await DatabaseService.query<NotificationChannelConfig[]>(query, [storeCode, orderType, channelType]);

      return configs.length > 0 ? configs[0] : null;
    } catch (error) {
      LoggerService.error('Failed to get channel config', {
        storeCode,
        orderType,
        channelType,
        error,
      });
      return null;
    }
  }

  // 获取微信模板配置
  public static async getWechatTemplateConfig(storeCode: string, eventType: NotificationEventType): Promise<WechatTemplateConfig | null> {
    const cacheKey = `${this.CACHE_PREFIX}wechat_template:${storeCode}:${eventType}`;

    try {
      // 先从缓存获取
      const cached = await RedisService.get(cacheKey);
      if (cached) {
        LoggerService.debug('Wechat template config loaded from cache', {
          storeCode,
          eventType,
        });
        return JSON.parse(cached);
      }

      // 从数据库获取
      const query = `
          SELECT a.id, b.store_code, a.template_id, a.template_name, a.event_type, a.field_mapping, a.miniprogram_page, a.url, a.enabled, a.created_at, a.updated_at
        FROM wechat_template_configs as a left join stores as b on a.store_id = b.id
        WHERE  a.event_type = ? AND a.enabled = 1
        LIMIT 1
      `;

      // const templates = await DatabaseService.query<WechatTemplateConfig[]>(query, [storeCode, eventType]);
      const templates = await DatabaseService.query<WechatTemplateConfig[]>(query, [eventType]);

      const template = templates.length > 0 ? templates[0] : null;

      // 写入缓存
      if (template) {
        await RedisService.setex(cacheKey, this.CACHE_TTL, JSON.stringify(template));
      }

      LoggerService.debug('Wechat template config loaded from database', {
        storeCode,
        eventType,
        found: !!template,
      });

      return template;
    } catch (error) {
      LoggerService.error('Failed to get wechat template config', {
        storeCode,
        eventType,
        error,
      });
      return null;
    }
  }

  // 清除商家配置缓存
  public static async clearStoreCache(storeCode: string): Promise<void> {
    try {
      const pattern = `${this.CACHE_PREFIX}channels:${storeCode}:*`;

      // 注意：这是一个简化的实现，生产环境中可能需要更复杂的缓存清除策略
      const keys = [`${this.CACHE_PREFIX}channels:${storeCode}:all`, `${this.CACHE_PREFIX}channels:${storeCode}:${OrderType.DINE_IN}`, `${this.CACHE_PREFIX}channels:${storeCode}:${OrderType.PICKUP}`, `${this.CACHE_PREFIX}channels:${storeCode}:${OrderType.DELIVERY}`];

      for (const key of keys) {
        await RedisService.del(key);
      }

      LoggerService.debug('Store cache cleared', { storeCode });
    } catch (error) {
      LoggerService.error('Failed to clear store cache', { storeCode, error });
    }
  }

  // 清除微信模板缓存
  public static async clearWechatTemplateCache(storeCode: string, eventType: NotificationEventType): Promise<void> {
    try {
      const key = `${this.CACHE_PREFIX}wechat_template:${storeCode}:${eventType}`;
      await RedisService.del(key);

      LoggerService.debug('Wechat template cache cleared', {
        storeCode,
        eventType,
      });
    } catch (error) {
      LoggerService.error('Failed to clear wechat template cache', {
        storeCode,
        eventType,
        error,
      });
    }
  }

  // 验证配置格式
  public static validateChannelConfig(channelType: ChannelType, config: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    switch (channelType) {
      case ChannelType.WECHAT_MP:
        if (!config.app_id) errors.push('app_id is required');
        if (!config.app_secret) errors.push('app_secret is required');
        if (!config.template_id) errors.push('template_id is required');
        if (!config.open_id) errors.push('open_id is required');
        break;

      case ChannelType.WECOM_BOT:
        if (!config.webhook_url) errors.push('webhook_url is required');
        if (!config.webhook_url.includes('qyapi.weixin.qq.com')) {
          errors.push('invalid webhook_url format');
        }
        break;

      case ChannelType.CLOUD_SPEAKER:
        if (!config.api_url) errors.push('api_url is required');
        if (!config.device_id) errors.push('device_id is required');
        break;

      default:
        errors.push(`unsupported channel type: ${channelType}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export default ConfigService;
