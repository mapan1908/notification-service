import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  PORT: parseInt(process.env.PORT || '3000'),
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Database
  DATABASE_HOST: process.env.DATABASE_HOST || 'localhost',
  DATABASE_PORT: parseInt(process.env.DATABASE_PORT || '3306'),
  DATABASE_USER: process.env.DATABASE_USER || 'root',
  DATABASE_PASSWORD: process.env.DATABASE_PASSWORD || 'password',
  DATABASE_NAME: process.env.DATABASE_NAME || 'notifications',

  // Redis
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379'),
  REDIS_USERNAME: process.env.REDIS_USERNAME || '',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',

  // Redis Stream
  STREAM_KEY: process.env.STREAM_KEY || 'order:events',
  CONSUMER_GROUP: process.env.CONSUMER_GROUP || 'notification-service',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Order Service
  ORDER_SERVICE_BASE_URL: process.env.ORDER_SERVICE_BASE_URL || 'http://localhost:9002/api',
  ORDER_SERVICE_TOKEN: process.env.ORDER_SERVICE_TOKEN || '',
} as const;