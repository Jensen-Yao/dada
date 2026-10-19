import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, now } from '../db.js';
import { requireAuth, optionalAuth, ok, publicUser, notify, addCredit, anyBlocked, safeJSON } from '../util.js';

export const usersRouter = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname) || '.jpg'}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持图片文件'));
  },
});

// ---------- 他人主页 ----------
usersRouter.get('/:id', optionalAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(req.params.id));
  if (!u || u.status === 'banned') return res.status(404).json({ error: '用户不存在' });
  const pu = publicUser(u);
  pu.post_count = db.prepare("SELECT COUNT(*) c FROM posts WHERE user_id = ? AND status != 'closed'").get(u.id).c;
  const r = db.prepare('SELECT AVG(stars) avg, COUNT(*) c FROM ratings WHERE ratee_id = ?').get(u.id);
  pu.rating_avg = r.c ? Math.round(r.avg * 10) / 10 : null;
  pu.rating_count = r.c;
  pu.rating_tags = db.prepare("SELECT tags FROM ratings WHERE ratee_id = ? ORDER BY id DESC LIMIT 50").all(u.id)
    .flatMap((row) => safeJSON(row.tags, []));
  // 最近完成的搭局
  pu.recent_done = db.prepare(`
    SELECT p.id, p.title, p.category, p.meet_time FROM posts p
    WHERE p.user_id = ? AND p.status = 'done' ORDER BY p.id DESC LIMIT 5
  `).all(u.id);
  // 拉黑关系字段（R1延期项）：登录视角标记"我是否拉黑了 TA"，用于用户主页"已拉黑"标识，游客恒 false
  pu.blocked_by_me = req.user
    ? !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.user.id, u.id)
    : false;
  res.json(ok(pu));
});

// ---------- 编辑自己的资料 ----------
usersRouter.put('/me', requireAuth, (req, res) => {
  const allowed = ['nickname', 'gender', 'birth_year', 'city', 'district', 'school', 'occupation', 'mbti', 'bio'];
  const sets = [];
  const vals = [];
  const body = req.body || {};
  for (const k of allowed) {
    if (body[k] === undefined) continue;
    let v = body[k];
    if (k === 'gender') {
      if (!['male', 'female', 'secret'].includes(v)) return res.status(400).json({ error: '性别参数不合法' });
    } else if (k === 'birth_year') {
      const y = parseInt(v);
      if (!y || y < 1900 || y > new Date().getFullYear() - 12) return res.status(400).json({ error: '出生年份不合法' });
      v = y;
    } else {
      // H5：bio 与前端 maxlength=200 对齐（此前静默截断到 60 吞掉近半内容），其余字段维持 60
      v = String(v ?? '').trim().slice(0, k === 'bio' ? 200 : 60);
    }
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (Array.isArray(body.tags)) {
    const tags = body.tags.map(String).slice(0, 10).map((t) => t.slice(0, 12));
    sets.push('tags = ?');
    vals.push(JSON.stringify(tags));
  }
  if (sets.length) {
    vals.push(req.user.id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json(ok(publicUser(u)));
});

// ---------- 头像上传 ----------
usersRouter.post('/me/avatar', requireAuth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片' });
  const rel = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(rel, req.user.id);
  res.json(ok({ avatar: rel }));
});

// ---------- 认证（演示环境自动通过审核） ----------
usersRouter.post('/me/verify', requireAuth, (req, res) => {
  const { type, school } = req.body || {};
  const u = req.user;
  if (type === 'student') {
    if (!school || !String(school).trim()) return res.status(400).json({ error: '请填写学校名称' });
    if (u.verify_student) return res.status(400).json({ error: '已通过学生认证' });
    db.prepare('UPDATE users SET verify_student = 1, school = ? WHERE id = ?').run(String(school).trim(), u.id);
    if (!u.verify_student) addCredit(u.id, 30, '通过学生认证');
  } else if (type === 'real') {
    if (u.verify_real) return res.status(400).json({ error: '已通过真人认证' });
    db.prepare('UPDATE users SET verify_real = 1 WHERE id = ?').run(u.id);
    addCredit(u.id, 50, '通过真人认证');
  } else {
    return res.status(400).json({ error: '认证类型不合法' });
  }
  const nu = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  res.json(ok(publicUser(nu)));
});

// ---------- 我收到的评价 ----------
usersRouter.get('/me/ratings', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.nickname rater_nickname, u.avatar rater_avatar, p.title post_title
    FROM ratings r JOIN users u ON r.rater_id = u.id JOIN posts p ON r.post_id = p.id
    WHERE r.ratee_id = ? ORDER BY r.id DESC LIMIT 50
  `).all(req.user.id);
  res.json(ok(rows.map((r) => ({
    id: r.id, stars: r.stars, tags: safeJSON(r.tags, []), comment: r.comment, created_at: r.created_at,
    rater: { id: r.rater_id, nickname: r.rater_nickname, avatar: r.rater_avatar },
    post_title: r.post_title,
  }))));
});

// ---------- 拉黑 / 取消拉黑 ----------
usersRouter.post('/:id/block', requireAuth, (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: '不能拉黑自己' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(targetId)) return res.status(404).json({ error: '用户不存在' });
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)').run(req.user.id, targetId, now());
  res.json(ok({ blocked: true }));
});

usersRouter.delete('/:id/block', requireAuth, (req, res) => {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, parseInt(req.params.id));
  res.json(ok({ blocked: false }));
});

usersRouter.get('/me/blocks', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.nickname, u.avatar FROM blocks b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = ?
  `).all(req.user.id);
  res.json(ok(rows));
});

// ---------- 举报 ----------
usersRouter.post('/:id/report', requireAuth, (req, res) => {
  const { reason, detail } = req.body || {};
  const reasons = ['骚扰', '欺诈', '虚假信息', '言语辱骂', '人身安全', '其他'];
  if (!reasons.includes(reason)) return res.status(400).json({ error: '请选择举报理由' });
  const targetId = parseInt(req.params.id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(targetId)) return res.status(404).json({ error: '用户不存在' });
  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, created_at) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, 'user', targetId, reason, String(detail || '').slice(0, 500), now());
  // 演示环境自动处理：扣除对方搭力值并通知（真实环境由风控团队介入）
  addCredit(targetId, -20, '收到举报，等待核实');
  res.json(ok({ reported: true }));
});

// 兼容通用举报入口
export function reportRouter(Router) {
  const r = Router();
  r.post('/', requireAuth, (req, res) => {
    const { target_type, target_id, reason, detail } = req.body || {};
    if (!['user', 'post', 'comment', 'message'].includes(target_type)) {
      return res.status(400).json({ error: '举报对象不合法' });
    }
    db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, created_at) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, target_type, parseInt(target_id), String(reason || '其他').slice(0, 20), String(detail || '').slice(0, 500), now());
    res.json(ok({ reported: true }));
  });
  r.get('/mine', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM reports WHERE reporter_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
    res.json(ok(rows));
  });
  return r;
}
