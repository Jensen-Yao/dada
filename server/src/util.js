import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, now } from './db.js';

// ---------- JWT 签名密钥（S1/A1 修复） ----------
// 此前回落到代码内置默认值 'dada-dev-secret-change-me'（公开仓库即知）→ 可离线伪造任意用户/管理员 token。
// 现在的优先级：DADA_JWT_SECRET 环境变量 → server/data/.jwt-secret 持久化文件（无则生成 32 字节随机 hex，权限 600）。
// 不再存在任何"代码内置默认密钥"路径；部署示例见 docker-compose.yml（${DADA_JWT_SECRET:?}）与 deploy/systemd-example.service。
function loadJwtSecret() {
  if (process.env.DADA_JWT_SECRET) return process.env.DADA_JWT_SECRET;
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', '.jwt-secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s) return s;
  } catch { /* 文件不存在 → 生成新密钥 */ }
  const secret = crypto.randomBytes(32).toString('hex'); // 64 hex = 32 字节熵
  fs.writeFileSync(file, secret, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* 个别文件系统不支持显式 chmod */ }
  console.warn('[dada] 已生成持久化密钥，生产环境请设置DADA_JWT_SECRET环境变量（server/data/.jwt-secret 仅用于本地/演示）');
  return secret;
}
const JWT_SECRET = loadJwtSecret();
const TOKEN_TTL = '30d';

export function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function getAuthUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(payload.uid, 'active');
  return user || null;
}

// 挂载 req.user；未登录返回 401
export function requireAuth(req, res, next) {
  // 已注销账号：明确返回"账号已注销"而非通用未登录（PIPL 47条）
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (payload) {
    const row = db.prepare('SELECT status FROM users WHERE id = ?').get(payload.uid);
    if (row && row.status === 'deleted') {
      return res.status(401).json({ error: '账号已注销' });
    }
  }
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  req.user = user;
  next();
}

// 可选登录：游客也能浏览广场
export function optionalAuth(req, _res, next) {
  req.user = getAuthUser(req);
  next();
}

export function publicUser(u) {
  if (!u) return null;
  const age = u.birth_year ? new Date().getFullYear() - u.birth_year : null;
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatar: u.avatar,
    gender: u.gender,
    age,
    city: u.city,
    district: u.district,
    school: u.school,
    occupation: u.occupation,
    mbti: u.mbti,
    bio: u.bio,
    tags: safeJSON(u.tags, []),
    verify_student: !!u.verify_student,
    verify_real: !!u.verify_real,
    credit: u.credit,
    post_count: 0,
    rating_avg: null,
    rec_off: !!u.rec_off, // 个性化推荐关闭状态（算法推荐规定17条，前端用于展示开关）
  };
}

export function safeJSON(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------- 事件埋点（VD-01 成搭漏斗） ----------
// 静默失败：埋点绝不影响主流程（游客 userId 传 null）
export function trackEvent(userId, type, postId) {
  try {
    db.prepare('INSERT INTO events (user_id, type, post_id, created_at) VALUES (?,?,?,?)')
      .run(userId ?? null, String(type), postId ?? null, now());
  } catch { /* 静默失败 */ }
}

// ---------- 搭友关系（VD-03 搭后关系容器） ----------
// 创建/累加搭友关系：一对用户按 id 排序（a<b）落唯一一行；互评完成一次 → times+1
export function getOrCreatePartner(aId, bId, postId = null) {
  if (aId === bId || !aId || !bId) return null;
  const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
  const exist = db.prepare('SELECT * FROM partners WHERE user_a = ? AND user_b = ?').get(a, b);
  if (!exist) {
    db.prepare('INSERT INTO partners (user_a, user_b, times, last_post_id, created_at) VALUES (?,?,1,?,?)')
      .run(a, b, postId, now());
    return { user_a: a, user_b: b, times: 1, last_post_id: postId };
  }
  db.prepare('UPDATE partners SET times = times + 1, last_post_id = ? WHERE user_a = ? AND user_b = ?')
    .run(postId, a, b);
  return { ...exist, times: exist.times + 1, last_post_id: postId };
}

// ---------- 搭子类型目录 ----------
// EM-02：emoji 字段迁移为 icon（值为前端 ui.js CAT_ICONS 的线性图标名）
export const CATEGORIES = [
  { key: 'food', name: '美食干饭', icon: 'utensils' },
  { key: 'sports', name: '运动健身', icon: 'activity' },
  { key: 'study', name: '学习自习', icon: 'book-open' },
  { key: 'travel', name: '旅行徒步', icon: 'mountain' },
  { key: 'live', name: '演出live', icon: 'mic' },
  { key: 'game', name: '游戏开黑', icon: 'gamepad' },
  { key: 'movie', name: '电影观影', icon: 'film' },
  { key: 'photo', name: '摄影扫街', icon: 'camera' },
  { key: 'pet', name: '遛狗宠物', icon: 'paw' },
  { key: 'coffee', name: '咖啡探店', icon: 'coffee' },
  { key: 'shopping', name: '逛街购物', icon: 'shopping-bag' },
  { key: 'boardgame', name: '剧本桌游', icon: 'dice' },
  { key: 'commute', name: '通勤拼车', icon: 'car' },
  { key: 'other', name: '其他搭子', icon: 'tag' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
export const FEE_MODES = {
  free: '免费',
  aa: '费用AA',
  treat: '我请客',
};
export const GENDER_REQS = { any: '不限', female: '仅限女生', male: '仅限男生' };
export const RATE_TAGS = ['守时', '靠谱', '友善', '有趣', '聊得来', '再次约'];

// ---------- 内容安全：敏感词过滤 ----------
const SENSITIVE_WORDS = [
  '加微信', '加v', '加V', '威信', '薇信', 'vx', 'VX', '加Q', '刷单', '兼职日结',
  '博彩', '赌球', '贷款包过', '裸聊', '约炮', '一夜情', '嫖', '枪支', '毒品',
  '转账', '汇款', '保证金', '解冻费', '投资稳赚', '内部渠道', '高回报',
  // 涉黄暗语（据平台治理案例）
  '费用全包', '包食宿', '包吃住', '包机票', '全包价', '女生免费', '妹妹陪',
  // 涉黄暗语补充（搭子赛道专项治理：纯绿/半绿等暗语、线下有偿陪侍话术）
  '纯绿', '半绿', '绿色陪', '可约', '线下有偿', '有偿陪',
  // 代订诈骗话术
  '代订酒店', '代订机票', '内部票价', '优惠代充',
];

export function filterContent(text) {
  let hits = [];
  let cleaned = String(text || '');
  for (const w of SENSITIVE_WORDS) {
    if (cleaned.toLowerCase().includes(w.toLowerCase())) {
      hits.push(w);
      cleaned = cleaned.split(w).join('*'.repeat(w.length));
    }
  }
  return { cleaned, hits };
}

// ---------- 通知 ----------
// operatorId：触发通知的操作者（点赞/评论/申请等用户行为）。
// 接收方与操作者存在拉黑关系（双向任一）时不投递，避免拉黑后仍被骚扰（H2）。
export function notify(userId, type, title, body = '', data = {}, operatorId = null) {
  if (operatorId && operatorId !== userId && anyBlocked(userId, operatorId)) return;
  db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, data, created_at) VALUES (?,?,?,?,?,?)'
  ).run(userId, type, title, body, JSON.stringify(data), now());
}

// ---------- 搭力值（信用体系） ----------
export const CREDIT_MIN_POST = 300; // 低于该分不能发布新搭局

export function addCredit(userId, delta, reason) {
  db.prepare('UPDATE users SET credit = MAX(0, MIN(1000, credit + ?)) WHERE id = ?').run(delta, userId);
  const u = db.prepare('SELECT credit FROM users WHERE id = ?').get(userId);
  notify(userId, 'credit', `搭力值${delta > 0 ? '+' : ''}${delta}`,
    `${reason}，当前搭力值 ${u.credit}`, { delta, credit: u.credit });
}

// 违规警告：3 次封号
export function warnUser(userId, reason) {
  db.prepare('UPDATE users SET warnings = warnings + 1 WHERE id = ?').run(userId);
  const u = db.prepare('SELECT warnings FROM users WHERE id = ?').get(userId);
  if (u.warnings >= 3) {
    db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(userId);
  } else {
    notify(userId, 'warning', '违规警告', `${reason}。累计 3 次违规将封号，当前已累计 ${u.warnings} 次。`);
  }
}

// 拉黑检查：a 是否拉黑了 b
export function isBlocked(aId, bId) {
  return !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(aId, bId);
}

export function anyBlocked(aId, bId) {
  return isBlocked(aId, bId) || isBlocked(bId, aId);
}

// ---------- 通用响应 ----------
export function ok(data) {
  return { ok: true, data };
}

export function fail(message, code = 400) {
  const err = new Error(message);
  err.status = code;
  return err;
}

// 简单分页参数
export function pageArgs(query, defaultSize = 20) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const size = Math.min(50, Math.max(1, parseInt(query.size) || defaultSize));
  return { page, size, offset: (page - 1) * size };
}
