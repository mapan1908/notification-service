import { FastifyInstance } from 'fastify';
import ConfigService from '../services/ConfigService';
import LoggerService from '../services/LoggerService';
import { ChannelType, OrderType, NotificationEventType } from '../types';

export async function configRoutes(fastify: FastifyInstance) {
  // 获取商家通知渠道配置
  fastify.get('/stores/:storeId/channels', async (request, reply) => {
    const { storeId } = request.params as { storeId: string };
    const { orderType } = request.query as { orderType?: OrderType };

    const configs = await ConfigService.getStoreChannelConfigs(
      parseInt(storeId), 
      orderType
    );

    return {
      success: true,
      data: configs,
    };
  });

  // 创建通知渠道配置
  fastify.post('/stores/:storeId/channels', async (request, reply) => {
    const { storeId } = request.params as { storeId: string };
    const body = request.body as {
      order_type: OrderType;
      channel_type: ChannelType;
      channel_config: Record<string, any>;
      enabled?: boolean;
    };

    // 验证配置格式
    const validation = ConfigService.validateChannelConfig(
      body.channel_type, 
      body.channel_config
    );

    if (!validation.valid) {
      return reply.status(400).send({
        success: false,
        message: 'Invalid channel configuration',
        errors: validation.errors,
      });
    }

    const id = await ConfigService.createChannelConfig({
      store_id: parseInt(storeId),
      ...body,
    });

    if (id) {
      return reply.status(201).send({
        success: true,
        data: { id },
        message: 'Channel configuration created successfully',
      });
    }

    return reply.status(500).send({
      success: false,
      message: 'Failed to create channel configuration',
    });
  });

  // 更新通知渠道配置
  fastify.put('/channels/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      channel_config?: Record<string, any>;
      enabled?: boolean;
    };

    const success = await ConfigService.updateChannelConfig(parseInt(id), body);

    if (success) {
      return {
        success: true,
        message: 'Channel configuration updated successfully',
      };
    }

    return reply.status(500).send({
      success: false,
      message: 'Failed to update channel configuration',
    });
  });

  // 创建微信模板配置
  fastify.post('/stores/:storeId/wechat-templates', async (request, reply) => {
    const { storeId } = request.params as { storeId: string };
    const body = request.body as {
      template_id: string;
      template_name: string;
      event_type: NotificationEventType;
      field_mapping: Record<string, any>;
      enabled?: boolean;
    };

    const id = await ConfigService.createWechatTemplate({
      store_id: parseInt(storeId),
      ...body,
    });

    if (id) {
      return reply.status(201).send({
        success: true,
        data: { id },
        message: 'Wechat template created successfully',
      });
    }

    return reply.status(500).send({
      success: false,
      message: 'Failed to create wechat template',
    });
  });

  // 测试配置
  fastify.post('/test-config', async (request, reply) => {
    const body = request.body as {
      channel_type: ChannelType;
      channel_config: Record<string, any>;
    };

    const validation = ConfigService.validateChannelConfig(
      body.channel_type, 
      body.channel_config
    );

    return {
      success: validation.valid,
      errors: validation.errors,
      message: validation.valid ? 'Configuration is valid' : 'Configuration validation failed',
    };
  });
}