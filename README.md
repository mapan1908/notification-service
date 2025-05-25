# Notification Service

基于 Node.js + TypeScript + Fastify 的智能通知服务系统

## 📋 项目简介

通知服务是一个高性能、可扩展的多渠道通知系统，支持微信公众号、企业微信机器人、云喇叭等多种通知方式。通过 Redis Stream 实现事件驱动架构，采用策略模式支持灵活扩展新的通知渠道，专注于执行通知任务。

## 🚀 项目进度

好的，我们来更新一下您 README 中的项目进度，以反映我们最近讨论和实现的修改。

总的来说，您在核心服务的**设计和编码方面取得了巨大进展**！特别是 `OrderEventConsumer`、`OrderService` 的容错机制和健康检查的引入，让系统向生产级健壮性迈出了一大步。

下面是根据我们最近的讨论和您的代码更新的 README 项目进度部分：

---

## 🚀 项目进度

### ✅ 已完成/核心设计与实现进展显著

- [x] **项目基础架构**

  - TypeScript + Fastify 框架搭建
  - Docker 容器化配置
  - 环境变量管理 (`.env`, `src/config/config.ts`)
  - CI/CD 部署脚本 (GitHub Actions for Docker push)

- [x] **数据存储层**

  - MySQL 数据库连接池 (`DatabaseService`)
  - Redis 服务 (`RedisService`) (包括连接和基本操作)
  - 数据库与Redis健康检查 (集成在 `/health` 接口)

- [x] **日志系统**

  - Winston 结构化日志 (`LoggerService`)
  - 请求/响应日志记录 (Fastify Hooks in `app.ts`)
  - 数据库/Redis 操作日志 (集成在各Service中)
  - 分级日志输出

- [x] **配置读取服务 (`ConfigService`)**

  - 从数据库读取商家通知渠道配置 (含缓存) - _设计完成，实现依赖数据库表结构和 `storeCode` 一致性_
  - 从数据库读取微信模板配置 (含缓存) - _设计完成，实现依赖数据库表结构_
  - 配置验证逻辑 (`validateChannelConfig`) - _基本设计完成_
  - _注：配置的创建和更新由外部管理平台直接操作数据库。_

- [x] **核心通知流程设计与初步实现**
  - **Redis Stream 消费者 (`OrderEventConsumer`)**
    - [x] 设计完成：采用持续并发处理模型 (基于 `p-limit`)。
    - [x] 事件流消费逻辑、消息解析、ACK/NACK 机制（基于 `CriticalOrderInfoError`）初步编码完成。
    - [x] 集成订单服务健康检查，实现不健康时暂停轮询。
  - **订单信息获取服务 (`OrderService`)**
    - [x] 设计完成：包含共享缓存读取、API调用、鉴权、超时。
    - [x] 集成订单服务健康检查，实现健康时快速重试、不健康时快速失败。
    - [x] 移除内部长时间梯度重试，依赖 `CriticalOrderInfoError` 和 PENDING 消息重投递。
    - [x] 时效性检查实现。
  - **订单服务健康检查器 (`OrderServiceHealthChecker`)**
    - [x] 设计与初步编码完成：定期检查订单服务健康，并将状态写入 Redis。
  - **通知日志服务 (`NotificationLogService`)**
    - [x] 设计完成：定义了日志记录接口。
    - [ ] _待编码：将通知发送日志完整记录到数据库的逻辑。_
  - **通知策略接口与工厂**
    - [x] `INotificationStrategy`, `NotificationPayload`, `SendResult` 定义完成。
    - [x] `StrategyFactory` 设计完成。
  - **企业微信机器人策略 (`WecomBotStrategy`)**
    - [x] 设计完成 (含超时、HTTP Agent)。
    - [ ] _待编码与测试：消息格式化和实际发送逻辑。_
  - **通知引擎核心 (`NotificationEngine`)**
    - [x] 设计完成：编排订单信息查询、策略选择与执行、错误处理、日志记录。
    - [x] 初步编码完成，能调用 `OrderService`, `ConfigService`, `StrategyFactory` 和 `NotificationLogService`。
    - [x] 错误处理：能捕获并向上传播 `CriticalOrderInfoError`。

---

### 🔄 正在进行核心功能实现与联调测试

- [🚧] **全局店铺标识符统一**
  - 确保 `storeCode` (string) 在所有类型定义 (`StreamMessage`, `OrderInfo`, `NotificationChannelConfig`, `NotificationLog` 等)、服务接口、数据库表和配置中保持一致。
- [🚧] **Redis Stream 消费者 (`OrderEventConsumer`)**
  - 集成测试：与 `NotificationEngine` 和 `OrderService` 的健康检查机制完整对接。
  - 优化 `stop()` 方法中的优雅关闭，确保 `p-limit` 任务能完成。
- [🚧] **订单信息获取服务 (`OrderService`)**
  - 集成测试：与 `OrderServiceHealthChecker` 联动，测试健康与不健康时的行为。
  - 确认 `OrderInfo` 类型与 API 返回及 `storeCode` 使用的一致性。
- [🚧] **通知日志服务 (`NotificationLogService`)**
  - 完成将通知发送日志记录到数据库的逻辑编码与测试（需确认数据库表结构）。
- [🚧] **企业微信机器人策略 (`WecomBotStrategy`)**
  - 完成消息格式化和实际发送逻辑的编码与测试。
- [🚧] **通知引擎核心 (`NotificationEngine`)**
  - 集成测试：打通从获取订单信息到策略执行、日志记录的完整流程。
  - 依赖 `ConfigService` 和 `NotificationLogService` 中店铺标识符的统一。
- [ ] **(待开始) 微信公众号模板消息策略 (`WechatMpStrategy`)** 实现
- [ ] **(待开始) 云喇叭语音播报策略 (`CloudSpeakerStrategy`)** 实现

---

### 📋 后续开发计划

- [ ] **Redis Stream PENDING 消息处理**
  - 设计并实现或配置 `XAUTOCLAIM` / `XPENDING`+`XCLAIM` 逻辑，处理长时间未 ACK 的消息。
- [ ] **通知日志服务完善**
  - 日志查询和统计接口 (如果需要对外提供)。
- [ ] **错误处理与重试机制 (高级)**
  - （当前方案依赖 PENDING 消息重投递和健康检查）
  - 未来可能考虑更细致的错误分类和针对特定渠道的可配置重试。
- [ ] **测试和监控**
  - 单元测试覆盖率提升 (特别是 `OrderService`, `NotificationEngine`, 各策略)。
  - 端到端集成测试 (覆盖更多场景)。
  - 接入性能监控指标 (Prometheus/Grafana 等)。
  - 建立关键业务告警系统。
- [ ] **更多通知渠道支持**
  - 云打印机等

---

**总结一下我们已完成和正在进行的：**

- **`OrderServiceHealthChecker.ts`**：框架和核心逻辑已讨论并提供。
- **`OrderService.ts`**：已讨论并提供了改造后的版本（集成健康检查，快速失败）。
- **`OrderEventConsumer.ts`**：已讨论并提供了改造后的版本（集成健康检查暂停轮询，使用`p-limit`实现持续并发）。
- **`NotificationEngine.ts`**：对其现有逻辑进行了复盘，主要待办是确保店铺标识符的全局一致性。
- **`config.ts`**：已讨论需要添加的配置项。

1.  **全局统一店铺标识符**：这是进行下一步测试的前提。请确保所有相关的类型、服务、数据库表（如果已创建）都使用了一致的店铺标识符（推荐 `storeCode: string`）。
2.  **将我们讨论的最新代码版本应用到您的项目中**：
    - `OrderServiceHealthChecker.ts` (创建并实现)
    - `OrderService.ts` (更新到集成健康检查和快速失败的版本)
    - `OrderEventConsumer.ts` (更新到集成健康检查暂停轮询和 `p-limit` 并发的版本)
    - `NotificationEngine.ts` (适配统一后的店铺标识符，并确保正确传递 `CriticalOrderInfoError`)
    - `src/config/config.ts` 和 `.env` (添加所有新配置项)
    - `src/index.ts` (集成 `OrderServiceHealthChecker` 的启动和停止)
3.  **数据库准备**：
    - 确保 `notification_channels` 表（如果 `ConfigService` 从中读取）和 `notification_logs` 表（如果 `NotificationLogService` 要写入）已根据统一的店铺标识符调整并创建。
    - 为测试准备一些商家通知渠道配置数据。

**一旦这些都就绪，就可以开始如下的初步集成测试：**

- **场景1：订单服务健康**
  - `OrderServiceHealthChecker` 报告健康。
  - `OrderEventConsumer` 正常拉取消、并发处理。
  - `OrderService` 成功获取订单信息（可以mock API或连接真实服务）。
  - `NotificationEngine` 成功调用策略（例如，`WecomBotStrategy` 可以先只打日志，不实际发送）。
  - `NotificationLogService` 成功记录日志（可以先打日志，不实际写库）。
  - 消息被正确 ACK。
- **场景2：订单服务不健康**
  - `OrderServiceHealthChecker` 报告不健康。
  - `OrderEventConsumer` 应该暂停轮询，日志中能看到相应的暂停信息和实际暂停时间。
  - （可选）如果在此期间有少量消息被拉取（在暂停逻辑生效前），`OrderService` 应该快速失败并抛出 `CriticalOrderInfoError`，消息不被 ACK，进入 PENDING。
- **场景3：订单服务从不健康恢复到健康**
  - `OrderServiceHealthChecker` 更新状态。
  - `OrderEventConsumer` 应该在暂停结束后，检测到健康状态，并恢复正常的消息拉取和处理。
  - 之前 PENDING 的消息（如果有）在被重投递时应该能被成功处理。

## ✨ 功能特性

- 🚀 **高性能**: 基于 Fastify 框架，支持高并发处理
- 🔄 **事件驱动**: 通过 Redis Stream 实现可靠的消息处理和系统解耦
- 🎯 **策略模式**: 支持多种通知渠道，易于扩展新的通知方式
- 📊 **结构化日志**: 通过 Winston 实现详细的系统运行日志和通知发送尝试日志
- ⚙️ **外部化配置**: 通知渠道和模板等配置由外部管理平台维护，本服务动态读取
- 🛡️ **容错与健壮性**: 设计包含超时控制、错误捕获和日志记录；后续将加入重试机制
- 📱 **多渠道支持**:
  - ✅ (设计完成，实现中) 企业微信群机器人
  - 🔄 (设计规划中) 微信公众号模板消息
  - 🔄 (设计规划中) 云喇叭语音播报
  - 🔄 (待规划) 云打印机

## 🏗️ 技术栈

- **运行时**: Node.js 18+
- **语言**: TypeScript
- **Web框架**: Fastify
- **数据库**: MySQL 8.0
- **缓存**: Redis 7.0
- **消息队列**: Redis Stream
- **HTTP客户端**: undici
- **日志**: Winston
- **容器化**: Docker
- **包管理**: pnpm

## 📦 环境要求

- Node.js 18.0+
- MySQL 8.0+
- Redis 7.0+
- Docker (可选)

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
│   ├── consumers/        # Redis Stream 消费者 (e.g., OrderEventConsumer.ts)
│   ├── strategies/       # 通知策略实现 (e.g., WecomBotStrategy.ts, StrategyFactory.ts)
│   ├── services/         # 核心业务服务 (e.g., NotificationEngine.ts, OrderService.ts, ConfigService.ts, NotificationLogService.ts)
│   ├── types/            # TypeScript 类型定义 (index.ts, etc.)
│   ├── config/           # 应用配置 (config.ts)
│   ├── utils/            # 工具函数 (e.g., httpClient.ts)
│   ├── app.ts            # Fastify 应用主配置 (插件、hooks、路由注册点)
│   └── index.ts          # 应用入口，服务启动与关闭
├── logs/                 # (生产环境) 日志文件存放目录
├── scripts/              # 辅助脚本 (e.g., init.sql, 部署脚本)
├── docker-compose.yml    # Docker Compose 配置
├── Dockerfile            # Docker 镜像构建文件
└── tsconfig.json         # TypeScript 编译配置
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

当前阶段: 核心功能实现与夯实 (v1.0.0-alpha -> v1.0.0-beta)
[🚧] 完成核心模块编码: OrderEventConsumer, OrderService, NotificationLogService, WecomBotStrategy, StrategyFactory, NotificationEngine.
[🚧] 初步集成测试: 确保消息能从Stream流入，经过引擎处理，至少一个渠道能触发（模拟）发送，并记录日志。
[ ] 实现微信公众号策略 (WechatMpStrategy): 包括与 ConfigService 配合获取模板ID和字段映射。
[ ] 实现云喇叭策略 (CloudSpeakerStrategy).
[ ] 完善各策略的消息格式化逻辑: 确保为所有核心 NotificationEventType 提供友好的通知内容。
[ ] 单元测试: 为核心服务和策略编写单元测试。
下一阶段: 健壮性与可观测性 (v1.0.0)
[ ] 完善错误处理和重试机制: 针对可重试的错误（如网络超时、第三方服务临时不可用）实现自动重试。
[ ] 集成测试: 覆盖主要业务流程和异常场景。
[ ] 监控指标接入: 暴露关键性能和业务指标。
[ ] 告警系统搭建: 对重要错误和异常指标设置告警。
未来规划 (v1.1.0+)
[ ] 性能优化: 根据实际负载进行性能分析和调优。
[ ] 更多通知渠道支持: 如短信、App Push、云打印机等。
[ ] 高级功能:
通知聚合/防打扰策略。
用户自定义通知偏好。
A/B 测试通知效果。
[ ] （可选）轻量级管理界面: 用于查看通知日志、服务状态等（如果外部管理平台不覆盖）。

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

[ ] OrderService.ts: 完成编码和单元测试。
[ ] NotificationLogService.ts: 完成编码和单元测试 (确保DB表已创建)。
[ ] WecomBotStrategy.ts: 完成编码和单元测试，细化 formatMessage。
[ ] NotificationEngine.ts: 完成核心编排逻辑编码和单元测试。
[ ] OrderEventConsumer.ts: 完成与 NotificationEngine 的对接和ACK逻辑编码。
[ ] 初步集成测试: 打通 Redis Stream -> Consumer -> Engine -> Strategy -> Log 完整流程。
📋 即将开始
[ ] WechatMpStrategy.ts: 设计与实现。
[ ] CloudSpeakerStrategy.ts: 设计与实现。
[ ] StrategyFactory.ts: 注册新策略。
[ ] 单元测试覆盖: 提升核心模块的测试覆盖率
