import Redis from 'ioredis';
import { config } from '../config/config';
import LoggerService from './LoggerService';

class RedisService {
  private static instance: Redis;

  public static getInstance(): Redis {
    if (!RedisService.instance) {
      // 构建 Redis URL
      let redisUrl = `redis://`;
      
      if (config.REDIS_USERNAME && config.REDIS_PASSWORD) {
        redisUrl += `${config.REDIS_USERNAME}:${config.REDIS_PASSWORD}@`;
      } else if (config.REDIS_PASSWORD) {
        redisUrl += `:${config.REDIS_PASSWORD}@`;
      }
      
      redisUrl += `${config.REDIS_HOST}:${config.REDIS_PORT}`;

      RedisService.instance = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 10000,
        commandTimeout: 5000,
        maxRetriesPerRequest: 3,
      });

      // 监听连接事件
      RedisService.instance.on('connect', () => {
        LoggerService.info('Redis connected successfully', {
          host: config.REDIS_HOST,
          port: config.REDIS_PORT,
        });
      });

      RedisService.instance.on('ready', () => {
        LoggerService.info('Redis ready to receive commands');
      });

      RedisService.instance.on('error', (err) => {
        LoggerService.error('Redis connection error', err);
      });

      RedisService.instance.on('close', () => {
        LoggerService.info('Redis connection closed');
      });

      RedisService.instance.on('reconnecting', () => {
        LoggerService.warn('Redis reconnecting...');
      });
    }
    return RedisService.instance;
  }

  public static async connect(): Promise<void> {
    try {
      const redis = this.getInstance();
      await redis.connect();
    } catch (error) {
      LoggerService.error('Redis connection failed', error);
      throw error;
    }
  }

  public static async disconnect(): Promise<void> {
    try {
      const redis = this.getInstance();
      await redis.quit();
    } catch (error) {
      LoggerService.error('Redis disconnection failed', error);
    }
  }

  public static async healthCheck(): Promise<boolean> {
    try {
      const redis = this.getInstance();
      const result = await redis.ping();
      return result === 'PONG';
    } catch (error) {
      LoggerService.error('Redis health check failed', error);
      return false;
    }
  }

  // 获取缓存
  public static async get(key: string): Promise<string | null> {
    const startTime = Date.now();
    
    try {
      const redis = this.getInstance();
      const result = await redis.get(key);
      
      LoggerService.redisOperation({
        operation: 'GET',
        key,
        duration: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      LoggerService.error(`Redis GET error for key ${key}`, error);
      return null;
    }
  }

  // 设置缓存
  public static async set(key: string, value: string, ttl?: number): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const redis = this.getInstance();
      if (ttl) {
        await redis.setex(key, ttl, value);
      } else {
        await redis.set(key, value);
      }
      
      LoggerService.redisOperation({
        operation: ttl ? 'SETEX' : 'SET',
        key,
        duration: Date.now() - startTime,
      });
      
      return true;
    } catch (error) {
      LoggerService.error(`Redis SET error for key ${key}`, error);
      return false;
    }
  }

  // 设置带过期时间的缓存
  public static async setex(key: string, seconds: number, value: string): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const redis = this.getInstance();
      await redis.setex(key, seconds, value);
      
      LoggerService.redisOperation({
        operation: 'SETEX',
        key,
        duration: Date.now() - startTime,
      });
      
      return true;
    } catch (error) {
      LoggerService.error(`Redis SETEX error for key ${key}`, error);
      return false;
    }
  }

  // 删除缓存
  public static async del(key: string): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const redis = this.getInstance();
      const result = await redis.del(key);
      
      LoggerService.redisOperation({
        operation: 'DEL',
        key,
        duration: Date.now() - startTime,
      });
      
      return result > 0;
    } catch (error) {
      LoggerService.error(`Redis DEL error for key ${key}`, error);
      return false;
    }
  }

  // 检查键是否存在
  public static async exists(key: string): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const redis = this.getInstance();
      const result = await redis.exists(key);
      
      LoggerService.redisOperation({
        operation: 'EXISTS',
        key,
        duration: Date.now() - startTime,
      });
      
      return result === 1;
    } catch (error) {
      LoggerService.error(`Redis EXISTS error for key ${key}`, error);
      return false;
    }
  }

  // 设置键的过期时间
  public static async expire(key: string, seconds: number): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const redis = this.getInstance();
      const result = await redis.expire(key, seconds);
      
      LoggerService.redisOperation({
        operation: 'EXPIRE',
        key,
        duration: Date.now() - startTime,
      });
      
      return result === 1;
    } catch (error) {
      LoggerService.error(`Redis EXPIRE error for key ${key}`, error);
      return false;
    }
  }

  // 获取键的剩余过期时间
  public static async ttl(key: string): Promise<number> {
    const startTime = Date.now();
    
    try {
      const redis = this.getInstance();
      const result = await redis.ttl(key);
      
      LoggerService.redisOperation({
        operation: 'TTL',
        key,
        duration: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      LoggerService.error(`Redis TTL error for key ${key}`, error);
      return -1;
    }
  }
}

export default RedisService;