import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth, ok, warnUser, notify, addCredit } from '../util.js';

export const adminRouter = Router();

function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: '需要管理员权限' });
  next();
}
adminRouter.use(requireAuth, requireAdmin);

// ---------- 数据看板 ----------
adminRouter.get('/stats', (_req, res) => {
  const t = now();
  const day = 86400000;
  const stat = (sql, ...vals) => db.prepare(sql).get(...vals).c;
  res.json(ok({
    users: stat('SELECT COUNT(*) c FROM users'),
    active_users: stat('SELECT COUNT(*) c FROM users WHERE last_active_at > ?', t - 7 * day),
    banned_users: stat("SELECT COUNT(*) c FROM users WHERE status = 'banned'"),
    posts: stat('SELECT COUNT(*) c FROM posts'),
    open_posts: stat("SELECT COUNT(*) c FROM posts WHERE status = 'open'"),
    done_posts: stat("SELECT COUNT(*) c FROM posts WHERE status = 'done'"),
    joins: stat("SELECT COUNT(*) c FROM joins WHERE status = 'approved'"),
    messages: stat('SELECT COUNT(*) c FROM messages'),
    pending_reports: stat("SELECT COUNT(*) c FROM reports WHERE status = 'pending'"),
    new_users_7d: stat('SELECT COUNT(*) c FROM users WHERE created_at > ?', t - 7 * day),
  }));
});

// ---------- 成搭漏斗看板（VD-01：六级成搭漏斗 + 日活近似） ----------
// funnel 固定顺序：register → post_view → publish → join → approve → done → rate
// daily_active：日活跃近似 = events 按 user 去重 / 日（UTC 日界）
adminRouter.get('/funnel', (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
  const since = now() - days * 86400000;
  const FUNNEL_TYPES = ['register', 'post_view', 'publish', 'join', 'approve', 'done', 'rate'];
  const rows = db.prepare('SELECT type, COUNT(*) c FROM events WHERE created_at >= ? GROUP BY type').all(since);
  const byType = Object.fromEntries(rows.map((r) => [r.type, r.c]));
  const funnel = FUNNEL_TYPES.map((type) => ({ type, count: byType[type] || 0 }));
  // 日活近似：按日（UTC）对 events.user_id 去重计数
  const evRows = db.prepare('SELECT user_id, created_at FROM events WHERE created_at >= ? AND user_id IS NOT NULL').all(since);
  const byDay = new Map();
  for (const r of evRows) {
    const day = new Date(r.created_at).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day).add(r.user_id);
  }
  const daily_active = [...byDay.entries()]
    .map(([date, users]) => ({ date, count: users.size }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json(ok({ days, funnel, daily_active }));
});

// ---------- 举报队列 ----------
adminRouter.get('/reports', (req, res) => {
  const status = ['pending', 'resolved'].includes(req.query.status) ? req.query.status : 'pending';
  const rows = db.prepare(`
    SELECT r.*, ru.nickname reporter_nickname FROM reports r JOIN users ru ON r.reporter_id = ru.id
    WHERE r.status = ? ORDER BY r.id DESC LIMIT 200
  `).all(status);
  // 补充举报目标摘要
  const list = rows.map((r) => {
    let target_summary = '';
    try {
      if (r.target_type === 'user') {
        const u = db.prepare('SELECT nickname, status FROM users WHERE id = ?').get(r.target_id);
        target_summary = u ? `${u.nickname}（${u.status === 'banned' ? '已封禁' : '正常'}）` : '已删除';
      } else if (r.target_type === 'post') {
        const p = db.prepare('SELECT title FROM posts WHERE id = ?').get(r.target_id);
        target_summary = p ? p.title : '已删除';
      } else if (r.target_type === 'message') {
        const m = db.prepare('SELECT content FROM messages WHERE id = ?').get(r.target_id);
        target_summary = m ? m.content.slice(0, 40) : '已删除';
      } else if (r.target_type === 'comment') {
        const c = db.prepare('SELECT content FROM comments WHERE id = ?').get(r.target_id);
        target_summary = c ? c.content.slice(0, 40) : '已删除';
      }
    } catch { /* ignore */ }
    return { ...r, target_summary };
  });
  res.json(ok(list));
});

// ---------- 处理举报（警告/封禁/驳回） ----------
adminRouter.post('/reports/:id/resolve', (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(parseInt(req.params.id));
  if (!r) return res.status(404).json({ error: '举报不存在' });
  if (r.status === 'resolved') return res.status(400).json({ error: '该举报已处理' });
  const { action } = req.body || {}; // warn | ban | dismiss
  if (!['warn', 'ban', 'dismiss'].includes(action)) return res.status(400).json({ error: '处理动作不合法' });

  if (action === 'warn' && r.target_type === 'user') {
    warnUser(r.target_id, `被举报「${r.reason}」核实成立`);
  } else if (action === 'ban') {
    if (r.target_type === 'user') {
      db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(r.target_id);
      notify(r.target_id, 'warning', '账号已被封禁', '因违反社区公约，账号已被封禁。');
    } else if (r.target_type === 'post') {
      db.prepare("UPDATE posts SET status = 'closed' WHERE id = ?").run(r.target_id);
      const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(r.target_id);
      if (p) warnUser(p.user_id, '发布的搭局违规被下架');
    } else if (r.target_type === 'comment') {
      db.prepare('DELETE FROM comments WHERE id = ?').run(r.target_id);
    } else if (r.target_type === 'message') {
      db.prepare("UPDATE messages SET content = '[该消息因违规已被撤回]' WHERE id = ?").run(r.target_id);
    }
  } else if (action === 'dismiss' && r.target_type === 'user') {
    // L3（R3法务）：举报不实驳回 → 返还此前"收到举报，等待核实"扣除的 20 搭力值。
    // 此前驳回后 -20 永久沉淀，用户协议"经核实举报不实的返还"是系统里不存在的动作。
    addCredit(r.target_id, 20, '举报不实，返还搭力值');
  }
  // C7（R3完整性）：留痕处理时间与动作，供举报人 /api/reports/mine 查询进度
  db.prepare("UPDATE reports SET status = 'resolved', resolved_at = ?, resolve_action = ? WHERE id = ?")
    .run(now(), action, r.id);
  notify(r.reporter_id, 'report_result', '举报已处理', `你举报的「${r.reason}」已被处理（${{ warn: '已警告对方', ban: '已封禁/下架', dismiss: '未发现违规' }[action]}）`, {});
  res.json(ok({ resolved: true, action }));
});

// ---------- 用户管理 ----------
adminRouter.get('/users', (req, res) => {
  const q = `%${String(req.query.keyword || '').trim()}%`;
  const rows = db.prepare(`
    SELECT id, username, nickname, gender, city, credit, warnings, status, is_admin, verify_student, verify_real, created_at
    FROM users WHERE nickname LIKE ? OR username LIKE ? ORDER BY id DESC LIMIT 100
  `).all(q, q);
  res.json(ok(rows));
});

adminRouter.post('/users/:id/ban', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(req.params.id));
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.is_admin) return res.status(400).json({ error: '不能封禁管理员' });
  db.prepare("UPDATE users SET status = ? WHERE id = ?").run(u.status === 'banned' ? 'active' : 'banned', u.id);
  res.json(ok({ banned: u.status !== 'banned' }));
});
