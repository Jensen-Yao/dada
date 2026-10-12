import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DADA_DB || path.join(DATA_DIR, 'dada.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export const SCHEMA_VERSION = 1;

// 轻量迁移：posts.images（老库兼容）
try {
  db.exec("ALTER TABLE posts ADD COLUMN images TEXT NOT NULL DEFAULT '[]'");
} catch { /* 列已存在 */ }

db.exec(`
CREATE TABLE IF NOT EXISTS users (
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
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  location_name TEXT DEFAULT '',
  meet_time TEXT DEFAULT '',
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
`);

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
