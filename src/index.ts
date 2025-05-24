import { buildApp } from './app';
import { config } from './config/config';

async function start() {
  try {
    const app = await buildApp();
    
    await app.listen({
      port: config.PORT,
      host: '0.0.0.0',
    });

    console.log(`🚀 Notification service started on port ${config.PORT}`);
  } catch (err) {
    console.error('❌ Error starting server:', err);
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, shutting down gracefully');
  process.exit(0);
});

start();