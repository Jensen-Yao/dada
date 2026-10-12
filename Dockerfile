# 搭搭 App 生产镜像（单阶段，node:22-alpine）
# 构建：docker build -t dada .
# 运行：docker run -d -p 3000:3000 -v dada-data:/data dada
# 演示数据（可选，首次运行后手动执行）：docker compose exec app node src/seed.js
FROM node:22-alpine

# 容器内约定：代码在 /app，持久化数据（sqlite + uploads）统一放 /data 卷
ENV NODE_ENV=production \
    DADA_PORT=3000 \
    DADA_DB=/data/dada.sqlite

WORKDIR /app/server

# 1) 先只拷依赖清单并安装，最大化利用层缓存（源码变动不触发重装依赖）
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 2) 再拷源码、测试与前端静态文件（前端零构建，由同一 Express 进程托管）
COPY server/src ./src
COPY server/test ./test
COPY web/public /app/web/public

# 3) uploads 目录在代码中相对 src 定位（../data/uploads，见 index.js/users.js/posts.js），
#    这里把 server/data 软链到持久化卷 /data：sqlite（DADA_DB）与 uploads 同卷持久化。
#    seed.js 位于 server/src 内随镜像携带，但不放进启动流程——首次运行空卷时应用自建库，
#    需要演示数据时手动执行：docker compose exec app node src/seed.js
RUN mkdir -p /data \
 && ln -s /data /app/server/data \
 && chown -R node:node /app /data

# 以镜像内置非 root 用户运行
USER node

VOLUME /data

EXPOSE 3000

# 健康检查：busybox wget 打轻量接口 /api/meta
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O- "http://127.0.0.1:${DADA_PORT}/api/meta" >/dev/null 2>&1 || exit 1

CMD ["node", "src/index.js"]
