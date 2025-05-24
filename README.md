# Notification Service

基于 Node.js + TypeScript + Fastify 的通知服务系统

## 功能特性

- 支持多种通知渠道（微信公众号、企业微信、云喇叭等）
- Redis Stream 事件驱动架构
- 策略模式支持扩展新通知渠道
- 完整的日志记录和监控

## 快速开始

### 环境要求

- Node.js 18+
- MySQL 8.0+
- Redis 7+
- Docker & Docker Compose

### 本地开发

1. 克隆项目
```bash
git clone <repository-url>
cd notification-service