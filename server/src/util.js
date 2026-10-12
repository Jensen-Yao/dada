import jwt from 'jsonwebtoken';
import { db, now } from './db.js';

const JWT_SECRET = process.env.DADA_JWT_SECRET || 'dada-dev-secret-change-me';
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
export function notify(userId, type, title, body = '', data = {}) {
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
