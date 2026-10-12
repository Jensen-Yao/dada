#!/usr/bin/env bash
# =====================================================================
# 搭搭 App — 部署脚本（示例）
# 流程：本地 rsync 代码到服务器 → 备份 /data 数据卷 → docker compose up -d --build
# 前提：本地可 ssh 免密登录服务器；服务器已装 Docker 与 docker compose 插件
# =====================================================================
set -euo pipefail

# ====== 按需修改以下变量 ======
SERVER_USER="root"
SERVER_HOST="your.server.example.com"
APP_DIR="/opt/dada"                 # 服务器上的应用目录（compose 项目名取目录名）
# ==============================

SSH_TARGET="${SERVER_USER}@${SERVER_HOST}"
# compose 项目名 = APP_DIR 目录名（小写），数据卷名为 <项目名>_dada-data
PROJECT_NAME="$(basename "${APP_DIR}" | tr 'A-Z' 'a-z')"
VOLUME_NAME="${PROJECT_NAME}_dada-data"

echo "==> [1/4] 校验本地与服务器环境"
command -v rsync >/dev/null 2>&1 || { echo "错误：本地缺少 rsync"; exit 1; }
ssh "${SSH_TARGET}" "command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1" \
  || { echo "错误：服务器缺少 docker 或 docker compose 插件"; exit 1; }

echo "==> [2/4] 同步代码到 ${SSH_TARGET}:${APP_DIR}"
ssh "${SSH_TARGET}" "mkdir -p '${APP_DIR}'"
rsync -avz --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'server/node_modules/' \
  --exclude 'server/data/' \
  --exclude 'android/' \
  --exclude 'ios/' \
  --exclude 'docs/' \
  ./ "${SSH_TARGET}:${APP_DIR}/"

echo "==> [3/4] 服务器上：升级前备份数据卷（含 sqlite 与 uploads），再构建启动"
# ⚠️ 迁移提示：每次升级前必须备份数据卷；升级若涉及数据库结构变更（未来加列），
#    请先在测试环境演练并编写迁移脚本，再按 README「升级流程」操作。
ssh "${SSH_TARGET}" bash -s "${APP_DIR}" "${VOLUME_NAME}" <<'REMOTE'
set -euo pipefail
APP_DIR="$1"; VOLUME_NAME="$2"
cd "${APP_DIR}"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/var/backups/dada"
mkdir -p "${BACKUP_DIR}"

# 数据卷备份（应用仍在跑，WAL 模式下 tar 一致性足够做日常备份；
# 严谨的热备可在备份前先 sqlite3 '.backup'，见 README）
if docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
  docker run --rm -v "${VOLUME_NAME}:/data:ro" -v "${BACKUP_DIR}:/backup" alpine \
    tar czf "/backup/dada-data-${TS}.tgz" -C /data .
  echo "已备份 -> ${BACKUP_DIR}/dada-data-${TS}.tgz"
else
  echo "（首次部署，数据卷不存在，跳过备份）"
fi

docker compose up -d --build
docker compose ps
REMOTE

echo "==> [4/4] 部署完成"
echo "    看日志：   ssh ${SSH_TARGET} 'cd ${APP_DIR} && docker compose logs -f app'"
echo "    健康检查： curl -fsS http://127.0.0.1:3000/api/meta（在服务器上执行）"
echo "    演示数据（仅内网/本地演示用，公网勿执行）：ssh ${SSH_TARGET} 'cd ${APP_DIR} && docker compose exec app node src/seed.js'"
