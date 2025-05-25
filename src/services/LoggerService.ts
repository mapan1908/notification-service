import winston from 'winston';
import { config } from '../config/config';

class LoggerService {
  private static instance: winston.Logger;

  public static getInstance(): winston.Logger {
    if (!LoggerService.instance) {
      // 定义日志格式
      const logFormat = winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss',
        }),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;

          if (Object.keys(meta).length > 0) {
            log += ` ${JSON.stringify(meta)}`;
          }

          if (stack) {
            log += `\n${stack}`;
          }

          return log;
        })
      );

      // 控制台格式（开发环境更友好）
      const consoleFormat = winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
          format: 'HH:mm:ss',
        }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let log = `${timestamp} ${level}: ${message}`;

          if (Object.keys(meta).length > 0) {
            log += ` ${JSON.stringify(meta, null, 2)}`;
          }

          return log;
        })
      );

      const transports: winston.transport[] = [];

      // 控制台输出
      if (config.NODE_ENV === 'development') {
        transports.push(
          new winston.transports.Console({
            format: consoleFormat,
          })
        );
      } else {
        transports.push(
          new winston.transports.Console({
            format: logFormat,
          })
        );
      }

      // 文件输出（生产环境）
      if (config.NODE_ENV === 'production') {
        // 错误日志文件
        transports.push(
          new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            format: logFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
          })
        );

        // 组合日志文件
        transports.push(
          new winston.transports.File({
            filename: 'logs/combined.log',
            format: logFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
          })
        );
      }

      LoggerService.instance = winston.createLogger({
        level: config.LOG_LEVEL,
        format: logFormat,
        transports,
        // 处理未捕获的异常
        exceptionHandlers: [new winston.transports.File({ filename: 'logs/exceptions.log' })],
        // 处理未处理的 Promise 拒绝
        rejectionHandlers: [new winston.transports.File({ filename: 'logs/rejections.log' })],
      });
    }

    return LoggerService.instance;
  }

  // 便捷方法
  public static info(message: string, meta?: any): void {
    this.getInstance().info(message, meta);
  }

  public static error(message: string, error?: Error | any): void {
    if (error instanceof Error) {
      this.getInstance().error(message, {
        error: error.message,
        stack: error.stack,
        ...error,
      });
    } else {
      this.getInstance().error(message, error);
    }
  }

  public static warn(message: string, meta?: any): void {
    this.getInstance().warn(message, meta);
  }

  public static debug(message: string, meta?: any): void {
    this.getInstance().debug(message, meta);
  }

  // 通知相关的专用日志方法
  public static notificationSent(data: { orderId: string; storeCode: string; channelType: string; eventType: string; duration?: number }): void {
    this.info('Notification sent successfully', {
      type: 'notification_success',
      ...data,
    });
  }

  public static notificationFailed(data: { orderId: string; storeCode: string; channelType: string; eventType: string; error: string; retryCount?: number }): void {
    this.error('Notification failed', {
      type: 'notification_failed',
      ...data,
    });
  }

  public static streamMessageProcessed(data: { messageId: string; orderId: string; eventType: string; processingTime?: number }): void {
    this.info('Stream message processed', {
      type: 'stream_processed',
      ...data,
    });
  }

  public static databaseQuery(data: { query: string; duration?: number; affectedRows?: number }): void {
    this.debug('Database query executed', {
      type: 'database_query',
      ...data,
    });
  }

  public static redisOperation(data: { operation: string; key?: string; duration?: number }): void {
    this.debug('Redis operation executed', {
      type: 'redis_operation',
      ...data,
    });
  }
}

export default LoggerService;
