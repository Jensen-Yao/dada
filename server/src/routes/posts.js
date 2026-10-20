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
  CREDIT_MIN_POST, anyBlocked, warnUser, trackEvent, getOrCreatePartner,
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
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname) || '.jpg'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
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
  // 拉黑关系字段（R1延期项）：登录视角标记"我是否拉黑了帖主"，游客恒 false
  // feed 已在登录视角过滤被拉黑帖，此字段主要用于详情页直链访问与"已拉黑"标识口径
  const blockedByMe = viewer
    ? !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(viewer.id, p.user_id)
    : false;
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
    // TS-1①（R5时间语义）结构化时间透传：meet_at=epoch ms UTC（可空）、meet_repeat=周期局标记。
    // 前端有 meet_at 时格式化为本地墙钟，无则回退 meet_time 原文——老帖零影响
    meet_at: p.meet_at ?? null,
    meet_repeat: p.meet_repeat ?? null,
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
    blocked_by_me: blockedByMe,
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
  // 拉黑落地（H2）：登录视角过滤"我拉黑的 / 拉黑我的"用户发的帖，游客不过滤
  if (req.user) {
    where.push('p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)');
    vals.push(req.user.id, req.user.id);
  }
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
  // 分页元信息（前端触底加载）：offset + 本页条数 < total 即还有下一页
  res.json(ok({ list: rows.map((r) => postView(r, req.user)), total, page: p, size: s, has_more: off + rows.length < total }));
});

// ---------- meet_at 结构化校验（TS-1②，R5时间语义） ----------
// meet_at：epoch ms UTC；可空；提供时必须为数字且在 now+5min ~ now+365d 之间。
// 周期局（repeat='weekly'|'daily'）豁免"未来"校验——长期帖的锚点时间可以是过去（如"每周六 07:00"）。
const MEET_REPEATS = ['weekly', 'daily'];
const MEET_MIN_LEAD_MS = 5 * 60_000;        // 最早可约：5 分钟后
const MEET_MAX_LEAD_MS = 365 * 86400000;    // 最远可约：一年内
const MEET_ERR = '开始时间需在5分钟到一年之内';

// 解析请求体里的 meet_at/meet_repeat；返回 { meet_at, meet_repeat } 或 { error }
export function parseMeetAt(body, current = {}) {
  const t = now();
  let meetAt = null;
  let meetRepeat = current.meet_repeat || null;
  const rawAt = body.meet_at;
  if (rawAt !== undefined && rawAt !== null && rawAt !== '') {
    const n = Number(rawAt);
    if (!Number.isFinite(n) || n <= 0) return { error: MEET_ERR };
    const rawRepeat = body.meet_repeat !== undefined ? body.meet_repeat : current.meet_repeat;
    if (rawRepeat != null && rawRepeat !== '' && !MEET_REPEATS.includes(rawRepeat)) {
      return { error: '重复规则不合法（仅支持 weekly/daily）' };
    }
    meetRepeat = MEET_REPEATS.includes(rawRepeat) ? rawRepeat : null;
    if (!meetRepeat && (n < t + MEET_MIN_LEAD_MS || n > t + MEET_MAX_LEAD_MS)) {
      return { error: MEET_ERR }; // 非周期局才要求"未来"——周期局豁免（长期帖）
    }
    meetAt = Math.round(n);
  } else if (body.meet_repeat !== undefined) {
    if (body.meet_repeat !== null && body.meet_repeat !== '' && !MEET_REPEATS.includes(body.meet_repeat)) {
      return { error: '重复规则不合法（仅支持 weekly/daily）' };
    }
    meetRepeat = MEET_REPEATS.includes(body.meet_repeat) ? body.meet_repeat : null;
  }
  return { meet_at: meetAt, meet_repeat: meetRepeat };
}

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
  // G-后门2（R4灰产）：地点名此前未过滤，原文入库公开展示（"西湖边上 vx:xxx"广告牌）
  const fLoc = filterContent(String(location_name || ''));
  if (fTitle.hits.length || fContent.hits.length || fReq.hits.length || fLoc.hits.length) {
    return res.status(400).json({ error: '内容包含违规信息（导流/欺诈/违规词汇），请修改后发布。如需联系请使用站内聊天。' });
  }

  const nc = Math.min(20, Math.max(1, parseInt(need_count) || 1));
  const fm = ['free', 'aa', 'treat'].includes(fee_mode) ? fee_mode : 'aa';
  if (!['any', 'female', 'male'].includes(gender_req || 'any')) return res.status(400).json({ error: '性别要求不合法' });

  // TS-1②：meet_at 结构化时间（可空，NULL 时行为与旧版完全一致）
  const meet = parseMeetAt(req.body || {});
  if (meet.error) return res.status(400).json({ error: meet.error });

  // 幂等护栏（H16）：同用户短窗口内同标题+同内容的重复提交（多 tab / 网络重试）只落一帖，直接返回已有帖。
  // SQLite 同步执行 + 单进程事件循环，检查与插入之间无 await，天然无并发竞态。
  const dup = db.prepare(`
    SELECT * FROM posts WHERE user_id = ? AND title = ? AND content = ? AND created_at > ?
    ORDER BY id DESC LIMIT 1
  `).get(u.id, fTitle.cleaned, fContent.cleaned, now() - 60_000);
  if (dup) return res.json(ok(postView(dup, u)));

  const info = db.prepare(`
    INSERT INTO posts (user_id, category, title, content, city, location_name, meet_time, meet_at, meet_repeat, need_count, fee_mode, gender_req, requirements, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?)
  `).run(u.id, category, fTitle.cleaned, fContent.cleaned, cityS,
    fLoc.cleaned.slice(0, 50), String(meet_time || '').slice(0, 30), meet.meet_at, meet.meet_repeat, nc, fm, gender_req || 'any', fReq.cleaned, now());
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now(), u.id);
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  trackEvent(u.id, 'publish', p.id); // VD-01 漏斗：发布
  res.json(ok(postView(p, u)));
});

// ---------- 帖子详情 ----------
postsRouter.get('/:id', optionalAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  db.prepare('UPDATE posts SET views_count = views_count + 1 WHERE id = ?').run(p.id);
  trackEvent(req.user ? req.user.id : null, 'post_view', p.id); // VD-01 漏斗：浏览（游客 userId 为 null）
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
    // TS-1②：长度上限与创建路径对齐（此前编辑 meet_time/location_name 用 1000 上限，与创建的 30/50 自相矛盾）
    const max = f === 'title' ? 40 : f === 'meet_time' ? 30 : f === 'location_name' ? 50 : 1000;
    sets.push(`${f} = ?`);
    vals.push(filtered.cleaned.slice(0, max));
  }
  // TS-1②：meet_at / meet_repeat 编辑（undefined=不改；null/''=清空；提供时同创建校验）
  if (body.meet_at !== undefined || body.meet_repeat !== undefined) {
    const meet = parseMeetAt(body, { meet_repeat: p.meet_repeat });
    if (meet.error) return res.status(400).json({ error: meet.error });
    if (body.meet_at !== undefined) { sets.push('meet_at = ?'); vals.push(meet.meet_at); }
    if (body.meet_repeat !== undefined) { sets.push('meet_repeat = ?'); vals.push(meet.meet_repeat); }
  }
  if (body.need_count !== undefined) {
    const nc = Math.min(20, Math.max(1, parseInt(body.need_count) || 1));
    const approved = db.prepare("SELECT COUNT(*) c FROM joins WHERE post_id = ? AND status = 'approved'").get(p.id).c;
    if (nc < approved) return res.status(400).json({ error: `已有 ${approved} 人通过，人数上限不能低于该数` });
    sets.push('need_count = ?'); vals.push(nc);
    // C2（R3完整性）满员扩容闭环：满员帖扩容出空位 → 自动回到 open 继续招募，
    // 并把此前被拒（含满员自动婉拒）的申请批量恢复为待审、逐一通知回流——
    // 此前扩容后 status 仍是 'full'（新用户加入报"已停止招募"），被拒者也永远错过第二次机会。
    const willCloseOrDone = body.status === 'closed' || body.status === 'done';
    if (nc > approved && p.status === 'full' && !willCloseOrDone) {
      if (body.status === undefined) { sets.push('status = ?'); vals.push('open'); } // status='open' 时由下方通用分支落库，避免重复 SET
      const rejected = db.prepare("SELECT * FROM joins WHERE post_id = ? AND status = 'rejected'").all(p.id);
      const t = now();
      for (const rj of rejected) {
        db.prepare("UPDATE joins SET status = 'pending', updated_at = ? WHERE id = ?").run(t, rj.id);
        notify(rj.user_id, 'join_result', '搭局扩容了', `「${p.title}」扩容了，你的申请重新进入待审，请耐心等待组局者审核`, { post_id: p.id });
      }
    }
  }
  if (body.status !== undefined) {
    if (!['open', 'closed', 'done'].includes(body.status)) return res.status(400).json({ error: '状态不合法' });
    // T3-P0（R4状态机）done 幂等护栏：已完成局拒绝任何再改状态——
    // 此前重复 done（双击/网络重试）重复给全员加分+落重复通知；且 done→open→done 可无限循环刷分。
    if (p.status === 'done') return res.status(400).json({ error: '该搭局已完成' });
    sets.push('status = ?'); vals.push(body.status);
    if (body.status === 'done') {
      completePost(p);
      // R2-N7: 完成时剩余 pending 一并婉拒并通知（与满员同款，避免悬置）
      rejectPendingJoins(p, '「' + p.title + '」已标记完成，申请自动关闭');
      trackEvent(req.user.id, 'done', p.id); // VD-01 漏斗：完成
    }
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
  // 拉黑动作级拦截（R1延期项）：与帖主存在拉黑关系（双向任一）时禁止互动
  if (anyBlocked(req.user.id, p.user_id)) return res.status(403).json({ error: '无法与该用户互动' });
  const exist = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(req.user.id, p.id);
  if (exist) {
    db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, p.id);
    db.prepare('UPDATE posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').run(p.id);
    return res.json(ok({ liked: false }));
  }
  db.prepare('INSERT INTO likes (user_id, post_id, created_at) VALUES (?,?,?)').run(req.user.id, p.id, now());
  db.prepare('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?').run(p.id);
  if (p.user_id !== req.user.id) notify(p.user_id, 'like', '收到新点赞', `${req.user.nickname} 赞了你的搭局「${p.title}」`, { post_id: p.id }, req.user.id);
  res.json(ok({ liked: true }));
});

// ---------- 评论 ----------
postsRouter.get('/:id/comments', optionalAuth, (req, res) => {
  const pid = parseInt(req.params.id);
  let sql = `
    SELECT cm.*, u.nickname, u.avatar, u.gender FROM comments cm JOIN users u ON cm.user_id = u.id
    WHERE cm.post_id = ?`;
  const vals = [pid];
  // 拉黑落地（H2）：登录视角过滤被拉黑用户的评论，游客不过滤
  if (req.user) {
    sql += ' AND cm.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)';
    vals.push(req.user.id, req.user.id);
  }
  sql += ' ORDER BY cm.id ASC LIMIT 200';
  const rows = db.prepare(sql).all(...vals);
  res.json(ok(rows.map((r) => ({
    id: r.id, content: r.content, created_at: r.created_at,
    user: { id: r.user_id, nickname: r.nickname, avatar: r.avatar, gender: r.gender },
  }))));
});

postsRouter.post('/:id/comments', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  // 拉黑动作级拦截（R1延期项）：与帖主存在拉黑关系（双向任一）时禁止评论
  if (anyBlocked(req.user.id, p.user_id)) return res.status(403).json({ error: '无法与该用户互动' });
  const f = filterContent(String((req.body || {}).content || '').trim());
  if (!f.cleaned) return res.status(400).json({ error: '评论不能为空' });
  if (f.hits.length) return res.status(400).json({ error: '评论包含违规信息，请修改' });
  if (f.cleaned.length > 300) return res.status(400).json({ error: '评论最多 300 字' });
  db.prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?,?,?,?)').run(p.id, req.user.id, f.cleaned, now());
  db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(p.id);
  if (p.user_id !== req.user.id) notify(p.user_id, 'comment', '收到新评论', `${req.user.nickname} 评论了你的搭局「${p.title}」：${f.cleaned.slice(0, 50)}`, { post_id: p.id }, req.user.id);
  res.json(ok({ commented: true }));
});

// ---------- 申请加入搭局 ----------
postsRouter.post('/:id/join', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  // 拉黑动作级拦截（R1延期项）：与帖主存在拉黑关系（双向任一）时禁止申请
  if (anyBlocked(req.user.id, p.user_id)) return res.status(403).json({ error: '无法与该用户互动' });
  if (p.status !== 'open') return res.status(400).json({ error: '该搭局已停止招募' });
  if (p.user_id === req.user.id) return res.status(400).json({ error: '不能加入自己发布的搭局' });
  // TS-2③（R5时间语义）入口时间守卫：meet_at 已过 24h 的 open 局不再收新申请（活动已散场，
  // 组局者永不再审核 → 申请悬置）。不必等 jobs 扫描（10 分钟粒度），即刻拦截；周期局不受限。
  if (p.meet_at && !p.meet_repeat && now() > p.meet_at + 24 * 3600_000) {
    return res.status(400).json({ error: '该搭局时间已过' });
  }
  const exist = db.prepare('SELECT * FROM joins WHERE post_id = ? AND user_id = ?').get(p.id, req.user.id);
  // rejected / quit 可重新申请（退出通道不是单行道）；pending/approved 不可重复申请
  if (exist && exist.status !== 'rejected' && exist.status !== 'quit') return res.status(400).json({ error: '已申请过该搭局' });
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
  notify(p.user_id, 'join_request', '收到入搭申请', `${req.user.nickname} 申请加入「${p.title}」`, { post_id: p.id, join_user_id: req.user.id }, req.user.id);
  trackEvent(req.user.id, 'join', p.id); // VD-01 漏斗：申请
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
  // T4（R4状态机）帖子状态守卫：approve 此前从不读 p.status——expired/closed 局被批准并
  // "复活"为 full（jobs 置 expired 与组局者点通过交错时），expired_count 与 approved_count 从此对不上。
  if (p.status !== 'open' && p.status !== 'full') {
    return res.status(400).json({ error: '该搭局已过期或结束' });
  }
  if (j.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });
  const approve = !!((req.body || {}).approve);
  // T5（R4状态机）账号状态复查：申请人已注销/封禁时不占用名额、不建会话、不涨搭力值——
  // 该 join 直接置 rejected 并向组局者说明（对齐 chat WS 每帧点查 users.status 的口径）。
  const applicant = db.prepare('SELECT status FROM users WHERE id = ?').get(j.user_id);
  const applicantActive = !!applicant && applicant.status === 'active';
  if (approve && !applicantActive) {
    db.prepare("UPDATE joins SET status = 'rejected', updated_at = ? WHERE id = ?").run(now(), j.id);
    return res.status(400).json({ error: '该用户账号已注销或异常，其申请已自动拒绝' });
  }
  const approved = db.prepare("SELECT COUNT(*) c FROM joins WHERE post_id = ? AND status = 'approved'").get(p.id).c;
  if (approve && approved >= p.need_count) return res.status(400).json({ error: '人数已满' });
  db.prepare("UPDATE joins SET status = ?, updated_at = ? WHERE id = ?").run(approve ? 'approved' : 'rejected', now(), j.id);
  if (approve) {
    // 通过即建立站内会话，保证"去聊天"有入口
    getOrCreateConv(p.user_id, j.user_id, p.id);
    notify(j.user_id, 'join_result', '申请已通过', `你已加入「${p.title}」，快去和组局者聊聊吧`, { post_id: p.id });
    trackEvent(req.user.id, 'approve', p.id); // VD-01 漏斗：通过
    if (approved + 1 >= p.need_count) {
      db.prepare("UPDATE posts SET status = 'full' WHERE id = ?").run(p.id);
      // 满员后剩余 pending 申请自动婉拒并通知（用户批评R1 搭子王#3）：
      // 此前第 N 名申请者会永远 pending、收不到任何结果通知，申请端"焦虑等待"无闭环。
      const pendings = db.prepare("SELECT * FROM joins WHERE post_id = ? AND status = 'pending'").all(p.id);
      const t = now();
      for (const pj of pendings) {
        db.prepare("UPDATE joins SET status = 'rejected', updated_at = ? WHERE id = ?").run(t, pj.id);
        notify(pj.user_id, 'join_result', '申请未通过', `「${p.title}」该搭局已满员，未能通过你的申请，别灰心，广场上还有更多搭局`, { post_id: p.id });
      }
    }
  } else if (applicantActive) {
    // 已注销/封禁用户不再投递通知（T5：避免给死账号落无效数据）
    notify(j.user_id, 'join_result', '申请未通过', `「${p.title}」的组局者未通过你的申请，别灰心，广场上还有更多搭局`, { post_id: p.id });
  }
  res.json(ok({ approved }));
});

// ---------- 申请人退出申请（T2：激活 joins.status 的 quit 死枚举） ----------
// 仅本人、仅 pending/rejected 可退出；approved 已占名额不可自行退出（找组局者拒绝处理）。
// quit 的申请不回流：满员扩容恢复 rejected→pending 时不会捞 quit 行（见 PUT /:id 扩容分支）。
postsRouter.post('/:id/quit', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: '搭局不存在' });
  const j = db.prepare('SELECT * FROM joins WHERE post_id = ? AND user_id = ?').get(p.id, req.user.id);
  if (!j) return res.status(404).json({ error: '你没有申请过该搭局' });
  if (j.status === 'quit') return res.status(400).json({ error: '已退出过该搭局' });
  if (j.status !== 'pending' && j.status !== 'rejected') {
    return res.status(400).json({ error: '申请已通过，无法退出' });
  }
  db.prepare("UPDATE joins SET status = 'quit', updated_at = ? WHERE id = ?").run(now(), j.id);
  notify(p.user_id, 'join_quit', '申请人退出', `${req.user.nickname} 退出了「${p.title}」的申请`, { post_id: p.id }, req.user.id);
  res.json(ok({ quit: true }));
});

// R2-N7: 组局结束（done）时婉拒剩余 pending（复用满员同款逻辑）
function rejectPendingJoins(p, bodyText) {
  const pendings = db.prepare("SELECT * FROM joins WHERE post_id = ? AND status = 'pending'").all(p.id);
  const t = now();
  for (const pj of pendings) {
    db.prepare("UPDATE joins SET status = 'rejected', updated_at = ? WHERE id = ?").run(t, pj.id);
    notify(pj.user_id, 'join_result', '申请未通过', `${bodyText}，别灰心，广场上还有更多搭局`, { post_id: p.id });
  }
}

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
  trackEvent(req.user.id, 'rate', p.id); // VD-01 漏斗：互评
  // VD-03：双方互评完成（对方也评过我）→ 建立/累加搭友关系 times+1
  const reverseRated = db.prepare('SELECT 1 FROM ratings WHERE post_id = ? AND rater_id = ? AND ratee_id = ?')
    .get(p.id, ratee.id, req.user.id);
  if (reverseRated) getOrCreatePartner(req.user.id, ratee.id, p.id);
  res.json(ok({ rated: true }));
});

// 搭局完成时给参与者加分
// T3-P0（R4状态机）二道守卫：0 个 approved 成员的局不算"完成搭局"——
// 状态照常流转，但作者不加分，封死"发帖→立即done→+20"的无限刷分循环；
// （PUT 路由的 status 幂等守卫是第一道，这里是函数级兜底。）
// T5：加分/通知前复查用户状态，已注销/封禁的成员跳过（对齐 approve 侧口径）。
function completePost(p) {
  const members = db.prepare("SELECT user_id FROM joins WHERE post_id = ? AND status = 'approved'").all(p.id);
  if (!members.length) return;
  const author = db.prepare('SELECT status FROM users WHERE id = ?').get(p.user_id);
  if (author && author.status === 'active') {
    addCredit(p.user_id, 20, `「${p.title}」搭局完成`);
  }
  for (const m of members) {
    const mu = db.prepare('SELECT status FROM users WHERE id = ?').get(m.user_id);
    if (!mu || mu.status !== 'active') continue; // 非active成员：不加分、不落通知
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
