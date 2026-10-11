import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth, ok, filterContent, notify, anyBlocked } from '../util.js';

export const chatRouter = Router();

// 规范会话双方排序，保证唯一
function convKey(a, b) {
  return a < b ? [a, b] : [b, a];
}

export function getOrCreateConv(aId, bId, postId = null) {
  const [ua, ub] = convKey(aId, bId);
  const exist = db.prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(ua, ub);
  if (exist) return exist;
  const t = now();
  const info = db.prepare('INSERT INTO conversations (post_id, user_a, user_b, last_msg_at, created_at) VALUES (?,?,?,?,?)')
    .run(postId, ua, ub, t, t);
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
}

function convView(c, meId) {
  const otherId = c.user_a === meId ? c.user_b : c.user_a;
  const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
  const last = db.prepare('SELECT * FROM messages WHERE conv_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
  const unread = db.prepare('SELECT COUNT(*) c FROM messages WHERE conv_id = ? AND sender_id != ? AND read_at IS NULL').get(c.id, meId).c;
  return {
    id: c.id,
    other: other ? { id: other.id, nickname: other.nickname, avatar: other.avatar, gender: other.gender, verify_real: !!other.verify_real, verify_student: !!other.verify_student } : null,
    post_id: c.post_id,
    last_message: last ? { type: last.type, content: last.content, created_at: last.created_at } : null,
    unread,
    last_msg_at: c.last_msg_at,
  };
}

// 会话列表
chatRouter.get('/convs', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM conversations WHERE user_a = ? OR user_b = ? ORDER BY last_msg_at DESC LIMIT 100').all(req.user.id, req.user.id);
  res.json(ok(rows.map((c) => convView(c, req.user.id))));
});

// 开启/获取与某人的会话（通过入搭后自动建立；游客/未互动不可直接私信）
chatRouter.post('/conv', requireAuth, (req, res) => {
  const { user_id, post_id } = req.body || {};
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(user_id));
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.id === req.user.id) return res.status(400).json({ error: '不能和自己聊天' });
  if (anyBlocked(req.user.id, target.id)) return res.status(403).json({ error: '无法建立会话（存在拉黑关系）' });

  // 私信门槛：双方需在同一场搭局中（组局者-成员 或 成员-成员）
  const related = db.prepare(`
    SELECT 1 FROM joins j1 JOIN joins j2 ON j1.post_id = j2.post_id
    WHERE j1.user_id = ? AND j2.user_id = ?
      AND ((j1.status = 'approved') OR (j2.status = 'approved') OR j1.status = 'pending' OR j2.status = 'pending')
    LIMIT 1
  `).get(req.user.id, target.id);
  const isPostAuthor = post_id && db.prepare('SELECT 1 FROM posts WHERE id = ? AND user_id = ?').get(parseInt(post_id), target.id);
  const iAmPostAuthor = post_id && db.prepare('SELECT 1 FROM posts WHERE id = ? AND user_id = ?').get(parseInt(post_id), req.user.id);
  if (!related && !isPostAuthor && !iAmPostAuthor) {
    return res.status(403).json({ error: '需先申请或参与对方的搭局后才能私信，防止骚扰' });
  }
  const conv = getOrCreateConv(req.user.id, target.id, post_id || null);
  res.json(ok(convView(conv, req.user.id)));
});

// 消息历史
chatRouter.get('/conv/:id/messages', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(parseInt(req.params.id));
  if (!c) return res.status(404).json({ error: '会话不存在' });
  if (c.user_a !== req.user.id && c.user_b !== req.user.id) return res.status(403).json({ error: '无权访问该会话' });
  const rows = db.prepare('SELECT * FROM messages WHERE conv_id = ? ORDER BY id ASC LIMIT 500').all(c.id);
  // 标记已读
  db.prepare('UPDATE messages SET read_at = ? WHERE conv_id = ? AND sender_id != ? AND read_at IS NULL').run(now(), c.id, req.user.id);
  const otherId = c.user_a === req.user.id ? c.user_b : c.user_a;
  const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
  res.json(ok({
    messages: rows.map((m) => ({ id: m.id, sender_id: m.sender_id, type: m.type, content: m.content, created_at: m.created_at })),
    other: other ? { id: other.id, nickname: other.nickname, avatar: other.avatar, gender: other.gender } : null,
  }));
});

// WebSocket 使用的核心发送逻辑（含敏感词与首条消息安全提示）
export function handleChatMessage(fromUser, convId, rawContent) {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!c) return { error: '会话不存在' };
  if (c.user_a !== fromUser.id && c.user_b !== fromUser.id) return { error: '无权在该会话发送消息' };
  const otherId = c.user_a === fromUser.id ? c.user_b : c.user_a;
  if (anyBlocked(fromUser.id, otherId)) return { error: '无法发送消息（存在拉黑关系）' };
  const content = String(rawContent || '').trim();
  if (!content) return { error: '消息不能为空' };
  if (content.length > 2000) return { error: '消息太长' };
  const f = filterContent(content);
  const msgContent = f.cleaned;

  const t = now();
  const count = db.prepare('SELECT COUNT(*) c FROM messages WHERE conv_id = ? AND sender_id = ?').get(convId, fromUser.id).c;
  const info = db.prepare('INSERT INTO messages (conv_id, sender_id, type, content, created_at) VALUES (?,?,?,?,?)')
    .run(convId, fromUser.id, 'text', msgContent, t);
  db.prepare('UPDATE conversations SET last_msg_at = ? WHERE id = ?').run(t, convId);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);

  // 首条消息后插入安全提醒
  if (count === 0) {
    db.prepare('INSERT INTO messages (conv_id, sender_id, type, content, created_at) VALUES (?,?,?,?,?)')
      .run(convId, fromUser.id, 'safety', '⚠️ 安全提示：请勿脱离平台交易或转账，谨防诈骗。首次见面建议选择人多的公共场所。', t);
  }
  return { message: msg, blocked_words: f.hits };
}

// 会话内举报消息
chatRouter.post('/message/:id/report', requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(parseInt(req.params.id));
  if (!m) return res.status(404).json({ error: '消息不存在' });
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(m.conv_id);
  if (c.user_a !== req.user.id && c.user_b !== req.user.id) return res.status(403).json({ error: '无权举报该消息' });
  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, created_at) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, 'message', m.id, String((req.body || {}).reason || '骚扰').slice(0, 20), String((req.body || {}).detail || m.content).slice(0, 500), now());
  res.json(ok({ reported: true }));
});
