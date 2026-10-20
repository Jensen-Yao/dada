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
// R4灰产对抗（G1-d/G3）：词表拆两级——
//   HARD：导流（加微信/vx/加Q）与违法欺诈（转账/裸聊/博彩…）类，聊天命中直接【拒收】；
//   SOFT：涉黄暗语/收费话术等灰产信号，帖文申请仍拦截，聊天命中打码放行。
export const SENSITIVE_HARD = [
  '加微信', '加v', '威信', '薇信', 'vx', '加Q',
  '转账', '汇款', '保证金', '解冻费', '投资稳赚', '贷款包过',
  '刷单', '兼职日结', '博彩', '赌球',
  '裸聊', '约炮', '一夜情', '嫖', '枪支', '毒品',
];
export const SENSITIVE_SOFT = [
  '内部渠道', '高回报',
  // 涉黄暗语（据平台治理案例）
  '费用全包', '包食宿', '包吃住', '包机票', '全包价', '女生免费', '妹妹陪',
  // 涉黄暗语补充（搭子赛道专项治理：纯绿/半绿等暗语、线下有偿陪侍话术）
  '纯绿', '半绿', '绿色陪', '可约', '线下有偿', '有偿陪',
  // 代订诈骗话术
  '代订酒店', '代订机票', '内部票价', '优惠代充',
];

// R4灰产对抗（G1-a/G1-b）：匹配前归一化——封堵零宽字符 / 全半角 / 空格与分隔符拆字绕过。
// 逐步符处理并保留原文字符位置映射（idxMap），命中后可回原文精确打码。
const ZW_RE = /[\u200B-\u200D\uFEFF]/;
const SEP_RE = /[\s.\-_*·・,，。]/;
function foldChar(ch) {
  const code = ch.charCodeAt(0);
  // 全角 ASCII 区（！-～，含０-９ａ-ｚＡ-Ｚ）→ 半角
  if (code >= 0xFF01 && code <= 0xFF5E) return String.fromCharCode(code - 0xFEE0);
  return ch;
}
function normalizeForMatch(s) {
  let out = '';
  for (const raw of String(s || '')) {
    const ch = foldChar(raw);
    if (ZW_RE.test(ch) || SEP_RE.test(ch)) continue;
    out += ch.toLowerCase();
  }
  return out;
}
function buildNormIndex(text) {
  const chars = [...String(text || '')];
  const normBuf = [];
  const idxMap = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = foldChar(chars[i]);
    if (ZW_RE.test(ch) || SEP_RE.test(ch)) continue;
    normBuf.push(ch.toLowerCase());
    idxMap.push(i);
  }
  return { chars, norm: normBuf.join(''), idxMap };
}

// 归一化后的词表（去重，硬词优先；导出供测试核对拆分清单）
export const SENSITIVE_NORM = (() => {
  const seen = new Set();
  const list = [];
  for (const w of SENSITIVE_HARD) {
    const word = normalizeForMatch(w);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    list.push({ word, hard: true });
  }
  for (const w of SENSITIVE_SOFT) {
    const word = normalizeForMatch(w);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    list.push({ word, hard: false });
  }
  return list;
})();

function scanSensitive(text) {
  const { chars, norm, idxMap } = buildNormIndex(text);
  const hardHits = [];
  const softHits = [];
  const spans = [];
  for (const { word, hard } of SENSITIVE_NORM) {
    let from = 0;
    for (;;) {
      const i = norm.indexOf(word, from);
      if (i === -1) break;
      from = i + 1;
      (hard ? hardHits : softHits).push(word);
      spans.push([idxMap[i], idxMap[i + word.length - 1]]);
    }
  }
  // 合并重叠区间后按原文位置打码（emoji 等未参与匹配的字符原样保留）
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  for (const [s, e] of merged) {
    for (let i = s; i <= e; i++) chars[i] = '*';
  }
  return { cleaned: chars.join(''), hits: [...hardHits, ...softHits], hardHits, softHits };
}

// 签名兼容：帖文/评论/申请等"命中即拒"路径继续用 filterContent（hits 含硬+软）
export function filterContent(text) {
  const { cleaned, hits } = scanSensitive(text);
  return { cleaned, hits };
}

// R4（G1-d）：聊天通道专用——额外区分 hardHits（命中即拒收）与 softHits（打码放行）
export function filterContentStrict(text) {
  return scanSensitive(text);
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
