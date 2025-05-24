import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/config';
import DatabaseService from './services/DatabaseService';
import RedisService from './services/RedisService';
import LoggerService from './services/LoggerService';
import { configRoutes } from './routes/config';
export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: false, // 禁用 Fastify 内置日志，使用我们的日志系统
  });

  // 注册插件
  await app.register(cors, {
    origin: true,
  });
  // 注册路由
await app.register(configRoutes, { prefix: '/api' });
  // 添加请求日志中间件
  app.addHook('onRequest', async (request, reply) => {
    // 在 request 对象上添加开始时间
    (request as any).startTime = Date.now();
    
    LoggerService.info('Incoming request', {
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  });

  // 添加响应日志中间件
  app.addHook('onResponse', async (request, reply) => {
    const startTime = (request as any).startTime || Date.now();
    const responseTime = Date.now() - startTime;
    
    LoggerService.info('Response sent', {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: `${responseTime}ms`,
    });
  });

  // 错误处理中间件
  app.setErrorHandler(async (error, request, reply) => {
    LoggerService.error('Request error', {
      method: request.method,
      url: request.url,
      error: error.message,
      stack: error.stack,
    });

    // 根据错误类型返回不同的状态码
    let statusCode = 500;
    let message = 'Internal Server Error';

    if (error.validation) {
      statusCode = 400;
      message = 'Validation Error';
    } else if (error.statusCode) {
      statusCode = error.statusCode;
      message = error.message;
    }

    return reply.status(statusCode).send({
      error: true,
      message,
      statusCode,
      timestamp: new Date().toISOString(),
    });
  });

  // 404 处理
  app.setNotFoundHandler(async (request, reply) => {
    LoggerService.warn('Route not found', {
      method: request.method,
      url: request.url,
      ip: request.ip,
    });

    return reply.status(404).send({
      error: true,
      message: 'Route not found',
      statusCode: 404,
      timestamp: new Date().toISOString(),
    });
  });

  // 健康检查路由
  app.get('/health', async () => {
    const dbHealth = await DatabaseService.healthCheck();
    const redisHealth = await RedisService.healthCheck();

    const status = dbHealth && redisHealth ? 'healthy' : 'unhealthy';

    const result = {
      status,
      timestamp: new Date().toISOString(),
      service: 'notification-service',
      version: '1.0.0',
      uptime: process.uptime(),
      checks: {
        database: dbHealth ? 'ok' : 'error',
        redis: redisHealth ? 'ok' : 'error',
      },
    };

    LoggerService.info('Health check performed', {
      status,
      databaseHealth: dbHealth,
      redisHealth: redisHealth,
    });

    if (status === 'unhealthy') {
      throw new Error('Service unhealthy');
    }

    return result;
  });

  // 基础信息路由
  app.get('/', async () => {
    return {
      service: 'notification-service',
      version: '1.0.0',
      environment: config.NODE_ENV,
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/health',
        api: '/api',
      },
    };
  });

  return app;
}