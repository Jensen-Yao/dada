import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth, optionalAuth, ok, safeJSON, filterContent, CATEGORIES, CATEGORY_MAP, FEE_MODES, GENDER_REQS, RATE_TAGS } from '../util.js';
import { myPostsRouter, postsRouter, coverFields } from './posts.js';
import { reportRouter } from './users.js';
import { matchScore, mbtiScore, cityScore } from '../match.js';

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
  // 显式传 city=（空串）=全城；未传时登录用户默认自己城市
  const city = req.query.city !== undefined ? String(req.query.city) : (me ? me.city : '');
  // 拉黑落地（H2）：登录视角过滤"我拉黑的 / 拉黑我的"用户发的帖
  const blockFilter = me
    ? 'AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)'
    : '';
  // P1-4（R3公平性）：性别限制局硬过滤——线下搭子的加入资格是硬约束而非偏好，
  // 与我性别不符的局不该占推荐坑位（广场仍全量可见）。secret 用户视为未公开性别 → 只看不限性别。
  const genderFilter = me
    ? (me.gender === 'secret' ? "AND p.gender_req = 'any'" : "AND (p.gender_req = 'any' OR p.gender_req = ?)")
    : '';
  const genderVals = me && me.gender !== 'secret' ? [me.gender] : [];
  const rows = db.prepare(`
    SELECT p.* FROM posts p JOIN users u ON p.user_id = u.id
    WHERE p.status = 'open' AND u.status = 'active'
      AND (? IS NULL OR p.city = ?)
      ${genderFilter}
      ${blockFilter}
    ORDER BY (p.likes_count + p.comments_count * 2) DESC, p.id DESC LIMIT 20
  `).all(city || null, city || null, ...genderVals, ...(me ? [me.id, me.id] : []));
  const viewer = me || null;
  const list = rows.map((p) => {
    const author = db.prepare('SELECT * FROM users WHERE id = ?').get(p.user_id);
    const liked = viewer ? !!db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(viewer.id, p.id) : false;
    return {
      id: p.id, title: p.title, category: p.category,
      category_name: CATEGORY_MAP[p.category]?.name, category_icon: CATEGORY_MAP[p.category]?.icon,
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

// ---------- 为你推荐（v2.9 MT-02：确定性多维匹配评分，核心公式见 src/match.js 与规格 §H.0） ----------
miscRouter.get('/for-you', requireAuth, (req, res) => {
  const me = req.user;
  // 个性化推荐关闭（算法推荐规定17条）：立即生效，返回空列表 + rec_off 标记供前端降级为热门流
  if (me.rec_off) {
    return res.json(ok({ list: [], rec_off: true }));
  }
  // 我方上下文：标签 / MBTI / 城市 / 分类历史（参加通过的局 + 自己发布的局，含重复次数）
  const myTags = safeJSON(me.tags, []);
  const myMbti = me.mbti || '';
  const myCity = me.city || '';
  const myCatHistory = [
    ...db.prepare(`
      SELECT p.category FROM posts p JOIN joins j ON j.post_id = p.id
      WHERE j.user_id = ? AND j.status = 'approved'
    `).all(me.id).map((r) => r.category),
    ...db.prepare('SELECT category FROM posts WHERE user_id = ?').all(me.id).map((r) => r.category),
  ];

  // 候选池（H.0）：开放帖 + 作者活跃 + 非本人 + 拉黑过滤；池内全量评分，不做任何随机打乱
  // A3 修复：候选池限定最近 200 条开放帖。此前无 LIMIT 全量拉取——同步评分在事件循环里串行执行，
  // 50k open 帖实测单请求 8.7s，期间全站（HTTP/WS/心跳）冻结。取舍：更早的开放帖不再进入个性化
  // 排序（广场 feed 仍有全量分页兜底，且 >200 条之前的开放帖大概率已被 14 天过期任务回收），
  // 换取时延上限可预测（200 行 × 2 次点查 + 排序，毫秒级）。
  // P1-4（R3公平性）：性别限制局硬过滤（与 /recommend 同一口径）——性别不符的局在候选池即剔除，
  // 不再"可见但不可加入"地占用推荐坑位、让用户读到详情写完申请语才吃 403。
  // secret（未公开性别）用户只看不限性别的局；广场 feed 不受影响。
  const genderClause = me.gender === 'secret' ? "AND p.gender_req = 'any'" : "AND (p.gender_req = 'any' OR p.gender_req = ?)";
  const rows = db.prepare(`
    SELECT p.* FROM posts p JOIN users u ON p.user_id = u.id
    WHERE p.status = 'open' AND u.status = 'active' AND p.user_id != ?
      ${genderClause}
      AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)
    ORDER BY p.id DESC LIMIT 200
  `).all(me.id, ...(me.gender === 'secret' ? [] : [me.gender]), me.id, me.id);

  const getAuthor = db.prepare('SELECT * FROM users WHERE id = ?');
  const toView = (p, author, tagOverlap) => ({
    id: p.id, title: p.title, category: p.category,
    category_name: CATEGORY_MAP[p.category]?.name, category_icon: CATEGORY_MAP[p.category]?.icon,
    city: p.city, meet_time: p.meet_time,
    images: safeJSON(p.images, []),
    ...coverFields(p),
    author: { id: author.id, nickname: author.nickname, avatar: author.avatar },
    // 旧字段保留（兼容未升级卡片）
    tag_overlap: tagOverlap,
    reason: tagOverlap.length ? `你们都爱「${tagOverlap[0]}」` : `${CATEGORY_MAP[p.category]?.name || '搭子'} · 可能合拍`,
  });

  // 冷启动（MT-02-4）：标签/MBTI/城市/分类历史四项全空 → 无可个性化维度（仅剩 credit+active），
  // 不出评分，降级为热门 20 条（与 /recommend 同款热度公式），每条不带 match_score
  if (!myTags.length && !myMbti && !myCity && !myCatHistory.length) {
    const hot = rows
      .slice()
      .sort((a, b) => (b.likes_count + b.comments_count * 2) - (a.likes_count + a.comments_count * 2) || b.id - a.id)
      .slice(0, 20)
      .map((p) => toView(p, getAuthor.get(p.user_id), []));
    return res.json(ok({ list: hot, cold_start: true, my_tags: myTags, my_city: myCity, my_categories: [] }));
  }

  // 作者侧上下文：7 日内发过帖或评论（活跃度，SQL 一次性判定）
  const weekAgo = now() - 7 * 86400000;
  const activeSet = new Set(db.prepare(`
    SELECT user_id FROM posts WHERE created_at >= ?
    UNION
    SELECT user_id FROM comments WHERE created_at >= ?
  `).all(weekAgo, weekAgo).map((r) => r.user_id));

  const list = rows.map((p) => {
    const author = getAuthor.get(p.user_id);
    const authorTags = safeJSON(author.tags, []);
    const tagOverlap = myTags.filter((t) => authorTags.includes(t));
    const mbti = mbtiScore(myMbti, author.mbti);
    const city = cityScore(myCity, p.city);
    const catScore = myCatHistory.length
      ? myCatHistory.filter((c) => c === p.category).length / myCatHistory.length
      : null;
    const score = matchScore({
      myTags, authorTags, myMbti, authorMbti: author.mbti,
      myCity, postCity: p.city, myCatHistory, postCategory: p.category,
      authorCredit: author.credit, authorActive: activeSet.has(author.id),
    });
    // match_reasons（≤3 条，枚举文案，固定顺序：标签→同城/同省→MBTI→分类→信用）
    const reasons = [];
    // VD-04 老搭子后置加分（路由层做，match.js 纯函数零改动）：
    // 作者与我互为搭友 → score = min(100, score + 10 × min(times, 3))，理由置顶
    let finalScore = score;
    let partnerTimes = 0;
    const partnerRow = db.prepare('SELECT times FROM partners WHERE (user_a = ? AND user_b = ?) OR (user_b = ? AND user_a = ?)')
      .get(me.id, p.user_id, me.id, p.user_id);
    if (partnerRow && typeof score === 'number') {
      partnerTimes = partnerRow.times;
      finalScore = Math.min(100, score + 10 * Math.min(partnerRow.times, 3));
      reasons.push(`老搭子·搭过${partnerRow.times}次`); // 放最前
    }
    if (tagOverlap.length) reasons.push(`${tagOverlap.length}个共同兴趣`);
    if (city === 1) reasons.push(`同城·${p.city}`);
    else if (city === 0.6) reasons.push(`同省·${p.city.slice(0, 2)}`);
    if (mbti !== null && mbti >= 0.75) reasons.push('MBTI互补');
    if (catScore !== null && catScore > 0) reasons.push(`常玩${CATEGORY_MAP[p.category]?.name || '搭子'}`);
    if (author.credit >= 650) reasons.push('高信用搭友');
    return { ...toView(p, author, tagOverlap), match_score: finalScore, match_reasons: reasons.slice(0, 3), partner_times: partnerTimes };
  }).sort((a, b) => b.match_score - a.match_score || b.id - a.id).slice(0, 20);

  res.json(ok({
    list,
    cold_start: false,
    my_tags: myTags,
    my_city: myCity,
    my_categories: [...new Set(myCatHistory)], // 兼容旧字段
  }));
});

// ---------- 意见反馈（Ops-O5）：设置页提交入口；admin 队列见 /api/admin/feedback ----------
miscRouter.post('/feedback', requireAuth, (req, res) => {
  const content = String((req.body || {}).content || '').trim();
  if (content.length < 5 || content.length > 500) {
    return res.status(400).json({ error: '反馈内容需为 5-500 字' });
  }
  const f = filterContent(content);
  if (f.hits.length) return res.status(400).json({ error: '反馈包含违规信息，请修改' });
  db.prepare("INSERT INTO feedback (user_id, content, status, created_at) VALUES (?,?,'open',?)")
    .run(req.user.id, f.cleaned, now());
  res.json(ok({ submitted: true }));
});

// 挂载子路由
miscRouter.use('/my/posts', myPostsRouter());
// C7（R3完整性）：举报进度查询激活——reportRouter 此前是死代码（导入未挂载，GET /api/reports/mine 404）。
// 现挂载到 /api/reports（含 POST / 通用举报入口 与 GET /mine 我的举报进度）。
miscRouter.use('/reports', reportRouter(Router));
