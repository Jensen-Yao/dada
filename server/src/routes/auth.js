import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, now } from '../db.js';
import { signToken, requireAuth, ok, publicUser, safeJSON } from '../util.js';

export const authRouter = Router();

function findUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

authRouter.post('/register', (req, res) => {
  const { username, password, nickname, gender, birth_year, city } = req.body || {};
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
  res.json(ok({ token: signToken(user), user: publicUser(user) }));
});

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  if (user.status === 'banned') {
    return res.status(403).json({ error: '账号已被封禁，如有疑问请申诉' });
  }
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now(), user.id);
  res.json(ok({ token: signToken(user), user: publicUser(user) }));
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
