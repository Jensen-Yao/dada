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

echo "==> [3/4] 服务器上：升级前在线备份数据库（一致性快照+校验），再构建启动"
# ⚠️ 迁移提示：每次升级前必须备份数据库；升级若涉及数据库结构变更（未来加列），
#    请先在测试环境演练并编写迁移脚本，再按 README「升级流程」操作。
ssh "${SSH_TARGET}" bash -s "${APP_DIR}" "${VOLUME_NAME}" <<'REMOTE'
set -euo pipefail
APP_DIR="$1"; VOLUME_NAME="$2"
cd "${APP_DIR}"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/var/backups/dada"
DB_IN_CONTAINER="/data/dada.sqlite"          # 容器内库路径（与 Dockerfile/compose 的 DADA_DB 一致）
BAK_NAME="dada-${TS}.sqlite"
BAK_IN_CONTAINER="/data/backup/${BAK_NAME}"  # 备份先落在数据卷内，最后再拷到宿主机
mkdir -p "${BACKUP_DIR}"

# ============================================================
# ⛔ 危险做法（旧版本备份方式，仅留档说明，已禁用）：
#   docker run --rm -v "${VOLUME_NAME}:/data:ro" ... tar czf "/backup/dada-data-${TS}.tgz" -C /data .
# 危险原因（R5 备份演练实测）：
#   1) 应用运行中 tar 依次读 dada.sqlite / -wal / -shm 是【非原子多文件拷贝】，无任何机制保证
#      三文件取到同一时间点——checkpoint 恰好发生在 tar 读 wal 时即得 torn copy；
#   2) 若 -wal 缺损/未包含，数据库静默回退到最后一次 checkpoint（实测 400 行丢 300 行）；
#   3) 最坏情形：只拷主文件得 integrity_check=ok 的旧快照，丢了全部未 checkpoint 的写入
#      （真实库约 93% 数据悬在 WAL），且校验全绿、无人能发现。
# ============================================================

# 应用容器未运行 = 首次部署（无数据可备），跳过备份直接构建启动
if [ -z "$(docker compose ps -q app)" ]; then
  echo "-- 应用容器未运行（首次部署），跳过备份"
else
  # 在线一致性备份：写入不中断，得到时间点一致的完整快照
  # 首选宿主机 sqlite3 CLI（仅当数据卷 bind-mount 到宿主机、库文件直接可见时走此分支）
  if command -v sqlite3 >/dev/null 2>&1 && [ -f /data/dada.sqlite ]; then
    echo "-- 使用宿主机 sqlite3 .backup 在线备份"
    mkdir -p /data/backup
    sqlite3 /data/dada.sqlite ".backup '/data/backup/${BAK_NAME}'"
  else
    # 兜底：容器内 node:sqlite 的 VACUUM INTO（容器里没有 sqlite3 CLI；同为 SQLite 在线一致性快照）
    echo "-- 使用容器内 node VACUUM INTO 在线备份"
    docker compose exec -T app node -e "
import('node:fs').then(({ mkdirSync }) => { mkdirSync('/data/backup', { recursive: true }); return import('node:sqlite'); }).then(({ DatabaseSync }) => {
  const db = new DatabaseSync(process.env.DADA_DB);
  db.exec(\"VACUUM INTO '/data/backup/${BAK_NAME}'\");
  db.close();
  console.log('VACUUM INTO 完成: ${BAK_NAME}');
});"
  fi

  # 备份后校验（R5 教训：备份必须附带校验输出，否则静默旧备份无人能发现）
  # integrity_check 必须 ok（否则中断部署），并对关键表做行数抽样打印
  docker compose exec -T app node -e "
import('node:sqlite').then(({ DatabaseSync }) => {
  const bak = new DatabaseSync('/data/backup/${BAK_NAME}');
  const ic = bak.prepare('PRAGMA integrity_check').get();
  if (ic.integrity_check !== 'ok') { console.error('备份校验失败：integrity_check=' + ic.integrity_check); process.exit(1); }
  const tables = ['users', 'posts', 'messages'];
  let out = '备份校验 integrity_check=ok；行数抽样：';
  for (const t of tables) out += t + '=' + bak.prepare('SELECT COUNT(*) c FROM ' + t).get().c + ' ';
  bak.close();
  console.log(out);
});"
  echo "-- 校验通过，拷出备份到宿主机 ${BACKUP_DIR}/"
  docker compose cp "app:${BAK_IN_CONTAINER}" "${BACKUP_DIR}/${BAK_NAME}"
  docker compose exec -T app rm -f "${BAK_IN_CONTAINER}"
fi

docker compose up -d --build
docker compose ps
REMOTE

echo "==> [4/4] 部署完成"
echo "    看日志：   ssh ${SSH_TARGET} 'cd ${APP_DIR} && docker compose logs -f app'"
echo "    健康检查： curl -fsS http://127.0.0.1:3000/api/meta（在服务器上执行）"
echo "    演示数据（仅内网/本地演示用，公网勿执行）：ssh ${SSH_TARGET} 'cd ${APP_DIR} && docker compose exec app node src/seed.js'"
