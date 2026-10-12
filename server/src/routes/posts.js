import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, now } from '../db.js';
import { getOrCreateConv } from './chat.js';
import {
  requireAuth, optionalAuth, ok, publicUser, safeJSON,
  CATEGORY_MAP, FEE_MODES, RATE_TAGS, filterContent, notify, addCredit,
  CREDIT_MIN_POST, anyBlocked, warnUser,
} from '../util.js';

export const postsRouter = Router();

// ---------- 封面/比例字段（BE-02/03 + PC-03 三级兜底，确定性规则，禁随机/时间） ----------
// aspect：按帖子 id 确定性分档（同帖永远同档）
// cover 兜底链：images[0]（用户配图/seed 真图）、分类实拍照 /img/photos/{category}-{id%N+1}.jpg、旧 SVG（终兜底，C5）
export const ASPECTS = ['3:4', '1:1', '4:3'];
// 每分类实拍照片数（与 docs/product-spec.md §F.1 清单一致，新增照片时同步此表）
export const PHOTO_N = { food: 3, sports: 3, study: 2, travel: 3, live: 3, game: 3, movie: 2,
                         photo: 2, pet: 3, coffee: 3, shopping: 2, boardgame: 3, commute: 3, other: 2 };
export function coverFields(p) {
  const images = safeJSON(p.images, []);
  const n = PHOTO_N[p.category] || 0;
  const photo = n ? `/img/photos/${p.category}-${(p.id % n) + 1}.jpg` : null;
  return {
    cover: images[0] || photo || `/img/covers/${p.category}${p.id % 2 ? '-2' : ''}.svg`,
    aspect: ASPECTS[p.id % 3],
  };
}

// ---------- 搭局配图上传 ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname) || '.jpg'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持图片文件'));
  },
});

postsRouter.post('/:id/images', requireAuth, imageUpload.array('images', 3), (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  if (p.user_id !== req.user.id) return res.status(403).json({ error: '只能给自己的搭局传图' });
  if (!req.files?.length) return res.status(400).json({ error: '请选择图片' });
  const current = safeJSON(p.images, []);
  const added = req.files.map((f) => `/uploads/${f.filename}`);
  const merged = [...current, ...added].slice(0, 6);
  db.prepare('UPDATE posts SET images = ? WHERE id = ?').run(JSON.stringify(merged), p.id);
  res.json(ok({ images: merged }));
});

function postView(p, viewer) {
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(p.user_id);
  const liked = viewer ? !!db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(viewer.id, p.id) : false;
  const myJoin = viewer ? db.prepare('SELECT status FROM joins WHERE post_id = ? AND user_id = ?').get(p.id, viewer.id) : null;
  const approved = db.prepare("SELECT COUNT(*) c FROM joins WHERE post_id = ? AND status = 'approved'").get(p.id).c;
  return {
    id: p.id,
    author: publicUser(author),
    category: p.category,
    category_name: CATEGORY_MAP[p.category]?.name || p.category,
    category_icon: CATEGORY_MAP[p.category]?.icon,
    title: p.title,
    content: p.content,
    city: p.city,
    location_name: p.location_name,
    meet_time: p.meet_time,
    need_count: p.need_count,
    fee_mode: p.fee_mode,
    fee_mode_name: FEE_MODES[p.fee_mode],
    gender_req: p.gender_req,
    gender_req_name: { any: '不限', female: '仅限女生', male: '仅限男生' }[p.gender_req],
    requirements: p.requirements,
    images: safeJSON(p.images, []),
    ...coverFields(p),
    status: p.status,
    approved_count: approved,
    likes_count: p.likes_count,
    comments_count: p.comments_count,
    views_count: p.views_count,
    created_at: p.created_at,
    liked,
    my_join: myJoin ? myJoin.status : null,
    is_author: viewer ? viewer.id === p.user_id : false,
  };
}

// ---------- 广场列表（游客可看） ----------
postsRouter.get('/', optionalAuth, (req, res) => {
  const q = req.query || {};
  const p = Math.max(1, parseInt(q.page) || 1);
  const s = Math.min(50, Math.max(1, parseInt(q.size) || 20));
  const off = (p - 1) * s;
  const where = ["p.status IN ('open','full')"];
  const vals = [];
  if (q.city) { where.push('p.city = ?'); vals.push(q.city); }
  if (q.category && CATEGORY_MAP[q.category]) { where.push('p.category = ?'); vals.push(q.category); }
  if (q.keyword) {
    where.push('(p.title LIKE ? OR p.content LIKE ?)');
    vals.push(`%${q.keyword}%`, `%${q.keyword}%`);
  }
  if (q.gender_req && ['any', 'female', 'male'].includes(q.gender_req)) { where.push('p.gender_req = ?'); vals.push(q.gender_req); }
  const order = q.sort === 'hot' ? '(p.likes_count + p.comments_count * 2 + p.views_count / 50) DESC, p.id DESC' : 'p.id DESC';
  const rows = db.prepare(`
    SELECT p.* FROM posts p WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?
  `).all(...vals, s, off);
  const total = db.prepare(`SELECT COUNT(*) c FROM posts p WHERE ${where.join(' AND ')}`).get(...vals).c;
  res.json(ok({ list: rows.map((r) => postView(r, req.user)), total, page: p, size: s }));
});

// ---------- 发布搭局 ----------
postsRouter.post('/', requireAuth, (req, res) => {
  const u = req.user;
  if (u.credit < CREDIT_MIN_POST) {
    return res.status(403).json({ error: `搭力值不足（当前 ${u.credit}，发布搭局需 ≥${CREDIT_MIN_POST}），请先通过认证或完成搭局积累搭力值` });
  }
  const { category, title, content, city, location_name, meet_time, need_count, fee_mode, gender_req, requirements } = req.body || {};
  if (!CATEGORY_MAP[category]) return res.status(400).json({ error: '请选择搭子类型' });
  const t = String(title || '').trim();
  if (!t || t.length > 40) return res.status(400).json({ error: '标题需为 1-40 字' });
  const c = String(content || '').trim();
  if (c.length > 1000) return res.status(400).json({ error: '内容太长（最多 1000 字）' });
  const cityS = String(city || '').trim();
  if (!cityS) return res.status(400).json({ error: '请填写城市' });

  const fTitle = filterContent(t);
  const fContent = filterContent(c);
  const fReq = filterContent(String(requirements || ''));
  if (fTitle.hits.length || fContent.hits.length || fReq.hits.length) {
    return res.status(400).json({ error: '内容包含违规信息（导流/欺诈/违规词汇），请修改后发布。如需联系请使用站内聊天。' });
  }

  const nc = Math.min(20, Math.max(1, parseInt(need_count) || 1));
  const fm = ['free', 'aa', 'treat'].includes(fee_mode) ? fee_mode : 'aa';
  if (!['any', 'female', 'male'].includes(gender_req || 'any')) return res.status(400).json({ error: '性别要求不合法' });

  const info = db.prepare(`
    INSERT INTO posts (user_id, category, title, content, city, location_name, meet_time, need_count, fee_mode, gender_req, requirements, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?)
  `).run(u.id, category, fTitle.cleaned, fContent.cleaned, cityS,
    String(location_name || '').slice(0, 50), String(meet_time || '').slice(0, 30), nc, fm, gender_req || 'any', fReq.cleaned, now());
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now(), u.id);
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  res.json(ok(postView(p, u)));
});

// ---------- 帖子详情 ----------
postsRouter.get('/:id', optionalAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  db.prepare('UPDATE posts SET views_count = views_count + 1 WHERE id = ?').run(p.id);
  res.json(ok(postView(p, req.user)));
});

// ---------- 编辑 / 关闭 ----------
postsRouter.put('/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  if (p.user_id !== req.user.id) return res.status(403).json({ error: '只能编辑自己发布的搭局' });
  const body = req.body || {};
  const fields = ['title', 'content', 'location_name', 'meet_time', 'requirements'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (body[f] === undefined) continue;
    const filtered = filterContent(String(body[f] || ''));
    if (filtered.hits.length) return res.status(400).json({ error: '内容包含违规信息，请修改' });
    sets.push(`${f} = ?`);
    vals.push(filtered.cleaned.slice(0, f === 'title' ? 40 : 1000));
  }
  if (body.need_count !== undefined) {
    const nc = Math.min(20, Math.max(1, parseInt(body.need_count) || 1));
    const approved = db.prepare("SELECT COUNT(*) c FROM joins WHERE post_id = ? AND status = 'approved'").get(p.id).c;
    if (nc < approved) return res.status(400).json({ error: `已有 ${approved} 人通过，人数上限不能低于该数` });
    sets.push('need_count = ?'); vals.push(nc);
  }
  if (body.status !== undefined) {
    if (!['open', 'closed', 'done'].includes(body.status)) return res.status(400).json({ error: '状态不合法' });
    sets.push('status = ?'); vals.push(body.status);
    if (body.status === 'done') completePost(p);
  }
  if (sets.length) {
    vals.push(p.id);
    db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  res.json(ok(postView(db.prepare('SELECT * FROM posts WHERE id = ?').get(p.id), req.user)));
});

// ---------- 点赞 / 取消点赞 ----------
postsRouter.post('/:id/like', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  const exist = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(req.user.id, p.id);
  if (exist) {
    db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, p.id);
    db.prepare('UPDATE posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').run(p.id);
    return res.json(ok({ liked: false }));
  }
  db.prepare('INSERT INTO likes (user_id, post_id, created_at) VALUES (?,?,?)').run(req.user.id, p.id, now());
  db.prepare('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?').run(p.id);
  if (p.user_id !== req.user.id) notify(p.user_id, 'like', '收到新点赞', `${req.user.nickname} 赞了你的搭局「${p.title}」`, { post_id: p.id });
  res.json(ok({ liked: true }));
});

// ---------- 评论 ----------
postsRouter.get('/:id/comments', optionalAuth, (req, res) => {
  const pid = parseInt(req.params.id);
  const rows = db.prepare(`
    SELECT cm.*, u.nickname, u.avatar, u.gender FROM comments cm JOIN users u ON cm.user_id = u.id
    WHERE cm.post_id = ? ORDER BY cm.id ASC LIMIT 200
  `).all(pid);
  res.json(ok(rows.map((r) => ({
    id: r.id, content: r.content, created_at: r.created_at,
    user: { id: r.user_id, nickname: r.nickname, avatar: r.avatar, gender: r.gender },
  }))));
});

postsRouter.post('/:id/comments', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  const f = filterContent(String((req.body || {}).content || '').trim());
  if (!f.cleaned) return res.status(400).json({ error: '评论不能为空' });
  if (f.hits.length) return res.status(400).json({ error: '评论包含违规信息，请修改' });
  if (f.cleaned.length > 300) return res.status(400).json({ error: '评论最多 300 字' });
  db.prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?,?,?,?)').run(p.id, req.user.id, f.cleaned, now());
  db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(p.id);
  if (p.user_id !== req.user.id) notify(p.user_id, 'comment', '收到新评论', `${req.user.nickname} 评论了你的搭局「${p.title}」：${f.cleaned.slice(0, 50)}`, { post_id: p.id });
  res.json(ok({ commented: true }));
});

// ---------- 申请加入搭局 ----------
postsRouter.post('/:id/join', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  if (p.status !== 'open') return res.status(400).json({ error: '该搭局已停止招募' });
  if (p.user_id === req.user.id) return res.status(400).json({ error: '不能加入自己发布的搭局' });
  const exist = db.prepare('SELECT * FROM joins WHERE post_id = ? AND user_id = ?').get(p.id, req.user.id);
  if (exist && exist.status !== 'rejected') return res.status(400).json({ error: '已申请过该搭局' });
  // 性别限制
  if (p.gender_req !== 'any' && req.user.gender !== p.gender_req) {
    return res.status(403).json({ error: p.gender_req === 'female' ? '该搭局仅限女生参加' : '该搭局仅限男生参加' });
  }
  const f = filterContent(String((req.body || {}).message || '').slice(0, 200));
  if (f.hits.length) return res.status(400).json({ error: '申请留言包含违规信息' });
  const t = now();
  if (exist) {
    db.prepare("UPDATE joins SET message = ?, status = 'pending', updated_at = ? WHERE id = ?").run(f.cleaned, t, exist.id);
  } else {
    db.prepare('INSERT INTO joins (post_id, user_id, message, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(p.id, req.user.id, f.cleaned, 'pending', t, t);
  }
  notify(p.user_id, 'join_request', '收到入搭申请', `${req.user.nickname} 申请加入「${p.title}」`, { post_id: p.id, join_user_id: req.user.id });
  res.json(ok({ joined: true, status: 'pending' }));
});

// ---------- 组局者：查看申请人 ----------
postsRouter.get('/:id/joins', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  if (p.user_id !== req.user.id) return res.status(403).json({ error: '只有组局者可以查看申请列表' });
  const rows = db.prepare(`
    SELECT j.*, u.nickname, u.avatar, u.gender, u.birth_year, u.city, u.mbti, u.credit, u.verify_student, u.verify_real, u.tags
    FROM joins j JOIN users u ON j.user_id = u.id WHERE j.post_id = ? ORDER BY j.id ASC
  `).all(p.id);
  res.json(ok(rows.map((r) => ({
    id: r.id, message: r.message, status: r.status, created_at: r.created_at,
    user: {
      id: r.user_id, nickname: r.nickname, avatar: r.avatar, gender: r.gender,
      age: r.birth_year ? new Date().getFullYear() - r.birth_year : null,
      city: r.city, mbti: r.mbti, credit: r.credit,
      verify_student: !!r.verify_student, verify_real: !!r.verify_real, tags: safeJSON(r.tags, []),
    },
  }))));
});

// ---------- 组局者：通过 / 拒绝 ----------
postsRouter.post('/:id/joins/:joinId/approve', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  const j = db.prepare('SELECT * FROM joins WHERE id = ? AND post_id = ?').get(parseInt(req.params.joinId), parseInt(req.params.id));
  if (!p || !j) return res.status(404).json({ error: '申请不存在' });
  if (p.user_id !== req.user.id) return res.status(403).json({ error: '只有组局者可以操作' });
  if (j.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });
  const approve = !!((req.body || {}).approve);
  const approved = db.prepare("SELECT COUNT(*) c FROM joins WHERE post_id = ? AND status = 'approved'").get(p.id).c;
  if (approve && approved >= p.need_count) return res.status(400).json({ error: '人数已满' });
  db.prepare("UPDATE joins SET status = ?, updated_at = ? WHERE id = ?").run(approve ? 'approved' : 'rejected', now(), j.id);
  if (approve) {
    // 通过即建立站内会话，保证"去聊天"有入口
    getOrCreateConv(p.user_id, j.user_id, p.id);
    notify(j.user_id, 'join_result', '申请已通过', `你已加入「${p.title}」，快去和组局者聊聊吧`, { post_id: p.id });
    if (approved + 1 >= p.need_count) db.prepare("UPDATE posts SET status = 'full' WHERE id = ?").run(p.id);
  } else {
    notify(j.user_id, 'join_result', '申请未通过', `「${p.title}」的组局者未通过你的申请，别灰心，广场上还有更多搭局`, { post_id: p.id });
  }
  res.json(ok({ approved }));
});

// ---------- 搭后互评（组局者与成员互评） ----------
postsRouter.post('/:id/rate', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  const { ratee_id, stars, tags, comment } = req.body || {};
  const ratee = db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(ratee_id));
  if (!ratee) return res.status(400).json({ error: '被评价用户不存在' });
  if (ratee.id === req.user.id) return res.status(400).json({ error: '不能评价自己' });
  const st = parseInt(stars);
  if (!(st >= 1 && st <= 5)) return res.status(400).json({ error: '评分需为 1-5 星' });
  if (p.status !== 'done') return res.status(400).json({ error: '搭局需先标记为「已完成」才能互评' });

  // 校验双方确实同局：组局者 或 被通过的成员
  const isAuthor = p.user_id === req.user.id;
  const isMember = !!db.prepare("SELECT 1 FROM joins WHERE post_id = ? AND user_id = ? AND status = 'approved'").get(p.id, req.user.id);
  const rateeIsAuthor = p.user_id === ratee.id;
  const rateeIsMember = !!db.prepare("SELECT 1 FROM joins WHERE post_id = ? AND user_id = ? AND status = 'approved'").get(p.id, ratee.id);
  if (!((isAuthor && rateeIsMember) || (isMember && rateeIsAuthor) || (isMember && rateeIsMember))) {
    return res.status(403).json({ error: '只能评价一起参加过该搭局的人' });
  }
  if (db.prepare('SELECT 1 FROM ratings WHERE post_id = ? AND rater_id = ? AND ratee_id = ?').get(p.id, req.user.id, ratee.id)) {
    return res.status(400).json({ error: '已经评价过对方了' });
  }
  const validTags = Array.isArray(tags) ? tags.filter((t) => RATE_TAGS.includes(t)).slice(0, 6) : [];
  const f = filterContent(String(comment || '').slice(0, 200));
  if (f.hits.length) return res.status(400).json({ error: '评价包含违规信息' });
  db.prepare('INSERT INTO ratings (post_id, rater_id, ratee_id, stars, tags, comment, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(p.id, req.user.id, ratee.id, st, JSON.stringify(validTags), f.cleaned, now());
  // 评价影响搭力值：好评加分，差评扣分
  const delta = st >= 4 ? 10 : st <= 2 ? -15 : 0;
  if (delta !== 0) addCredit(ratee.id, delta, `「${p.title}」搭后互评`);
  notify(ratee.id, 'rating', '收到搭后评价', `${req.user.nickname} 给你 ${st} 星评价`, { post_id: p.id, stars: st });
  res.json(ok({ rated: true }));
});

// 搭局完成时给参与者加分
function completePost(p) {
  addCredit(p.user_id, 20, `「${p.title}」搭局完成`);
  const members = db.prepare("SELECT user_id FROM joins WHERE post_id = ? AND status = 'approved'").all(p.id);
  for (const m of members) {
    addCredit(m.user_id, 20, `「${p.title}」搭局完成`);
    notify(m.user_id, 'post_done', '搭局已完成', `「${p.title}」已标记完成，别忘了给搭子们留下评价哦`, { post_id: p.id });
  }
}

// ---------- 我的搭局（发布/参加） ----------
export function myPostsRouter() {
  const r = Router();
  r.get('/published', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM posts WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
    res.json(ok(rows.map((p) => postView(p, req.user))));
  });
  r.get('/joined', requireAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT p.*, j.status join_status FROM posts p JOIN joins j ON j.post_id = p.id
      WHERE j.user_id = ? ORDER BY j.id DESC LIMIT 100
    `).all(req.user.id);
    res.json(ok(rows.map((p) => ({ ...postView(p, req.user), my_join: p.join_status }))));
  });
  return r;
}
