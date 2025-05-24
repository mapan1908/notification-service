import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/config';

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  // 注册插件
  await app.register(cors, {
    origin: true,
  });

  // 健康检查路由
  app.get('/health', async () => {
    return { 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'notification-service'
    };
  });

  return app;
}