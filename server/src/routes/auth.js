import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, now } from '../db.js';
import { signToken, requireAuth, ok, publicUser, safeJSON, trackEvent } from '../util.js';

export const authRouter = Router();

// ---------- 短信验证码（网安法24条：手机号注册） ----------
// 演示环境：验证码存进程内存 Map（重启失效），响应直接带回 demo_code；
// 接入真实短信 SDK 时：删除 demo_code 字段，改为调用运营商通道下发。
const smsCodes = new Map(); // phone -> { code, expires, sentAt }
const SMS_TTL = 5 * 60 * 1000;      // 验证码 5 分钟有效
const SMS_RESEND_INTERVAL = 60 * 1000; // 60 秒内禁止重发

// S4/A9 修复：/sms/send 每IP每小时限流（内存级滑动窗口）。
// 此前仅按手机号 60s 一条限频——换号即可无限轰炸短信通道并撑爆 smsCodes Map。
const SMS_IP_LIMIT = 10;              // 每 IP 每小时最多 10 条
const SMS_IP_WINDOW = 3600 * 1000;
const smsIpLog = new Map(); // ip -> [发送时间戳]

// S8/A4 缓解：登录接口每IP限频（内存级），超限 429——防在线爆破弱口令 & bcrypt 同步阻塞被并发打满。
const LOGIN_IP_LIMIT = 20;            // 每 IP 15 分钟最多 20 次
const LOGIN_IP_WINDOW = 15 * 60 * 1000;
const loginIpLog = new Map(); // ip -> [尝试时间戳]

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

const PHONE_RE = /^1[3-9]\d{9}$/;

authRouter.post('/sms/send', (req, res) => {
  const { phone, scene } = req.body || {};
  if (!PHONE_RE.test(String(phone || ''))) {
    return res.status(400).json({ error: '手机号格式不正确' });
  }
  // 每 IP 滑动窗口限流（S4）：换手机号也绕不过
  const t0 = Date.now();
  const ipLog = (smsIpLog.get(clientIp(req)) || []).filter((ts) => t0 - ts < SMS_IP_WINDOW);
  if (ipLog.length >= SMS_IP_LIMIT) {
    return res.status(429).json({ error: '发送过于频繁，请稍后再试' });
  }
  // C5（R3完整性）：scene='reset' = 找回/重置密码通道——手机号必须已注册（与注册通道互为镜像）；
  // 默认 scene='register' 维持原行为（已注册 409）。两通道共用同一 smsCodes 存储，
  // 验证码一次性消费（成功即删），注册用过的码不能复用于重置，反之亦然。
  if (scene === 'reset') {
    if (!db.prepare("SELECT 1 FROM users WHERE phone = ? AND status != 'deleted'").get(phone)) {
      return res.status(404).json({ error: '该手机号未注册' });
    }
  } else if (db.prepare("SELECT 1 FROM users WHERE phone = ? AND status != 'deleted'").get(phone)) {
    return res.status(409).json({ error: '该手机号已注册' });
  }
  const t = Date.now();
  const prev = smsCodes.get(phone);
  if (prev && t - prev.sentAt < SMS_RESEND_INTERVAL) {
    return res.status(429).json({ error: '发送过于频繁，请 60 秒后再试' });
  }
  // 顺手清理过期验证码条目（A9：Map 只增不减 → 内存无上限）
  for (const [k, v] of smsCodes) {
    if (Date.now() > v.expires) smsCodes.delete(k);
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  smsCodes.set(phone, { code, expires: t + SMS_TTL, sentAt: t });
  ipLog.push(t);
  smsIpLog.set(clientIp(req), ipLog);
  // 演示环境：直接返回验证码，方便联调与审核演示（真实现接短信 SDK 后移除）
  res.json(ok({ sent: true, demo_code: code }));
});

function verifySmsCode(phone, code) {
  const rec = smsCodes.get(phone);
  if (!rec) return false;
  if (Date.now() > rec.expires) {
    smsCodes.delete(phone); // 过期即清（A9：不再驻留内存）
    return false;
  }
  return rec.code === String(code || '');
}

// 手机号可读性：自动生成用户名 dadu_<手机号后8位>，冲突时追加随机后缀
function genUsernameByPhone(phone) {
  const base = `dadu_${String(phone).slice(-8)}`;
  let name = base;
  while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) {
    name = `${base}_${Math.random().toString(36).slice(2, 6)}`;
  }
  return name;
}

function findUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

authRouter.post('/register', (req, res) => {
  const body = req.body || {};

  // ---------- 手机号+验证码注册模式（合规主流程，网安法24条 + PIPL 31条年龄确认） ----------
  if (body.phone !== undefined) {
    const { phone, code, password, nickname, adult_confirmed } = body;
    if (!PHONE_RE.test(String(phone || ''))) {
      return res.status(400).json({ error: '手机号格式不正确' });
    }
    if (!verifySmsCode(phone, code)) {
      return res.status(400).json({ error: '验证码错误或已过期' });
    }
    if (adult_confirmed !== true) {
      return res.status(400).json({ error: '需确认已满18岁' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: '密码至少 6 位' });
    }
    if (db.prepare("SELECT 1 FROM users WHERE phone = ? AND status != 'deleted'").get(phone)) {
      return res.status(409).json({ error: '该手机号已注册' });
    }
    const nick = nickname ? String(nickname).trim() : `搭友${String(phone).slice(-4)}`;
    if (nick.length < 1 || nick.length > 20) {
      return res.status(400).json({ error: '昵称需为 1-20 个字符' });
    }
    // 用户批评R1（Amy#1/老王#2，P0）：注册表单收集的 gender/city 此前被硬编码丢弃
    // （gender='secret', city=''）→ 女性用户永远进不了女生局、发布页城市永不预填。现入库。
    const gender = ['male', 'female', 'secret'].includes(body.gender) ? body.gender : 'secret';
    const city = String(body.city || '').trim().slice(0, 60); // 与用户名注册模式/PUT /me 的 60 上限对齐
    const username = genUsernameByPhone(phone);
    const hash = bcrypt.hashSync(String(password), 10);
    const t = now();
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, nickname, gender, birth_year, city, tags, phone, adult_confirmed, created_at, last_active_at)
      VALUES (?,?,?,?,NULL,?,'[]',?,1,?,?)
    `).run(username, hash, nick, gender, city, phone, t, t);
    smsCodes.delete(phone); // 验证码一次性使用
    const user = findUser(info.lastInsertRowid);
    trackEvent(user.id, 'register'); // VD-01 漏斗：注册
    return res.json(ok({ token: signToken(user), user: publicUser(user) }));
  }

  // ---------- 用户名注册模式（存量测试兼容保留） ----------
  const { username, password, nickname, gender, birth_year, city } = body;
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为 3-20 位字母、数字或下划线' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  if (!nickname || String(nickname).trim().length < 1 || String(nickname).length > 20) {
    return res.status(400).json({ error: '昵称需为 1-20 个字符' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: '用户名已被注册' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const t = now();
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, nickname, gender, birth_year, city, tags, created_at, last_active_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(username, hash, String(nickname).trim(), ['male', 'female', 'secret'].includes(gender) ? gender : 'secret',
    birth_year ? parseInt(birth_year) : null, String(city || '').trim().slice(0, 60), '[]', t, t);
  const user = findUser(info.lastInsertRowid);
  trackEvent(user.id, 'register'); // VD-01 漏斗：注册（用户名模式）
  res.json(ok({ token: signToken(user), user: publicUser(user) }));
});

authRouter.post('/login', (req, res) => {
  // 每 IP 限频（S8）：在 bcrypt.compareSync 之前拦截，超限直接 429，不再消耗同步 CPU（A4）
  const ip = clientIp(req);
  const t0 = Date.now();
  const log = (loginIpLog.get(ip) || []).filter((ts) => t0 - ts < LOGIN_IP_WINDOW);
  if (log.length >= LOGIN_IP_LIMIT) {
    return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
  }
  log.push(t0);
  loginIpLog.set(ip, log);
  const { username, phone, password } = req.body || {};
  const isPhone = phone !== undefined && phone !== null && phone !== '';
  const user = isPhone
    ? db.prepare('SELECT * FROM users WHERE phone = ?').get(String(phone || ''))
    : db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  // 已注销账号：明确告知（PIPL 47条注销后不可再登录）
  if (user && user.status === 'deleted') {
    return res.status(401).json({ error: '账号已注销' });
  }
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: isPhone ? '手机号或密码错误' : '用户名或密码错误' });
  }
  if (user.status === 'banned') {
    return res.status(403).json({ error: '账号已被封禁，如有疑问请申诉' });
  }
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now(), user.id);
  res.json(ok({ token: signToken(user), user: publicUser(user) }));
});

// ---------- C5（R3完整性）：验证码找回/重置密码 ----------
// 手机号注册却不能短信找回 = 忘密码永久锁号。复用 smsCodes 验证（scene='reset' 下发），
// 验证码一次性消费：仅重置成功时删除，失败尝试不烧码；注册与重置共用一个通道，不可重放。
authRouter.post('/password/reset', (req, res) => {
  const { phone, code, password } = req.body || {};
  if (!PHONE_RE.test(String(phone || ''))) {
    return res.status(400).json({ error: '手机号格式不正确' });
  }
  if (!verifySmsCode(phone, code)) {
    return res.status(400).json({ error: '验证码错误或已过期' });
  }
  const user = db.prepare("SELECT * FROM users WHERE phone = ? AND status != 'deleted'").get(String(phone));
  if (!user) {
    return res.status(404).json({ error: '该手机号未注册' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  smsCodes.delete(phone); // 成功即消费（注意顺序：校验全过才删，失败不烧码）
  res.json(ok({ reset: true }));
});

authRouter.get('/me', requireAuth, (req, res) => {
  const u = findUser(req.user.id);
  const postCount = db.prepare("SELECT COUNT(*) c FROM posts WHERE user_id = ?").get(u.id).c;
  const joinedCount = db.prepare("SELECT COUNT(*) c FROM joins WHERE user_id = ? AND status = 'approved'").get(u.id).c;
  const pu = publicUser(u);
  pu.post_count = postCount;
  pu.joined_count = joinedCount;
  pu.unread_notif = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(u.id).c;
  pu.unread_chat = db.prepare(`
    SELECT COUNT(*) c FROM messages m JOIN conversations c2 ON m.conv_id = c2.id
    WHERE m.read_at IS NULL AND m.sender_id != ?
      AND ((c2.user_a = ?) OR (c2.user_b = ?))
  `).get(u.id, u.id, u.id).c;
  pu.warnings = u.warnings;
  res.json(ok(pu));
});
