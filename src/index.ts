import { buildApp } from './app';
import { config } from './config/config';
import DatabaseService from './services/DatabaseService';
import RedisService from './services/RedisService';
import LoggerService from './services/LoggerService';
import OrderEventConsumer from './consumers/OrderEventConsumer';
import { OrderServiceHealthChecker } from './services/OrderServiceHealthChecker';

const consumer = new OrderEventConsumer();

async function start() {
  try {
    LoggerService.info('Starting notification service...', {
      nodeEnv: config.NODE_ENV,
      port: config.PORT,
      logLevel: config.LOG_LEVEL,
    });

    // 初始化数据库连接
    DatabaseService.createPool();

    // 连接 Redis
    await RedisService.connect();
    // 启动 Redis Stream 消费者

    await consumer.start(); // 在 Fastify 启动前或后启动均可，取决于是否有依赖

    // 启动订单服务健康检查器
    await OrderServiceHealthChecker.start();
    // 构建应用
    const app = await buildApp();

    await app.listen({
      port: config.PORT,
      host: '0.0.0.0',
    });

    LoggerService.info('Notification service started successfully', {
      port: config.PORT,
      environment: config.NODE_ENV,
    });
  } catch (err) {
    LoggerService.error('Error starting server', err);
    process.exit(1);
  }
}

// 优雅关闭
async function shutdown() {
  LoggerService.info('Shutting down notification service...');

  OrderServiceHealthChecker.stop(); // 停止健康检查器
  // 停止消费者
  if (consumer) await consumer.stop(); // 需要将 consumer 实例提升作用域
  try {
    await DatabaseService.close();
    await RedisService.disconnect();
    LoggerService.info('Graceful shutdown completed');
  } catch (error) {
    LoggerService.error('Error during shutdown', error);
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  LoggerService.error('Uncaught Exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  LoggerService.error('Unhandled Rejection', {
    reason,
    promise,
  });
});

start();
