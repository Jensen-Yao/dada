import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth, ok, filterContentStrict, notify, anyBlocked, safeJSON } from '../util.js';
// 循环依赖说明：index.js 导入本模块，本模块导入 index.js 的 notifyWS（函数声明具提升，
// 且仅在请求处理器内调用），ESM 活绑定下安全。
import { notifyWS } from '../index.js';

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

  // 私信门槛（H3 收紧）：必须存在 approved 的同局关系——
  // 组局者↔已通过成员，或同局两个已通过成员。
  // pending / 被拒 / 无任何关系的组合一律不放行，防止"申请任意一帖即可私信作者及全部申请者"的骚扰向量。
  const related = db.prepare(`
    SELECT 1 FROM posts ps
    WHERE (
      (ps.user_id = ?)
      OR EXISTS (SELECT 1 FROM joins j WHERE j.post_id = ps.id AND j.user_id = ? AND j.status = 'approved')
    )
    AND (
      (ps.user_id = ?)
      OR EXISTS (SELECT 1 FROM joins j2 WHERE j2.post_id = ps.id AND j2.user_id = ? AND j2.status = 'approved')
    )
    LIMIT 1
  `).get(req.user.id, req.user.id, target.id, target.id);
  if (!related) {
    return res.status(403).json({ error: '申请通过后才能私信' });
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
  const marked = db.prepare('UPDATE messages SET read_at = ? WHERE conv_id = ? AND sender_id != ? AND read_at IS NULL').run(now(), c.id, req.user.id);
  const otherId = c.user_a === req.user.id ? c.user_b : c.user_a;
  const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
  // VD-07 已读回执：本次拉取确实把对端消息置读时，经 WS 推 peer_read 给对端（FE 原地更新"送达→已读"）
  if (marked.changes > 0 && otherId !== req.user.id) notifyWS(otherId, 'peer_read', { conv_id: c.id });
  // VD-05/BE-6 破冰上下文：会话关联帖（分类/标题）+ 双方 tags，供 FE 话题卡
  let context = null;
  if (c.post_id) {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(c.post_id);
    if (post) {
      context = {
        post_category: post.category,
        post_title: post.title,
        my_tags: safeJSON(req.user.tags, []),
        other_tags: safeJSON(other ? other.tags : '[]', []),
      };
    }
  }
  res.json(ok({
    messages: rows.map((m) => ({ id: m.id, sender_id: m.sender_id, type: m.type, content: m.content, created_at: m.created_at, read_at: m.read_at })),
    other: other ? { id: other.id, nickname: other.nickname, avatar: other.avatar, gender: other.gender } : null,
    context,
  }));
});

// WebSocket 使用的核心发送逻辑（含敏感词与首条消息安全提示）
export function handleChatMessage(fromUser, convId, rawContent) {
  // 账号状态复查（S3/A7）：user 对象在 WS auth 时快照，此后注销/封禁不会刷新——
  // 残留"活幽灵"连接可继续发消息。每条 chat 帧前点查一次 users.status（与 HTTP 侧 getAuthUser 对齐）。
  const me = db.prepare('SELECT id, status FROM users WHERE id = ?').get(fromUser.id);
  if (!me || me.status !== 'active') return { error: '账号状态异常' };
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!c) return { error: '会话不存在' };
  if (c.user_a !== fromUser.id && c.user_b !== fromUser.id) return { error: '无权在该会话发送消息' };
  const otherId = c.user_a === fromUser.id ? c.user_b : c.user_a;
  if (anyBlocked(fromUser.id, otherId)) return { error: '无法发送消息（存在拉黑关系）' };
  const content = String(rawContent || '').trim();
  if (!content) return { error: '消息不能为空' };
  if (content.length > 2000) return { error: '消息太长' };
  // G-聊天升级（R4灰产 G1-d/G3）：打码照发只遮"触发词"不遮"payload"（abc2026/123456 完好存活），
  // 改为两级策略——
  //   硬词（导流/违法/资金类：加微信/vx/转账/裸聊…）→ 直接【拒收】，不入库不投递
  //     （index.js WS 收到 result.error 会回 chat_error 帧，现有错误路径复用）；
  //   软词（涉黄暗语/收费话术等灰产信号）→ 维持打码放行。
  // 匹配走归一化管道：零宽字符/全半角/空格分隔符变体（"加·V"、"威 信"）同样命中。
  const f = filterContentStrict(content);
  if (f.hardHits.length) {
    return { error: '消息包含违规内容，已被拦截' };
  }
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
      .run(convId, fromUser.id, 'safety', '安全提示：请勿脱离平台交易或转账，谨防诈骗。首次见面建议选择人多的公共场所。', t);
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
