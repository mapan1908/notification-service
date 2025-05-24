# Notification Service

基于 Node.js + TypeScript + Fastify 的智能通知服务系统

## 📋 项目简介

通知服务是一个高性能、可扩展的多渠道通知系统，支持微信公众号、企业微信机器人、云喇叭等多种通知方式。通过 Redis Stream 实现事件驱动架构，采用策略模式支持灵活扩展新的通知渠道，专注于执行通知任务。

## 🚀 项目进度

### ✅ 已完成/核心设计完成

-   [x] **项目基础架构**
    * TypeScript + Fastify 框架搭建
    * Docker 容器化配置
    * 环境变量管理 (`.env`, `src/config/config.ts`)
    * CI/CD 部署脚本 (GitHub Actions for Docker push)

-   [x] **数据存储层**
    * MySQL 数据库连接池 (`DatabaseService`)
    * Redis 缓存服务 (`RedisService`)
    * 数据库与Redis健康检查 (集成在 `/health` 接口)

-   [x] **日志系统**
    * Winston 结构化日志 (`LoggerService`)
    * 请求/响应日志记录 (Fastify Hooks in `app.ts`)
    * 数据库/Redis 操作日志 (集成在各Service中)
    * 分级日志输出

-   [x] **配置读取服务 (`ConfigService`)**
    * 从数据库读取商家通知渠道配置 (含缓存)
    * 从数据库读取微信模板配置 (含缓存)
    * 配置验证逻辑 (`validateChannelConfig`)
    * *注：配置的创建和更新由外部管理平台直接操作数据库。*

-   [x] **核心通知流程设计**
    * Redis Stream 消费者 (`OrderEventConsumer`) 设计完成
    * 订单信息获取服务 (`OrderService`) 设计完成 (含共享缓存读取、API调用、鉴权、超时)
    * 通知日志服务 (`NotificationLogService`) 设计完成
    * 通知策略接口 (`INotificationStrategy`, `NotificationPayload`, `SendResult`) 定义完成
    * 策略工厂 (`StrategyFactory`) 设计完成
    * 企业微信机器人策略 (`WecomBotStrategy`) 设计完成 (含超时、HTTP Agent)
    * 通知引擎核心 (`NotificationEngine`) 设计完成

### 🔄 正在进行核心功能实现

-   [ ] **Redis Stream 消费者 (`OrderEventConsumer`)**
    * 订单事件流消费逻辑编码与测试
    * 消息确认机制 (ACK) 编码与测试
-   [ ] **订单信息获取服务 (`OrderService`)**
    * 共享缓存读取、API调用、鉴权、超时逻辑编码与测试
-   [ ] **通知日志服务 (`NotificationLogService`)**
    * 通知发送日志记录到数据库的逻辑编码与测试
-   [ ] **通知策略系统**
    * 企业微信机器人策略 (`WecomBotStrategy`) 编码与测试
    * (待开始) 微信公众号模板消息策略 (`WechatMpStrategy`) 实现
    * (待开始) 云喇叭语音播报策略 (`CloudSpeakerStrategy`) 实现
-   [ ] **通知引擎核心 (`NotificationEngine`)**
    * 订单信息查询、策略选择与执行、错误处理、日志记录等核心逻辑编码与测试

### 📋 后续开发计划

-   [ ] **通知日志服务完善**
    * 日志查询和统计接口 (如果需要对外提供)
    * 高级重试记录管理 (配合重试机制)
-   [ ] **错误处理与重试机制**
    * 实现更完善的错误分类与处理
    * 设计并实现通知发送的自动重试策略 (例如针对特定错误类型、可配置次数和间隔)
-   [ ] **测试和监控**
    * 单元测试覆盖率提升
    * 端到端集成测试
    * 接入性能监控指标 (Prometheus/Grafana 等)
    * 建立关键业务告警系统
-   [ ] **更多通知渠道支持**
    * 云打印机等

## ✨ 功能特性

-   🚀 **高性能**: 基于 Fastify 框架，支持高并发处理
-   🔄 **事件驱动**: 通过 Redis Stream 实现可靠的消息处理和系统解耦
-   🎯 **策略模式**: 支持多种通知渠道，易于扩展新的通知方式
-   📊 **结构化日志**: 通过 Winston 实现详细的系统运行日志和通知发送尝试日志
-   ⚙️ **外部化配置**: 通知渠道和模板等配置由外部管理平台维护，本服务动态读取
-   🛡️ **容错与健壮性**: 设计包含超时控制、错误捕获和日志记录；后续将加入重试机制
-   📱 **多渠道支持**:
    * ✅ (设计完成，实现中) 企业微信群机器人
    * 🔄 (设计规划中) 微信公众号模板消息
    * 🔄 (设计规划中) 云喇叭语音播报
    * 🔄 (待规划) 云打印机

## 🏗️ 技术栈

-   **运行时**: Node.js 18+
-   **语言**: TypeScript
-   **Web框架**: Fastify
-   **数据库**: MySQL 8.0
-   **缓存**: Redis 7.0
-   **消息队列**: Redis Stream
-   **HTTP客户端**: undici
-   **日志**: Winston
-   **容器化**: Docker
-   **包管理**: pnpm

## 📦 环境要求

-   Node.js 18.0+
-   MySQL 8.0+
-   Redis 7.0+
-   Docker (可选)

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone <your-repository-url>
cd notification-service
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 环境配置

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑环境变量文件
nano .env
```

关键环境变量配置：
```env
# 服务配置
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# MySQL 数据库
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USER=root
DATABASE_PASSWORD=your_password
DATABASE_NAME=notifications

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=your-redis-username
REDIS_PASSWORD=your-redis-password

# Redis Stream 配置
STREAM_KEY=order:events
CONSUMER_GROUP=notification-service

# 订单服务配置
ORDER_SERVICE_BASE_URL=http://localhost:9002/api
ORDER_SERVICE_TOKEN=your-order-service-token
```

### 4. 数据库初始化

确保 MySQL 数据库已创建，并执行必要的表结构创建脚本。

### 5. 启动服务

```bash
# 开发模式启动
pnpm run dev

# 生产模式启动
pnpm run build
pnpm start
```

### 6. 验证服务

```bash
# 健康检查
curl http://localhost:3000/health

# 服务信息
curl http://localhost:3000/

# 预期响应
{
  "status": "healthy",
  "timestamp": "2024-05-24T10:30:00.000Z",
  "service": "notification-service",
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

## 📁 项目结构

```
notification-service/
├── src/
│   ├── consumers/          # Redis Stream 消费者
│   ├── strategies/         # 通知策略实现
│   ├── services/           # 业务服务层
│   │   ├── DatabaseService.ts    # 数据库连接池
│   │   ├── RedisService.ts       # Redis 缓存服务
│   │   ├── ConfigService.ts      # 配置管理服务
│   │   └── LoggerService.ts      # 日志服务
│   ├── routes/             # API 路由定义
│   │   └── config.ts             # 配置管理路由
│   ├── config/             # 配置管理
│   │   └── config.ts             # 环境配置
│   ├── utils/              # 工具函数
│   ├── types/              # TypeScript 类型定义
│   │   └── index.ts              # 核心类型定义
│   ├── app.ts              # Fastify 应用配置
│   └── index.ts            # 应用入口文件
├── tests/                  # 测试文件
├── logs/                   # 日志文件目录
├── scripts/                # 部署和工具脚本
│   └── notification-service-deploy.sh
├── docker-compose.yml      # Docker Compose 配置
├── Dockerfile             # Docker 镜像构建
├── tsconfig.json          # TypeScript 配置
└── README.md              # 项目文档
```

## 🛠️ 开发命令

```bash
# 开发相关
pnpm run dev          # 开发模式启动（热重载）
pnpm run build        # 构建项目
pnpm run start        # 生产模式启动

# 代码质量
pnpm run lint         # ESLint 代码检查
pnpm run format       # Prettier 代码格式化

# 测试相关
pnpm run test         # 运行测试
pnpm run test:watch   # 监听模式运行测试
pnpm run test:coverage # 生成测试覆盖率报告
```

## 📊 API 接口

### 健康检查
```bash
GET /health
```

### 配置管理
```bash
# 获取商家通知渠道配置
GET /api/stores/:storeId/channels

# 创建通知渠道配置
POST /api/stores/:storeId/channels

# 更新通知渠道配置  
PUT /api/channels/:id

# 创建微信模板配置
POST /api/stores/:storeId/wechat-templates

# 测试配置验证
POST /api/test-config
```

### 配置示例

#### 微信公众号配置
```json
{
  "order_type": "pickup",
  "channel_type": "wechat_mp",
  "channel_config": {
    "app_id": "wx1234567890",
    "app_secret": "your_app_secret",
    "template_id": "template_001",
    "open_id": "user_openid"
  },
  "enabled": true
}
```

#### 企业微信机器人配置
```json
{
  "order_type": "dine_in",
  "channel_type": "wecom_bot", 
  "channel_config": {
    "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
    "mention_list": ["@all"]
  },
  "enabled": true
}
```

## 🐳 Docker 部署

### 构建和运行

```bash
# 构建镜像
docker build -t notification-service:latest .

# 运行容器
docker run -d \
  --name notification-service \
  -p 3000:3000 \
  -e DATABASE_HOST=your-mysql-host \
  -e REDIS_HOST=your-redis-host \
  -e DATABASE_PASSWORD=your-db-password \
  -e REDIS_PASSWORD=your-redis-password \
  --restart unless-stopped \
  notification-service:latest
```

### 使用部署脚本

```bash
# 编辑部署脚本中的配置
nano scripts/notification-service-deploy.sh

# 执行部署
./scripts/notification-service-deploy.sh
```

## 📈 监控指标

服务提供以下监控指标：

- **系统指标**:
  - 服务健康状态
  - 数据库连接状态
  - Redis 连接状态
  - 内存和CPU使用情况

- **业务指标** (开发中):
  - 通知发送成功率
  - 各渠道发送统计
  - 平均处理时间
  - 重试次数分布

## 🔍 故障排查

### 常见问题

1. **服务无法启动**
   ```bash
   # 检查端口占用
   lsof -i :3000
   
   # 查看服务日志
   pnpm run dev
   ```

2. **数据库连接失败**
   ```bash
   # 检查数据库配置
   mysql -h your-host -u your-user -p
   
   # 查看连接池状态
   curl http://localhost:3000/health
   ```

3. **Redis 连接问题**
   ```bash
   # 测试 Redis 连接
   redis-cli -h your-host -p 6379 ping
   
   # 检查 Redis 配置
   curl http://localhost:3000/health
   ```

### 日志查看

```bash
# 开发环境日志
pnpm run dev

# 生产环境日志文件
tail -f logs/combined.log
tail -f logs/error.log
```

## 📝 开发路线图

### 当前版本 (v1.0.0-alpha)
- ✅ 基础架构搭建
- ✅ 配置管理服务
- 🔄 通知策略系统开发

### 下一版本 (v1.0.0-beta)
- 🔄 通知引擎核心
- 🔄 Redis Stream 消费者
- 🔄 完整的测试覆盖

### 未来版本 (v1.1.0+)
- 📋 性能优化和监控完善
- 📋 更多通知渠道支持
- 📋 管理后台界面
- 📋 A/B 测试功能

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交变更 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 📞 联系方式

如有问题或建议，请通过以下方式联系：

- 提交 Issue: [GitHub Issues](your-repo-url/issues)
- 邮箱: your-email@example.com

---

**⭐ 如果这个项目对你有帮助，请给个 Star！**

---

## 📋 待办事项清单

### 🔄 正在进行
- 通知日志服务开发
- 通知策略系统设计

### 📋 即将开始
- [ ] 微信公众号模板消息策略实现
- [ ] 企业微信机器人策略实现
- [ ] 云喇叭语音播报策略实现
- [ ] 通知引擎核心逻辑
- [ ] Redis Stream 消费者实现

### 📋 后续计划
- [ ] 错误处理和重试机制
- [ ] 单元测试和集成测试
- [ ] 性能优化和监控完善
- [ ] API 文档生成
- [ ] 部署文档完善