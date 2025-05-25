import mysql from 'mysql2/promise';
import { config } from '../config/config';
import LoggerService from './LoggerService';

// 移除 DatabaseConfig 接口中不被 createPool 直接支持的 acquireTimeout 和 timeout
interface PoolDatabaseConfig {
  // 可以重命名以区分
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  connectTimeout?: number; // TCP 连接超时
  waitForConnections?: boolean; // 当连接池满时，新请求是等待还是立即失败
  queueLimit?: number; // 等待队列的最大长度 (waitForConnections:true 时)
  // acquireTimeout for pool.getConnection() is often managed internally or via specific PoolConfig if available
}

class DatabaseService {
  private static pool: mysql.Pool;

  public static createPool(): mysql.Pool {
    if (!DatabaseService.pool) {
      const dbConfig: PoolDatabaseConfig = {
        host: config.DATABASE_HOST,
        port: config.DATABASE_PORT,
        user: config.DATABASE_USER,
        password: config.DATABASE_PASSWORD,
        database: config.DATABASE_NAME,
        connectionLimit: 10, // 标准连接池选项
        connectTimeout: 20000, // TCP连接超时 (例如20秒) - 这是 Connection 选项
        waitForConnections: true, // 当池满时，新的 getConnection() 请求会等待
        queueLimit: 0, // 无限制的等待队列 (0表示无限)
        // 如果您想控制从池中获取连接的总超时，这通常不是 createPool 的顶级选项。
        // mysql2 的 Pool 会管理这个。
        // 您之前写的 acquireTimeout: 60000 和 timeout: 60000
        // 并不是 mysql.createPool() 的标准顶级配置项，导致了警告。
      };

      DatabaseService.pool = mysql.createPool(dbConfig);
      LoggerService.info('[DatabaseService] MySQL 连接池创建成功', {
        host: config.DATABASE_HOST,
        database: config.DATABASE_NAME,
        connectionLimit: dbConfig.connectionLimit,
      });
    }
    return DatabaseService.pool;
  }

  public static getPool(): mysql.Pool {
    if (!DatabaseService.pool) {
      return this.createPool();
    }
    return DatabaseService.pool;
  }

  public static async execute<T = any>(query: string, params?: any[]): Promise<T> {
    const startTime = Date.now();
    LoggerService.debug('[DatabaseService] 数据库查询开始', params);
    try {
      const pool = this.getPool();
      const [rows] = await pool.execute(query, params);

      const duration = Date.now() - startTime;
      LoggerService.databaseQuery({
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        duration,
        affectedRows: Array.isArray(rows) ? rows.length : 1,
      });

      return rows as T;
    } catch (error) {
      const duration = Date.now() - startTime;
      LoggerService.error('[DatabaseService] 数据库查询错误', {
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        params,
        duration,
        error,
      });
      throw error;
    }
  }

  public static async query<T = any>(query: string, params?: any[]): Promise<T> {
    const startTime = Date.now();
    LoggerService.debug('[DatabaseService] 数据库查询开始', params);
    try {
      const pool = this.getPool();
      const [rows] = await pool.query(query, params);

      const duration = Date.now() - startTime;
      LoggerService.databaseQuery({
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        duration,
        affectedRows: Array.isArray(rows) ? rows.length : 1,
      });

      return rows as T;
    } catch (error) {
      const duration = Date.now() - startTime;
      LoggerService.error('[DatabaseService] 数据库查询错误', {
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        params,
        duration,
        error,
      });
      throw error;
    }
  }

  public static async getConnection(): Promise<mysql.PoolConnection> {
    const pool = this.getPool();
    return await pool.getConnection();
  }

  public static async transaction<T>(callback: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.getConnection();

    try {
      await connection.beginTransaction();
      LoggerService.debug('[DatabaseService] 数据库事务开始');

      const result = await callback(connection);
      await connection.commit();

      LoggerService.debug('[DatabaseService] 数据库事务提交');
      return result;
    } catch (error) {
      await connection.rollback();
      LoggerService.error('[DatabaseService] 数据库事务回滚', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  public static async healthCheck(): Promise<boolean> {
    try {
      await this.execute('SELECT 1');
      return true;
    } catch (error) {
      LoggerService.error('[DatabaseService] 数据库健康检查失败', error);
      return false;
    }
  }

  public static async close(): Promise<void> {
    if (DatabaseService.pool) {
      await DatabaseService.pool.end();
      LoggerService.info('[DatabaseService] 数据库连接池关闭');
    }
  }
}

export default DatabaseService;
