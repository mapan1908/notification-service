import DatabaseService from './DatabaseService';
import RedisService from './RedisService';
import LoggerService from './LoggerService';
import { 
  NotificationChannelConfig, 
  ChannelType, 
  OrderType,
  NotificationEventType 
} from '../types';

interface WechatTemplateConfig {
  id: number;
  store_id: number;
  template_id: string;
  template_name: string;
  event_type: NotificationEventType;
  field_mapping: Record<string, any>;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

class ConfigService {
  private static readonly CACHE_PREFIX = 'notification_config:';
  private static readonly CACHE_TTL = 300; // 5分钟缓存

  // 获取商家通知渠道配置
  public static async getStoreChannelConfigs(
    storeId: number, 
    orderType?: OrderType
  ): Promise<NotificationChannelConfig[]> {
    const cacheKey = `${this.CACHE_PREFIX}channels:${storeId}:${orderType || 'all'}`;
    
    try {
      // 先从缓存获取
      const cached = await RedisService.get(cacheKey);
      if (cached) {
        LoggerService.debug('Store channel configs loaded from cache', { storeId, orderType });
        return JSON.parse(cached);
      }

      // 从数据库获取
      let query = `
        SELECT id, store_id, order_type, channel_type, channel_config, enabled, created_at, updated_at
        FROM notification_channels 
        WHERE store_id = ? AND enabled = 1
      `;
      
      const params: any[] = [storeId];
      
      if (orderType) {
        query += ' AND order_type = ?';
        params.push(orderType);
      }
      
      query += ' ORDER BY id';

      const configs = await DatabaseService.query<NotificationChannelConfig[]>(query, params);

      // 写入缓存
      await RedisService.setex(cacheKey, this.CACHE_TTL, JSON.stringify(configs));

      LoggerService.debug('Store channel configs loaded from database', { 
        storeId, 
        orderType, 
        configCount: configs.length 
      });

      return configs;
    } catch (error) {
      LoggerService.error('Failed to get store channel configs', { storeId, orderType, error });
      return [];
    }
  }

  // 获取特定渠道配置
  public static async getChannelConfig(
    storeId: number,
    orderType: OrderType,
    channelType: ChannelType
  ): Promise<NotificationChannelConfig | null> {
    try {
      const query = `
        SELECT id, store_id, order_type, channel_type, channel_config, enabled, created_at, updated_at
        FROM notification_channels 
        WHERE store_id = ? AND order_type = ? AND channel_type = ? AND enabled = 1
        LIMIT 1
      `;

      const configs = await DatabaseService.query<NotificationChannelConfig[]>(
        query, 
        [storeId, orderType, channelType]
      );

      return configs.length > 0 ? configs[0] : null;
    } catch (error) {
      LoggerService.error('Failed to get channel config', { 
        storeId, 
        orderType, 
        channelType, 
        error 
      });
      return null;
    }
  }

  // 获取微信模板配置
  public static async getWechatTemplateConfig(
    storeId: number,
    eventType: NotificationEventType
  ): Promise<WechatTemplateConfig | null> {
    const cacheKey = `${this.CACHE_PREFIX}wechat_template:${storeId}:${eventType}`;

    try {
      // 先从缓存获取
      const cached = await RedisService.get(cacheKey);
      if (cached) {
        LoggerService.debug('Wechat template config loaded from cache', { storeId, eventType });
        return JSON.parse(cached);
      }

      // 从数据库获取
      const query = `
        SELECT id, store_id, template_id, template_name, event_type, field_mapping, enabled, created_at, updated_at
        FROM wechat_templates 
        WHERE store_id = ? AND event_type = ? AND enabled = 1
        LIMIT 1
      `;

      const templates = await DatabaseService.query<WechatTemplateConfig[]>(
        query, 
        [storeId, eventType]
      );

      const template = templates.length > 0 ? templates[0] : null;

      // 写入缓存
      if (template) {
        await RedisService.setex(cacheKey, this.CACHE_TTL, JSON.stringify(template));
      }

      LoggerService.debug('Wechat template config loaded from database', { 
        storeId, 
        eventType, 
        found: !!template 
      });

      return template;
    } catch (error) {
      LoggerService.error('Failed to get wechat template config', { 
        storeId, 
        eventType, 
        error 
      });
      return null;
    }
  }

  // 创建通知渠道配置
  public static async createChannelConfig(data: {
    store_id: number;
    order_type: OrderType;
    channel_type: ChannelType;
    channel_config: Record<string, any>;
    enabled?: boolean;
  }): Promise<number | null> {
    try {
      const query = `
        INSERT INTO notification_channels (store_id, order_type, channel_type, channel_config, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const result = await DatabaseService.execute(query, [
        data.store_id,
        data.order_type,
        data.channel_type,
        JSON.stringify(data.channel_config),
        data.enabled ?? true,
      ]);

      const insertId = (result as any).insertId;

      // 清除相关缓存
      await this.clearStoreCache(data.store_id);

      LoggerService.info('Channel config created', { 
        id: insertId,
        storeId: data.store_id,
        orderType: data.order_type,
        channelType: data.channel_type,
      });

      return insertId;
    } catch (error) {
      LoggerService.error('Failed to create channel config', { data, error });
      return null;
    }
  }

  // 更新通知渠道配置
  public static async updateChannelConfig(
    id: number,
    data: {
      channel_config?: Record<string, any>;
      enabled?: boolean;
    }
  ): Promise<boolean> {
    try {
      const setParts: string[] = [];
      const params: any[] = [];

      if (data.channel_config !== undefined) {
        setParts.push('channel_config = ?');
        params.push(JSON.stringify(data.channel_config));
      }

      if (data.enabled !== undefined) {
        setParts.push('enabled = ?');
        params.push(data.enabled);
      }

      if (setParts.length === 0) {
        return false;
      }

      setParts.push('updated_at = NOW()');
      params.push(id);

      const query = `UPDATE notification_channels SET ${setParts.join(', ')} WHERE id = ?`;

      const result = await DatabaseService.execute(query, params);
      const affectedRows = (result as any).affectedRows;

      if (affectedRows > 0) {
        // 获取 store_id 用于清除缓存
        const storeQuery = 'SELECT store_id FROM notification_channels WHERE id = ?';
        const storeResult = await DatabaseService.query<{store_id: number}[]>(storeQuery, [id]);
        
        if (storeResult.length > 0) {
          await this.clearStoreCache(storeResult[0].store_id);
        }

        LoggerService.info('Channel config updated', { id, data });
        return true;
      }

      return false;
    } catch (error) {
      LoggerService.error('Failed to update channel config', { id, data, error });
      return false;
    }
  }

  // 创建微信模板配置
  public static async createWechatTemplate(data: {
    store_id: number;
    template_id: string;
    template_name: string;
    event_type: NotificationEventType;
    field_mapping: Record<string, any>;
    enabled?: boolean;
  }): Promise<number | null> {
    try {
      const query = `
        INSERT INTO wechat_templates (store_id, template_id, template_name, event_type, field_mapping, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const result = await DatabaseService.execute(query, [
        data.store_id,
        data.template_id,
        data.template_name,
        data.event_type,
        JSON.stringify(data.field_mapping),
        data.enabled ?? true,
      ]);

      const insertId = (result as any).insertId;

      // 清除相关缓存
      await this.clearWechatTemplateCache(data.store_id, data.event_type);

      LoggerService.info('Wechat template created', { 
        id: insertId,
        storeId: data.store_id,
        templateId: data.template_id,
        eventType: data.event_type,
      });

      return insertId;
    } catch (error) {
      LoggerService.error('Failed to create wechat template', { data, error });
      return null;
    }
  }

  // 清除商家配置缓存
  public static async clearStoreCache(storeId: number): Promise<void> {
    try {
      const pattern = `${this.CACHE_PREFIX}channels:${storeId}:*`;
      
      // 注意：这是一个简化的实现，生产环境中可能需要更复杂的缓存清除策略
      const keys = [
        `${this.CACHE_PREFIX}channels:${storeId}:all`,
        `${this.CACHE_PREFIX}channels:${storeId}:${OrderType.DINE_IN}`,
        `${this.CACHE_PREFIX}channels:${storeId}:${OrderType.PICKUP}`,
        `${this.CACHE_PREFIX}channels:${storeId}:${OrderType.DELIVERY}`,
      ];

      for (const key of keys) {
        await RedisService.del(key);
      }

      LoggerService.debug('Store cache cleared', { storeId });
    } catch (error) {
      LoggerService.error('Failed to clear store cache', { storeId, error });
    }
  }

  // 清除微信模板缓存
  public static async clearWechatTemplateCache(
    storeId: number, 
    eventType: NotificationEventType
  ): Promise<void> {
    try {
      const key = `${this.CACHE_PREFIX}wechat_template:${storeId}:${eventType}`;
      await RedisService.del(key);

      LoggerService.debug('Wechat template cache cleared', { storeId, eventType });
    } catch (error) {
      LoggerService.error('Failed to clear wechat template cache', { storeId, eventType, error });
    }
  }

  // 验证配置格式
  public static validateChannelConfig(
    channelType: ChannelType, 
    config: Record<string, any>
  ): { valid: boolean; errors: string[] } {
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