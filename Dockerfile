# ---- Base Stage (Node.js 18 Alpine with pnpm) ----
# 使用一个包含 Node.js 18 Alpine 的官方镜像作为基础
# 我们将在这个阶段安装 pnpm 并构建应用
FROM node:18-alpine AS builder


# 设置工作目录
WORKDIR /app

# 1. 安装 pnpm
# Node.js 16.9+ 包含 corepack，可以用来管理包管理器
# 或者，您可以选择全局安装 pnpm：RUN npm install -g pnpm
# 使用 corepack 是更现代的方式
RUN corepack enable
RUN corepack prepare pnpm@latest --activate
# 确保 pnpm 在 PATH 中 (corepack 通常会自动处理，但显式添加无害)
ENV PATH="/root/.local/share/pnpm:${PATH}"

# 2. 复制依赖描述文件
# 只复制这些文件可以更好地利用 Docker 的层缓存机制
# 只有当这些文件改变时，后续的依赖安装步骤才会重新运行
COPY package.json ./
COPY pnpm-lock.yaml ./ 
# 如果您有 .npmrc 或 pnpm-workspace.yaml，也在此处复制

# 3. 安装所有依赖 (包括 devDependencies，因为构建步骤可能需要它们)
# 使用 --frozen-lockfile 确保确定性安装
RUN pnpm install --frozen-lockfile

# 4. 复制项目的其余源代码
COPY . .

# 5. 构建应用程序 (例如，TypeScript 编译)
# 确保您的 package.json 中有 "build" 脚本
RUN pnpm run build
# 此时，您的 /app/dist 目录（或其他 tsconfig.json 中定义的 outDir）应该包含了编译后的 JavaScript 文件

# 6. (可选) 只打包生产依赖，用于最终镜像
# pnpm 会将生产依赖安装到 dist/node_modules (如果 outDir 是 dist) 或一个特定的部署目录
# 或者，我们可以创建一个新的 node_modules 只包含生产依赖
RUN pnpm prune --prod
# 或者，更现代的做法是 pnpm deploy <target_folder> 来创建一个干净的生产部署包
# 但为了简单起见，我们可以直接在下一步复制选择性的文件

# ---- Production Stage ----
# 使用一个轻量级的 Node.js Alpine 镜像作为最终的生产环境
FROM node:18-alpine AS production

# 设置工作目录
WORKDIR /app

# 设置 Node.js 运行环境为 production
ENV NODE_ENV=production
# 新增：设置时区为亚洲/上海
ENV TZ=Asia/Shanghai  

# 从 builder 阶段复制生产依赖
# 如果上一步使用了 `pnpm prune --prod`，node_modules 就只包含生产依赖了
COPY --from=builder /app/node_modules ./node_modules

# 从 builder 阶段复制编译后的代码 (例如 'dist' 目录)
# 确保这里的路径与您 tsconfig.json 中的 outDir 一致
COPY --from=builder /app/dist ./dist

# 复制 package.json (有些库可能在运行时需要它，或者用于版本信息)
COPY --from=builder /app/package.json ./package.json

# (可选) 如果您的应用有其他需要复制到生产环境的静态资源或配置文件，也在这里复制
# COPY --from=builder /app/public ./public
# COPY --from=builder /app/config ./config # 如果您有运行时读取的配置文件

# 暴露应用程序运行的端口
# 确保与您 Fastify 服务监听的端口一致
EXPOSE 3000 

# 健康检查 (保持您原来的健康检查逻辑，确保 dist/healthcheck.js 存在且可执行)
# 您可能需要创建一个简单的 healthcheck.js 脚本
# 例如:
# // healthcheck.js
# const http = require('http');
# const options = { host: 'localhost', port: 3000, timeout: 2000, path: '/health' };
# const request = http.request(options, (res) => {
#   console.log(`HEALTHCHECK: STATUS: ${res.statusCode}`);
#   process.exit(res.statusCode === 200 ? 0 : 1);
# });
# request.on('error', (err) => {
#   console.error('HEALTHCHECK: ERROR');
#   process.exit(1);
# });
# request.end();
#
# 如果您的 dist 目录是 tsconfig.json 中 outDir 的根，那么 healthcheck.js 应该在 dist/healthcheck.js
# 或者如果 healthcheck.js 不在 src 目录，您需要单独复制它:
# COPY healthcheck.js ./dist/healthcheck.js # (如果 healthcheck.js 在项目根目录)
# 您需要确保健康检查脚本在 dist 目录下
# 如果 healthcheck.js 本身是 TypeScript 写的，并放在 src/healthcheck.ts，
# 那么 `pnpm run build` 应该会把它编译到 dist/healthcheck.js
# COPY healthcheck.js ./dist/healthcheck.js  # 假设 healthcheck.js 在根目录且是js

# 启动应用程序的命令
# 您的 package.json 中 "start" 脚本是 "node dist/index.js"
# 所以 CMD ["npm", "start"] 是可以的，或者直接 CMD ["node", "dist/index.js"]
CMD ["node", "dist/index.js"]
