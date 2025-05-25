// src/utils/httpClient.ts (或者一个服务)
import { Agent } from 'undici';
import { config } from '../config/config';

export const defaultHttpAgent = new Agent({
  // connections: 100, // 最大连接数 (undici 默认根据CPU核心数等因素调整)
  keepAliveTimeout: 10 * 1000, // 10秒内无活动则关闭keep-alive连接
  keepAliveMaxTimeout: 60 * 1000, // keep-alive连接的最长存活时间，即使有活动
  connectTimeout: config.DEFAULT_HTTP_TIMEOUT_MS, // Agent 级别的连接超时
  // ... 其他 undici Agent 配置项
});
