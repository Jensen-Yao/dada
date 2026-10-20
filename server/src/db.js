import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DADA_DB || path.join(DATA_DIR, 'dada.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// [D-P1] 损坏库友好启动：此前文件头/数据页损坏时 new DatabaseSync 或 PRAGMA journal_mode
// 直接抛裸错误崩溃（R5 实测 'file is not a database' / 'malformed database schema'），运维无从下手。
// 现捕获后给出明确指引并拒绝启动（fail-fast，不带上病库继续跑）。
let db;
try {
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
} catch (e) {
  console.error('[dada] 数据库打开失败：', e.message, `（${DB_PATH}）`);
  console.error('[dada] 数据库文件可能已损坏，请从最近一次备份恢复后重启。');
  console.error('[dada] 恢复 runbook：docs/db-schema.md「损坏应急」章节 / docs/review-db-r5.md 附录');
  console.error('[dada] （恢复步骤：停进程 → 保留损坏文件取证 → VACUUM INTO 备份恢复到新文件 → integrity_check+行数比对 → 改 DADA_DB 指向 → 重启冒烟）');
  process.exit(1);
}
export { db };

export const SCHEMA_VERSION = 1; // 与 PRAGMA user_version 对齐（迁移成功后落库，启动时读取打印）

// [D-P1] 迁移失败 fail-fast：带病运行比不启动更糟——R5 实测 users 迁移失败被吞后服务照常启动，
// 注销功能 100% 500（CHECK constraint failed），且无任何健康检查能发现。现统一：迁移出错即退出。
function migrateOrFail(label, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`[dada] 数据库迁移失败（${label}）：`, e.message);
    console.error('[dada] 拒绝带病启动，进程退出。请修复数据库或从备份恢复后重启（见 docs/db-schema.md「损坏应急」章节）。');
    process.exit(1);
  }
}

// [D-P2-1] 列 ADD 只吞"列已存在"（幂等重放的预期分支）与"表不存在"（新库：表稍后由
// CREATE TABLE IF NOT EXISTS 创建、建表语句已含该列），磁盘满/只读/损坏等真实错误一律上抛 fail-fast。
// （此前 try{ALTER}catch{} 吞掉一切错误，静默跳过所有失败。）
function tryAddColumn(ddl) {
  try {
    db.exec(ddl);
  } catch (e) {
    const msg = String(e.message);
    if (msg.includes('duplicate column name')) return; // 列已存在：老库重放
    if (msg.includes('no such table')) return;         // 新库：表稍后创建且已含该列
    throw e;
  }
}

// 轻量迁移：posts.images（老库兼容）
tryAddColumn("ALTER TABLE posts ADD COLUMN images TEXT NOT NULL DEFAULT '[]'");

// users 表结构（v2 合规专项）：新增 phone / adult_confirmed / rec_off 列；
// status 新增 'deleted'（账号注销，PIPL 47条 + Apple 5.1.1(v)）
const USERS_TABLE_SQL = `
CREATE TABLE %s (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar TEXT DEFAULT NULL,
  gender TEXT NOT NULL DEFAULT 'secret' CHECK (gender IN ('male','female','secret')),
  birth_year INTEGER DEFAULT NULL,
  city TEXT NOT NULL DEFAULT '',
  district TEXT DEFAULT '',
  school TEXT DEFAULT '',
  occupation TEXT DEFAULT '',
  mbti TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  verify_student INTEGER NOT NULL DEFAULT 0,
  verify_real INTEGER NOT NULL DEFAULT 0,
  verify_pending INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 600,
  warnings INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned','deleted')),
  phone TEXT DEFAULT NULL,
  adult_confirmed INTEGER NOT NULL DEFAULT 0,
  rec_off INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
);`;

// 迁移：老库 users 表 CHECK 约束不含 'deleted'，SQLite 无法 ALTER CHECK，需整表重建
// （标准五步法：关外键 → 建新表 → 拷数据 → 删旧表 → 改名，均在事务内）
// [D-P1] 动态列携带（修复 R5-P1-1：硬编码 COLS 清单外的列被静默丢弃）：
//   新表 DDL 由库内真实 schema 派生（只替换 status CHECK），再把"中间版本经 ALTER 加过、
//   不在原始 CREATE 语句里"的列按 PRAGMA table_info 还原补齐——任意来源的新列自动携带。
migrateOrFail('users 重建（status CHECK 增 deleted）', () => {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (row && !row.sql.includes("'deleted'")) {
    const newSql = row.sql
      .replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?"?users"?\s*\(/i, 'CREATE TABLE users_new (')
      .replace(/CHECK\s*\(\s*status\s+IN\s*\(\s*'active'\s*,\s*'banned'\s*\)\s*\)/i, "CHECK (status IN ('active','banned','deleted'))");
    if (!newSql.includes("'deleted'")) {
      throw new Error('users 建表语句与预期不符（未匹配到 status CHECK），拒绝盲目重建');
    }
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN;');
    db.exec(newSql);
    // 补齐 ALTER 附加列：sqlite_master.sql 只含原始 CREATE 的列，table_info 才是全量
    const oldCols = db.prepare('PRAGMA table_info(users)').all();
    const newColNames = new Set(db.prepare('PRAGMA table_info(users_new)').all().map((c) => c.name));
    const carried = [];
    for (const c of oldCols) {
      if (newColNames.has(c.name)) continue;
      // 按元数据还原列定义（type/NOT NULL/DEFAULT；ALTER 附加列的 UNIQUE/CHECK 无法从库内还原，
      // 数据保真优先，约束由后续版本的迁移逻辑重建）
      let def = `"${c.name}" ${c.type || 'TEXT'}`;
      if (c.dflt_value != null) def += ` DEFAULT ${c.dflt_value}`;
      if (c.notnull && c.dflt_value != null) def += ' NOT NULL';
      db.exec(`ALTER TABLE users_new ADD COLUMN ${def}`);
      carried.push(c.name);
    }
    const colList = oldCols.map((c) => `"${c.name}"`).join(', ');
    db.exec(`INSERT INTO users_new (${colList}) SELECT ${colList} FROM users;`);
    const src = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const dst = db.prepare('SELECT COUNT(*) c FROM users_new').get().c;
    if (src !== dst) throw new Error(`users 迁移行数自检失败：源 ${src} 行，新表 ${dst} 行`); // [D-P2-2] 自校验
    db.exec('DROP TABLE users;');
    db.exec('ALTER TABLE users_new RENAME TO users;');
    db.exec('COMMIT;');
    db.exec('PRAGMA foreign_keys = ON;');
    console.log(`[dada] 迁移完成：users.status 支持 deleted（账号注销），共迁移 ${src} 行 / ${oldCols.length} 列`
      + (carried.length ? `（动态携带非原始 DDL 列：${carried.join(', ')}）` : ''));
  }
});

// 轻量迁移：合规新增列（老库兼容；新库建表已含，ALTER 会因列已存在而被吞掉）
tryAddColumn('ALTER TABLE users ADD COLUMN phone TEXT DEFAULT NULL;');
tryAddColumn('ALTER TABLE users ADD COLUMN adult_confirmed INTEGER NOT NULL DEFAULT 0;');
tryAddColumn('ALTER TABLE users ADD COLUMN rec_off INTEGER NOT NULL DEFAULT 0;');

db.exec(USERS_TABLE_SQL.replace('%s', 'IF NOT EXISTS users'));

// T7（R4状态机）：phone 部分唯一索引——同手机号防双注册从"纯依赖单进程串行性"升级为
// 应用层 check + 数据库唯一索引双保险（pm2 cluster/多容器共享 SQLite 时仍守住底线）。
// 部分索引（SQLite partial index）排除 NULL 与已注销账号：保留"注销释放手机号可复用"语义；
// 唯一索引对多行 NULL 视为互不相同 → 未绑定手机号的存量用户不受影响。
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL AND status != 'deleted'");
} catch (e) {
  // [D-P1] 与迁移同口径 fail-fast：索引缺位 = 同手机号双注册的应用层 check 成为唯一防线（多进程部署必穿）
  console.error('[dada] idx_users_phone 创建失败（存量数据可能存在重复手机号，需人工清洗后重启）:', e.message);
  console.error('[dada] 拒绝带病启动，进程退出。请清洗重复手机号后重启。');
  process.exit(1);
}

db.exec(`
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  location_name TEXT DEFAULT '',
  meet_time TEXT DEFAULT '',
  meet_at INTEGER DEFAULT NULL,
  meet_repeat TEXT DEFAULT NULL,
  need_count INTEGER NOT NULL DEFAULT 1,
  fee_mode TEXT NOT NULL DEFAULT 'aa' CHECK (fee_mode IN ('free','aa','treat')),
  gender_req TEXT NOT NULL DEFAULT 'any' CHECK (gender_req IN ('any','female','male')),
  requirements TEXT DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','full','closed','done','expired')),
  likes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  views_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_city ON posts(city);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);

CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  post_id INTEGER NOT NULL REFERENCES posts(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

CREATE TABLE IF NOT EXISTS joins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','quit')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_joins_user ON joins(user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER REFERENCES posts(id),
  user_a INTEGER NOT NULL REFERENCES users(id),
  user_b INTEGER NOT NULL REFERENCES users(id),
  last_msg_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id INTEGER NOT NULL REFERENCES conversations(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','system','safety')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('user','post','comment','message')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id),
  blocked_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  rater_id INTEGER NOT NULL REFERENCES users(id),
  ratee_id INTEGER NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags TEXT NOT NULL DEFAULT '[]',
  comment TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (post_id, rater_id, ratee_id)
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- v3.0 VD-01 事件埋点：成搭漏斗原始数据（游客 user_id 为 NULL；只增不改，C3 兼容）
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,
  post_id INTEGER REFERENCES posts(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, created_at);

-- v3.0 VD-03 搭友表：搭后关系容器（id 小者存 user_a，a<b 排序保证一对用户仅一行）
CREATE TABLE IF NOT EXISTS partners (
  user_a INTEGER NOT NULL REFERENCES users(id),
  user_b INTEGER NOT NULL REFERENCES users(id),
  times INTEGER NOT NULL DEFAULT 0,
  last_post_id INTEGER DEFAULT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b)
);

-- Ops-O5 意见反馈：设置页"意见反馈"入口（用户提交，admin 队列处理并留痕）
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  action_text TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);
`);

// R3-C7/L3 举报处理留痕：admin resolve 写入处理时间与动作，举报人经 /api/reports/mine 查询进度
tryAddColumn('ALTER TABLE reports ADD COLUMN resolved_at INTEGER DEFAULT NULL');
tryAddColumn('ALTER TABLE reports ADD COLUMN resolve_action TEXT DEFAULT NULL');

// TS-1①（R5时间语义）meet_at 结构化：可空 epoch ms（UTC 存储）；meet_time 保留为人类可读显示文本
// （老帖/兜底路径不变，meet_at 为 NULL 时一切行为与加列前完全一致）。
// meet_repeat：周期局标记（'daily'|'weekly'，可空）——周期局豁免未来校验且永不过期（TS-2）。
tryAddColumn('ALTER TABLE posts ADD COLUMN meet_at INTEGER DEFAULT NULL');
tryAddColumn('ALTER TABLE posts ADD COLUMN meet_repeat TEXT DEFAULT NULL');

// [D-P1] schema 版本落库：迁移全部成功后写 PRAGMA user_version，启动时读取并打印——
// 回答"这库是哪个时代的"、为将来版本化迁移与升级门槛校验铺路
// （R5-P1-3：SCHEMA_VERSION 此前是零引用死常量，user_version 从未使用）。
const userVersion = db.prepare('PRAGMA user_version').get().user_version;
if (userVersion > SCHEMA_VERSION) {
  console.error(`[dada] 数据库 schema 版本（user_version=${userVersion}）高于当前代码支持版本（${SCHEMA_VERSION}），`
    + '这是用更新代码创建的库，旧代码写入可能损坏数据，拒绝启动。请升级代码。');
  process.exit(1);
}
if (userVersion < SCHEMA_VERSION) {
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
console.log(`[dada] schema 版本 user_version=${db.prepare('PRAGMA user_version').get().user_version}（代码支持 SCHEMA_VERSION=${SCHEMA_VERSION}）`);

export function now() {
  return Date.now();
}

export function getKV(k, fallback = null) {
  const row = db.prepare('SELECT v FROM kv WHERE k = ?').get(k);
  return row ? row.v : fallback;
}

export function setKV(k, v) {
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));
}
