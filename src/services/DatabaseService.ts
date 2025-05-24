import mysql from 'mysql2/promise';
import { config } from '../config/config';
import LoggerService from './LoggerService';

interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  acquireTimeout: number;
  timeout: number;
}

class DatabaseService {
  private static pool: mysql.Pool;

  public static createPool(): mysql.Pool {
    if (!DatabaseService.pool) {
      const dbConfig: DatabaseConfig = {
        host: config.DATABASE_HOST,
        port: config.DATABASE_PORT,
        user: config.DATABASE_USER,
        password: config.DATABASE_PASSWORD,
        database: config.DATABASE_NAME,
        connectionLimit: 10,
        acquireTimeout: 60000,
        timeout: 60000,
      };

      DatabaseService.pool = mysql.createPool(dbConfig);
      LoggerService.info('MySQL connection pool created', {
        host: config.DATABASE_HOST,
        database: config.DATABASE_NAME,
        connectionLimit: 10,
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

  public static async execute<T = any>(
    query: string,
    params?: any[]
  ): Promise<T> {
    const startTime = Date.now();
    
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
      LoggerService.error('Database query error', {
        query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
        params,
        duration,
        error,
      });
      throw error;
    }
  }

  public static async query<T = any>(
    query: string,
    params?: any[]
  ): Promise<T> {
    const startTime = Date.now();
    
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
      LoggerService.error('Database query error', {
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

  public static async transaction<T>(
    callback: (connection: mysql.PoolConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.getConnection();
    
    try {
      await connection.beginTransaction();
      LoggerService.debug('Database transaction started');
      
      const result = await callback(connection);
      await connection.commit();
      
      LoggerService.debug('Database transaction committed');
      return result;
    } catch (error) {
      await connection.rollback();
      LoggerService.error('Database transaction rolled back', error);
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
      LoggerService.error('Database health check failed', error);
      return false;
    }
  }

  public static async close(): Promise<void> {
    if (DatabaseService.pool) {
      await DatabaseService.pool.end();
      LoggerService.info('Database connection pool closed');
    }
  }
}

export default DatabaseService;