import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth, optionalAuth, ok, safeJSON, CATEGORIES, CATEGORY_MAP, FEE_MODES, GENDER_REQS, RATE_TAGS } from '../util.js';
import { myPostsRouter, postsRouter, coverFields } from './posts.js';
import { reportRouter } from './users.js';

export const miscRouter = Router();

// ---------- 元信息（分类目录等，前端启动加载一次） ----------
miscRouter.get('/meta', (_req, res) => {
  res.json(ok({
    categories: CATEGORIES,
    fee_modes: Object.entries(FEE_MODES).map(([k, v]) => ({ key: k, name: v })),
    gender_reqs: Object.entries(GENDER_REQS).map(([k, v]) => ({ key: k, name: v })),
    rate_tags: RATE_TAGS,
  }));
});

// ---------- 城市列表（从帖子聚合） ----------
miscRouter.get('/cities', (_req, res) => {
  const rows = db.prepare("SELECT city, COUNT(*) c FROM posts WHERE status IN ('open','full') GROUP BY city ORDER BY c DESC LIMIT 50").all();
  res.json(ok(rows));
});

// ---------- 通知 ----------
miscRouter.get('/notifications', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json(ok(rows.map((n) => ({ ...n, data: safeJSON(n.data, {}) }))));
});

miscRouter.post('/notifications/read', requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (Array.isArray(ids) && ids.length) {
    const stmt = db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?');
    for (const id of ids) stmt.run(req.user.id, parseInt(id));
  } else {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  }
  res.json(ok({ read: true }));
});

// ---------- 推荐搭子（基于标签/MBTI/城市/分类兴趣的简易协同推荐） ----------
miscRouter.get('/recommend', optionalAuth, (req, res) => {
  const me = req.user;
  const city = req.query.city || (me ? me.city : '');
  const rows = db.prepare(`
    SELECT p.* FROM posts p JOIN users u ON p.user_id = u.id
    WHERE p.status = 'open' AND u.status = 'active'
      AND (? IS NULL OR p.city = ?)
    ORDER BY (p.likes_count + p.comments_count * 2) DESC, p.id DESC LIMIT 20
  `).all(city || null, city || null);
  const viewer = me || null;
  const list = rows.map((p) => {
    const author = db.prepare('SELECT * FROM users WHERE id = ?').get(p.user_id);
    const liked = viewer ? !!db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(viewer.id, p.id) : false;
    return {
      id: p.id, title: p.title, category: p.category,
      category_name: CATEGORY_MAP[p.category]?.name, category_emoji: CATEGORY_MAP[p.category]?.emoji,
      city: p.city, meet_time: p.meet_time, status: p.status,
      author: { id: author.id, nickname: author.nickname, avatar: author.avatar, gender: author.gender, credit: author.credit },
      likes_count: p.likes_count, liked,
      images: safeJSON(p.images, []),
      ...coverFields(p),
      reason: `${CATEGORY_MAP[p.category]?.name || '搭子'} · ${p.city}`,
    };
  });
  res.json(ok({ list }));
});

// ---------- 相似搭子推荐（看我参加过的分类） ----------
miscRouter.get('/for-you', requireAuth, (req, res) => {
  const me = req.user;
  const myCats = db.prepare(`
    SELECT p.category, COUNT(*) c FROM posts p JOIN joins j ON j.post_id = p.id
    WHERE j.user_id = ? GROUP BY p.category ORDER BY c DESC LIMIT 3
  `).all(me.id).map((r) => r.category);
  const myTags = safeJSON(me.tags, []);
  if (!myCats.length) {
    myCats.push(...db.prepare('SELECT category FROM posts WHERE user_id = ? GROUP BY category LIMIT 3').all(me.id).map((r) => r.category));
  }
  let rows = [];
  if (myCats.length) {
    const ph = myCats.map(() => '?').join(',');
    rows = db.prepare(`
      SELECT p.*, COUNT(*) match_c FROM posts p
      WHERE p.status = 'open' AND p.user_id != ? AND p.category IN (${ph})
      ORDER BY match_c DESC, p.id DESC LIMIT 20
    `).all(me.id, ...myCats);
  }
  // 标签匹配加成
  const list = rows.map((p) => {
    const author = db.prepare('SELECT * FROM users WHERE id = ?').get(p.user_id);
    const authorTags = safeJSON(author.tags, []);
    const tagOverlap = myTags.filter((t) => authorTags.includes(t));
    return {
      id: p.id, title: p.title, category: p.category,
      category_name: CATEGORY_MAP[p.category]?.name, category_emoji: CATEGORY_MAP[p.category]?.emoji,
      city: p.city, meet_time: p.meet_time,
      images: safeJSON(p.images, []),
      ...coverFields(p),
      author: { id: author.id, nickname: author.nickname, avatar: author.avatar },
      tag_overlap: tagOverlap,
      reason: tagOverlap.length ? `你们都爱「${tagOverlap[0]}」` : `${CATEGORY_MAP[p.category]?.name} · 可能合拍`,
    };
  }).sort((a, b) => b.tag_overlap.length - a.tag_overlap.length);
  res.json(ok({ list, my_categories: myCats, my_tags: myTags }));
});

// 挂载子路由
miscRouter.use('/my/posts', myPostsRouter());
