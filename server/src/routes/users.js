import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, now } from '../db.js';
import { requireAuth, optionalAuth, ok, publicUser, notify, addCredit, anyBlocked, safeJSON } from '../util.js';
import { coverFields } from './posts.js'; // C9：他人主页"招募中"的局复用帖子封面兜底链

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
    else {
      // 自定义 filter 错误标记 400（S11）：否则落入全局 error handler 的 500 兜底
      const e = new Error('仅支持图片文件');
      e.status = 400;
      cb(e);
    }
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
  // C9（R3完整性）：TA 正在招募的局——个人页最核心的内容分发位，
  // 此前只有 recent_done，开放中的局不展示，从主页无法约 TA 现在的局
  pu.open_posts = db.prepare(`
    SELECT p.id, p.title, p.category, p.city, p.meet_time FROM posts p
    WHERE p.user_id = ? AND p.status = 'open' ORDER BY p.id DESC LIMIT 5
  `).all(u.id).map((p) => ({ ...p, ...coverFields(p) }));
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
  // 个性化推荐开关（算法推荐规定17条：提供关闭选项，立即生效）
  if (body.rec_off !== undefined) {
    const v = Number(body.rec_off);
    if (v !== 0 && v !== 1) return res.status(400).json({ error: 'rec_off 参数不合法（0 或 1）' });
    sets.push('rec_off = ?');
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

// ---------- 注销账号（PIPL 47条 + Apple 5.1.1(v)） ----------
// 需输入字符串 DELETE 二次确认；注销后：状态置 deleted、个人资料清空、
// 密码 hash 换为随机串（任何密码都无法登录）、手机号释放可复用；
// 历史搭局帖子保留（组局完整性），作者侧显示"已注销用户"。
usersRouter.post('/me/delete', requireAuth, (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== 'DELETE') {
    return res.status(400).json({ error: '请输入 DELETE 以确认注销' });
  }
  const randomHash = `deleted:${crypto.randomBytes(24).toString('hex')}`; // 非合法 bcrypt 哈希，原密码必失效
  db.prepare(`
    UPDATE users SET
      status = 'deleted', nickname = '已注销用户',
      bio = '', school = '', occupation = '', mbti = '', tags = '[]',
      avatar = NULL, phone = NULL, password_hash = ?
    WHERE id = ?
  `).run(randomHash, req.user.id);
  res.json(ok({ deleted: true }));
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

// ---------- 我的搭友列表（VD-03：搭后关系容器） ----------
// 返回对端 publicUser 摘要 + 搭过次数 times + 共同完成的局数 done_count
usersRouter.get('/me/partners', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, CASE WHEN p.user_a = ? THEN p.user_b ELSE p.user_a END partner_id
    FROM partners p WHERE p.user_a = ? OR p.user_b = ?
    ORDER BY p.times DESC, p.created_at DESC
  `).all(req.user.id, req.user.id, req.user.id);
  const doneCountStmt = db.prepare(`
    SELECT COUNT(*) c FROM posts p WHERE p.status = 'done' AND (
      (p.user_id = ? AND EXISTS (SELECT 1 FROM joins j WHERE j.post_id = p.id AND j.user_id = ? AND j.status = 'approved'))
      OR (p.user_id = ? AND EXISTS (SELECT 1 FROM joins j WHERE j.post_id = p.id AND j.user_id = ? AND j.status = 'approved'))
      OR (EXISTS (SELECT 1 FROM joins ja WHERE ja.post_id = p.id AND ja.user_id = ? AND ja.status = 'approved')
        AND EXISTS (SELECT 1 FROM joins jb WHERE jb.post_id = p.id AND jb.user_id = ? AND jb.status = 'approved'))
    )
  `);
  const list = [];
  for (const r of rows) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.partner_id);
    if (!u || u.status !== 'active') continue; // 已注销/封禁用户不展示
    const done_count = doneCountStmt.get(req.user.id, r.partner_id, r.partner_id, req.user.id, req.user.id, r.partner_id).c;
    list.push({ partner: publicUser(u), times: r.times, last_post_id: r.last_post_id, done_count });
  }
  res.json(ok({ list }));
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
  // S2 修复：同一 reporter 对同一 target 24h 内仅允许举报一次——
  // 此前可无限刷：单人即可把任意用户搭力值打到 0（每次 -20）并灌爆管理后台 moderation 队列。
  const dup = db.prepare(`
    SELECT 1 FROM reports
    WHERE reporter_id = ? AND target_type = 'user' AND target_id = ? AND created_at > ?
  `).get(req.user.id, targetId, now() - 24 * 3600_000);
  if (dup) return res.status(409).json({ error: '已举报，请等待处理' });
  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, created_at) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, 'user', targetId, reason, String(detail || '').slice(0, 500), now());
  // 演示环境自动处理（真实环境由风控团队介入）。扣分仅当该 target 今日首次被举报：
  // 多个举报者针对同一人只扣一次 20 分，举报不再等于"定向扣分武器"。
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const todayReports = db.prepare(`
    SELECT COUNT(*) c FROM reports
    WHERE target_type = 'user' AND target_id = ? AND created_at >= ?
  `).get(targetId, dayStart.getTime()).c;
  if (todayReports === 1) {
    addCredit(targetId, -20, '收到举报，等待核实');
  }
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
    // C7（R3完整性）：补充处理进度——resolved 时间与处理动作说明（未处理为 null），不再"已收到举报"后黑盒
    const ACTION_TEXT = { warn: '已警告对方', ban: '已封禁/下架', dismiss: '未发现违规，举报不实' };
    res.json(ok(rows.map((r) => ({
      ...r,
      resolved_at: r.resolved_at ?? null,
      action_text: r.status === 'resolved' && r.resolve_action
        ? (ACTION_TEXT[r.resolve_action] || '已处理')
        : null,
    }))));
  });
  return r;
}
