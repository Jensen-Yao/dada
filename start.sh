#!/usr/bin/env bash
# 搭搭 App 一键启动脚本
set -e
cd "$(dirname "$0")/server"

# 首次运行安装依赖
if [ ! -d node_modules ]; then
  echo "📦 安装依赖..."
  npm install --no-audit --no-fund
fi

# 首次运行初始化演示数据
if [ ! -f data/dada.sqlite ]; then
  echo "🌱 初始化演示数据..."
  node src/seed.js
fi

PORT="${DADA_PORT:-3000}"
# 端口占用检测
if lsof -i :"$PORT" -sTCP:LISTEN > /dev/null 2>&1; then
  echo "⚠️  端口 $PORT 已被占用（搭搭可能已在运行）。"
  echo "   直接访问: http://localhost:${PORT}"
  echo "   或换端口启动: DADA_PORT=3001 ./start.sh"
  exit 1
fi
echo "🚀 搭搭启动中: http://localhost:${PORT}"
echo "   手机扫码/同局域网访问: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost):${PORT}"
echo "   演示账号: xiaoyu / 123456   管理员: admin / 123456"
exec env DADA_PORT="$PORT" node src/index.js
