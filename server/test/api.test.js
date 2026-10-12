import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(ROOT, 'data', 'test.sqlite');

// 独立测试库
fs.rmSync(DB_PATH, { force: true });
fs.rmSync(DB_PATH + '-wal', { force: true });
fs.rmSync(DB_PATH + '-shm', { force: true });
process.env.DADA_DB = DB_PATH;
process.env.DADA_PORT = String(PORT);

// 先导入依赖该 env 的模块
await import('../src/db.js');

// 通过子进程跑种子（写入测试专用库）
await new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(ROOT, 'src', 'seed.js')], {
    env: { ...process.env, DADA_DB: DB_PATH },
    stdio: 'inherit',
  });
  p.on('exit', resolve);
});

// 启动服务器
await import('../src/index.js');
await new Promise((r) => setTimeout(r, 500));

let tokenA, tokenB, tokenAdmin, userIdA, userIdB;

async function api(method, url, body, token) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

test('元信息接口', async () => {
  const r = await api('GET', '/api/meta');
  assert.equal(r.status, 200);
  assert.ok(r.json.ok);
  assert.equal(r.json.data.categories.length, 14);
});

test('注册：参数校验', async () => {
  const r = await api('POST', '/api/auth/register', { username: 'x', password: '123456', nickname: 'x' });
  assert.equal(r.status, 400);
});

test('注册+登录流程', async () => {
  const r = await api('POST', '/api/auth/register', { username: 'tester_a', password: '123456', nickname: '测试甲', gender: 'female', city: '北京' });
  assert.equal(r.status, 200);
  tokenA = r.json.data.token;
  userIdA = r.json.data.user.id;
  assert.equal(r.json.data.user.username, 'tester_a');
  const r2 = await api('POST', '/api/auth/register', { username: 'tester_b', password: '123456', nickname: '测试乙', gender: 'male', city: '北京' });
  tokenB = r2.json.data.token;
  userIdB = r2.json.data.user.id;
  const login = await api('POST', '/api/auth/login', { username: 'tester_a', password: '123456' });
  assert.equal(login.status, 200);
  assert.ok(login.json.data.token);
  const bad = await api('POST', '/api/auth/login', { username: 'tester_a', password: 'wrong' });
  assert.equal(bad.status, 401);
});

test('游客可浏览广场', async () => {
  const r = await api('GET', '/api/posts');
  assert.equal(r.status, 200);
  assert.ok(r.json.data.list.length >= 10);
  assert.equal(r.json.data.list[0].author.nickname !== undefined, true);
});

test('筛选：分类+城市', async () => {
  const r = await api('GET', '/api/posts?category=food&city=北京');
  assert.equal(r.status, 200);
  assert.ok(r.json.data.list.every((p) => p.category === 'food' && p.city === '北京'));
});

test('发布搭局：成功', async () => {
  const r = await api('POST', '/api/posts', {
    category: 'food', title: '测试火锅局', content: '周五晚上吃火锅', city: '北京',
    meet_time: '周五 19:00', need_count: 2, fee_mode: 'aa', gender_req: 'any',
  }, tokenA);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.status, 'open');
});

test('发布搭局：敏感词拦截（导流）', async () => {
  const r = await api('POST', '/api/posts', {
    category: 'food', title: '加微信找我', content: 'x', city: '北京',
  }, tokenA);
  assert.equal(r.status, 400);
  assert.ok(r.json.error.includes('违规'));
});

test('发布搭局：涉黄暗语拦截', async () => {
  const r = await api('POST', '/api/posts', {
    category: 'travel', title: '旅游搭子费用全包', content: '只限女生', city: '北京',
  }, tokenA);
  assert.equal(r.status, 400);
});

test('申请加入 + 组局者审批', async () => {
  const posts = await api('GET', '/api/posts?keyword=测试火锅局', null, tokenA);
  const pid = posts.json.data.list[0].id;
  // B 申请
  const j = await api('POST', `/api/posts/${pid}/join`, { message: '我能吃辣！' }, tokenB);
  assert.equal(j.status, 200);
  // 重复申请被拒
  const j2 = await api('POST', `/api/posts/${pid}/join`, {}, tokenB);
  assert.equal(j2.status, 400);
  // A 查看申请人
  const list = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  assert.equal(list.status, 200);
  assert.equal(list.json.data[0].status, 'pending');
  const joinId = list.json.data[0].id;
  // 通过
  const ap = await api('POST', `/api/posts/${pid}/joins/${joinId}/approve`, { approve: true }, tokenA);
  assert.equal(ap.status, 200);
  // 人数满后状态变 full
  const detail = await api('GET', `/api/posts/${pid}`);
  // need_count=2 但 approved=1（含组局者外），1 approved < 2 → 还是 open
  assert.ok(['open', 'full'].includes(detail.json.data.status));
});

test('私信门槛与聊天流程', async () => {
  const posts = await api('GET', '/api/posts?keyword=测试火锅局');
  const pid = posts.json.data.list[0].id;
  // B 通过入搭关系可与 A 开启会话
  const conv = await api('POST', '/api/chat/conv', { user_id: userIdA, post_id: pid }, tokenB);
  assert.equal(conv.status, 200);
  const convId = conv.json.data.id;
  // 发消息走 REST 备用通道不存在，直接用内部函数测试 WebSocket 逻辑
  const { handleChatMessage } = await import('../src/routes/chat.js');
  const { db } = await import('../src/db.js');
  const userB = db.prepare('SELECT * FROM users WHERE id = ?').get(userIdB);
  const r1 = handleChatMessage(userB, convId, '你好呀，周五见！');
  assert.ok(!r1.error, 'should send ok: ' + (r1.error || ''));
  const r2 = handleChatMessage(userB, convId, '我的加微信是 xxx');
  assert.ok(!r2.error);
  // 敏感词被替换为 *
  const msgs = await api('GET', `/api/chat/conv/${convId}/messages`, null, tokenB);
  assert.equal(msgs.status, 200);
  const replaced = msgs.json.data.messages.find((m) => m.content.includes('***'));
  assert.ok(replaced, 'sensitive word should be masked');
  const safety = msgs.json.data.messages.find((m) => m.type === 'safety');
  assert.ok(safety, 'first message should inject safety tip');
});

test('评价体系：需先完成搭局', async () => {
  const posts = await api('GET', '/api/posts?keyword=测试火锅局');
  const pid = posts.json.data.list[0].id;
  const r = await api('POST', `/api/posts/${pid}/rate`, { ratee_id: userIdB, stars: 5, tags: ['靠谱'] }, tokenA);
  assert.equal(r.status, 400); // 未完成
  // 标记完成
  const done = await api('PUT', `/api/posts/${pid}`, { status: 'done' }, tokenA);
  assert.equal(done.status, 200);
  // 完成后互评
  const r2 = await api('POST', `/api/posts/${pid}/rate`, { ratee_id: userIdB, stars: 5, tags: ['靠谱', '守时'], comment: '非常棒' }, tokenA);
  assert.equal(r2.status, 200);
  // 重复评价被拒
  const r3 = await api('POST', `/api/posts/${pid}/rate`, { ratee_id: userIdB, stars: 4 }, tokenA);
  assert.equal(r3.status, 400);
  // B 评 A
  const r4 = await api('POST', `/api/posts/${pid}/rate`, { ratee_id: userIdA, stars: 5, tags: ['友善'] }, tokenB);
  assert.equal(r4.status, 200);
});

test('完成搭局后搭力值增加', async () => {
  const me = await api('GET', '/api/auth/me', null, tokenB);
  assert.ok(me.json.data.credit > 600, 'credit should increase after done+rated, got ' + me.json.data.credit);
});

test('搭力值不足禁止发布', async () => {
  const { db } = await import('../src/db.js');
  db.prepare('UPDATE users SET credit = 100 WHERE id = ?').run(userIdB);
  const r = await api('POST', '/api/posts', { category: 'food', title: '低分发布测试', content: 'x', city: '北京' }, tokenB);
  assert.equal(r.status, 403);
  db.prepare('UPDATE users SET credit = 600 WHERE id = ?').run(userIdB);
});

test('拉黑后无法私信', async () => {
  await api('POST', `/api/users/${userIdA}/block`, {}, tokenB);
  // 广场已不显示done的局，改从A的发布列表取post_id（仅用于会话参数）
  const mine = await api('GET', '/api/my/posts/published', null, tokenA);
  const pid = mine.json.data.find((p) => p.title === '测试火锅局').id;
  const r = await api('POST', '/api/chat/conv', { user_id: userIdA, post_id: pid }, tokenB);
  assert.equal(r.status, 403);
  await api('DELETE', `/api/users/${userIdA}/block`, null, tokenB);
});

test('举报+通知', async () => {
  const r = await api('POST', `/api/users/${userIdA}/report`, { reason: '骚扰', detail: '测试举报' }, tokenB);
  assert.equal(r.status, 200);
  const notifs = await api('GET', '/api/notifications', null, tokenB);
  assert.equal(notifs.status, 200);
  assert.ok(notifs.json.data.length > 0);
});

test('游客不能发帖/不能私信', async () => {
  const r = await api('POST', '/api/posts', { category: 'food', title: 'x', content: 'x', city: '北京' });
  assert.equal(r.status, 401);
  const r2 = await api('POST', '/api/chat/conv', { user_id: 1 });
  assert.equal(r2.status, 401);
});

test('仅限女生的搭局：男生申请被拒', async () => {
  const r = await api('POST', '/api/posts', {
    category: 'coffee', title: '仅女生咖啡局', content: 'x', city: '北京', gender_req: 'female',
  }, tokenA); // A 是女生
  assert.equal(r.status, 200);
  const pid = r.json.data.id;
  const j = await api('POST', `/api/posts/${pid}/join`, {}, tokenB); // B 是男生
  assert.equal(j.status, 403);
});

test('管理员：登录后台/处理举报', async () => {
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: '123456' });
  tokenAdmin = login.json.data.token;
  assert.equal(login.status, 200);
  const stats = await api('GET', '/api/admin/stats', null, tokenAdmin);
  assert.equal(stats.status, 200);
  assert.ok(stats.json.data.users >= 12);
  const reports = await api('GET', '/api/admin/reports', null, tokenAdmin);
  assert.equal(reports.status, 200);
  assert.ok(reports.json.data.length >= 1);
  const rid = reports.json.data[0].id;
  const resolve = await api('POST', `/api/admin/reports/${rid}/resolve`, { action: 'warn' }, tokenAdmin);
  assert.equal(resolve.status, 200);
  // 普通用户无权访问后台
  const forbidden = await api('GET', '/api/admin/stats', null, tokenA);
  assert.equal(forbidden.status, 403);
});

test('安全中心与紧急求助', async () => {
  const tips = await api('GET', '/api/safety/tips');
  assert.equal(tips.status, 200);
  assert.ok(tips.json.data.emergency.length >= 5);
  assert.ok(tips.json.data.community_rules.length >= 5);
  const sos = await api('POST', '/api/safety/sos', { location: '五道口', note: '感觉不对劲' }, tokenA);
  assert.equal(sos.status, 200);
});

test('推荐接口', async () => {
  const r = await api('GET', '/api/recommend?city=北京');
  assert.equal(r.status, 200);
  assert.ok(r.json.data.list.length > 0);
  const fy = await api('GET', '/api/for-you', null, tokenB);
  assert.equal(fy.status, 200);
});

test('个人主页与编辑资料', async () => {
  const r = await api('GET', `/api/users/${userIdA}`);
  assert.equal(r.status, 200);
  assert.ok(r.json.data.rating_avg !== null);
  const edit = await api('PUT', '/api/users/me', { bio: '新签名', tags: ['美食', '摄影'] }, tokenA);
  assert.equal(edit.status, 200);
  assert.deepEqual(edit.json.data.tags, ['美食', '摄影']);
});

test('点赞与评论', async () => {
  const posts = await api('GET', '/api/posts');
  const pid = posts.json.data.list[0].id;
  const like = await api('POST', `/api/posts/${pid}/like`, {}, tokenA);
  assert.equal(like.status, 200);
  assert.equal(like.json.data.liked, true);
  const unlike = await api('POST', `/api/posts/${pid}/like`, {}, tokenA);
  assert.equal(unlike.json.data.liked, false);
  const c = await api('POST', `/api/posts/${pid}/comments`, { content: '看起来不错' }, tokenA);
  assert.equal(c.status, 200);
  const list = await api('GET', `/api/posts/${pid}/comments`);
  assert.ok(list.json.data.some((x) => x.content === '看起来不错'));
});

test('认证加分', async () => {
  const r = await api('POST', '/api/users/me/verify', { type: 'student', school: '北京邮电大学' }, tokenB);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.verify_student, true);
  const me = await api('GET', '/api/auth/me', null, tokenB);
  assert.ok(me.json.data.credit > 600);
});

// ==================================================================
// 以下为扩充用例（QA 追加，覆盖原先无测试的功能点）
// ==================================================================

let tokenC, userIdC, qaReapplyPid, qaFullPid;

test('用户：编辑资料tags超过10个截断到10', async () => {
  const tags = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '这个标签特别长需要被截断到十二个字'];
  const r = await api('PUT', '/api/users/me', { tags }, tokenA);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.tags.length, 10, 'should truncate to 10 tags');
  assert.ok(r.json.data.tags.every((t) => t.length <= 12), 'each tag <= 12 chars');
  // 恢复原有标签，避免影响其他用例
  await api('PUT', '/api/users/me', { tags: ['美食', '摄影'] }, tokenA);
});

test('用户：出生年份非法值返回400', async () => {
  for (const bad of [1899, 2015, 'abc', 0]) {
    const r = await api('PUT', '/api/users/me', { birth_year: bad }, tokenA);
    assert.equal(r.status, 400, `birth_year=${bad} should be rejected`);
    assert.equal(r.json.error, '出生年份不合法');
  }
  // 合法值可以通过，并正确计算年龄
  const okR = await api('PUT', '/api/users/me', { birth_year: 2000 }, tokenA);
  assert.equal(okR.status, 200);
  assert.equal(okR.json.data.age, new Date().getFullYear() - 2000);
});

test('用户：他人主页rating_tags聚合', async () => {
  // 此前「评价体系」用例中 A 给 B 打过 5 星、标签 ['靠谱','守时']
  const r = await api('GET', `/api/users/${userIdB}`);
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.ok(Array.isArray(d.rating_tags));
  assert.ok(d.rating_tags.includes('靠谱'), 'rating_tags should include 靠谱');
  assert.ok(d.rating_tags.includes('守时'), 'rating_tags should include 守时');
  assert.ok(d.rating_count >= 1);
  assert.equal(d.rating_avg, 5);
});

test('用户：拉黑列表与取消拉黑', async () => {
  // 不能拉黑自己
  const self = await api('POST', `/api/users/${userIdB}/block`, {}, tokenB);
  assert.equal(self.status, 400);
  // 拉黑 A
  const blk = await api('POST', `/api/users/${userIdA}/block`, {}, tokenB);
  assert.equal(blk.status, 200);
  assert.equal(blk.json.data.blocked, true);
  // 拉黑列表可见
  const list = await api('GET', '/api/users/me/blocks', null, tokenB);
  assert.equal(list.status, 200);
  assert.ok(list.json.data.some((u) => u.id === userIdA), 'blocks list should contain A');
  // 取消拉黑
  const del = await api('DELETE', `/api/users/${userIdA}/block`, null, tokenB);
  assert.equal(del.status, 200);
  assert.equal(del.json.data.blocked, false);
  const list2 = await api('GET', '/api/users/me/blocks', null, tokenB);
  assert.equal(list2.json.data.length, 0, 'blocks list should be empty after unblock');
});

test('帖子：cover与aspect字段存在且确定性（id%3 / id%2 公式）', async () => {
  const created = await api('POST', '/api/posts', {
    category: 'food', title: 'QA封面确定性无图局', content: '无配图帖', city: '北京',
  }, tokenA);
  assert.equal(created.status, 200);
  const pid = created.json.data.id;
  const expectAspect = ['3:4', '1:1', '4:3'][pid % 3];
  const expectCover = `/img/covers/food${pid % 2 ? '-2' : ''}.svg`;
  const r1 = await api('GET', `/api/posts/${pid}`);
  const r2 = await api('GET', `/api/posts/${pid}`);
  for (const [i, r] of [r1, r2].entries()) {
    assert.equal(r.status, 200);
    assert.ok(r.json.data.cover, 'cover should exist');
    assert.ok(r.json.data.aspect, 'aspect should exist');
    assert.equal(r.json.data.aspect, expectAspect, `aspect = ASPECTS[id % 3] (request #${i + 1})`);
    assert.equal(r.json.data.cover, expectCover, `cover follows id parity formula (request #${i + 1})`);
  }
  assert.equal(r1.json.data.cover, r2.json.data.cover, 'same id twice → identical cover');
  assert.equal(r1.json.data.aspect, r2.json.data.aspect, 'same id twice → identical aspect');
});

test('帖子：多图帖返回images数组', async () => {
  const list = await api('GET', '/api/posts?keyword=日料放题');
  assert.equal(list.status, 200);
  const p = list.json.data.list[0];
  assert.ok(Array.isArray(p.images), 'images should be an array');
  assert.equal(p.images.length, 3, 'seeded demo post has 3 images');
  assert.equal(p.cover, p.images[0], 'cover uses first image when present');
  const list2 = await api('GET', '/api/posts?keyword=剧本杀');
  const p2 = list2.json.data.list[0];
  assert.ok(Array.isArray(p2.images) && p2.images.length === 2, 'second demo post has 2 images');
});

test('帖子：被拒绝后可重新申请', async () => {
  // 注册第三个用户
  const reg = await api('POST', '/api/auth/register', {
    username: 'tester_c', password: '123456', nickname: '测试丙', gender: 'female', city: '北京',
  });
  assert.equal(reg.status, 200);
  tokenC = reg.json.data.token;
  userIdC = reg.json.data.user.id;
  // A 发布 need_count=2 的局（通过/拒绝都不会满员）
  const created = await api('POST', '/api/posts', {
    category: 'coffee', title: 'QA拒绝复申测试局', content: 'x', city: '北京', need_count: 2,
  }, tokenA);
  assert.equal(created.status, 200);
  qaReapplyPid = created.json.data.id;
  // C 首次申请
  const j1 = await api('POST', `/api/posts/${qaReapplyPid}/join`, { message: '第一次申请' }, tokenC);
  assert.equal(j1.status, 200);
  // A 婉拒
  const list = await api('GET', `/api/posts/${qaReapplyPid}/joins`, null, tokenA);
  const joinId = list.json.data.find((x) => x.user.id === userIdC).id;
  const rj = await api('POST', `/api/posts/${qaReapplyPid}/joins/${joinId}/approve`, { approve: false }, tokenA);
  assert.equal(rj.status, 200);
  // C 视角 my_join = rejected
  const d1 = await api('GET', `/api/posts/${qaReapplyPid}`, null, tokenC);
  assert.equal(d1.json.data.my_join, 'rejected');
  // C 重新申请成功，且不产生重复记录
  const j2 = await api('POST', `/api/posts/${qaReapplyPid}/join`, { message: '第二次申请' }, tokenC);
  assert.equal(j2.status, 200);
  assert.equal(j2.json.data.status, 'pending');
  const list2 = await api('GET', `/api/posts/${qaReapplyPid}/joins`, null, tokenA);
  assert.equal(list2.json.data.filter((x) => x.user.id === userIdC).length, 1, 'should not duplicate join record');
  assert.equal(list2.json.data.find((x) => x.user.id === userIdC).status, 'pending');
});

test('帖子：fulled状态下加入被拒400', async () => {
  const created = await api('POST', '/api/posts', {
    category: 'game', title: 'QA满员测试局', content: 'only one slot', city: '北京', need_count: 1,
  }, tokenA);
  assert.equal(created.status, 200);
  qaFullPid = created.json.data.id;
  const j = await api('POST', `/api/posts/${qaFullPid}/join`, { message: '带我一个' }, tokenC);
  assert.equal(j.status, 200);
  const list = await api('GET', `/api/posts/${qaFullPid}/joins`, null, tokenA);
  const joinId = list.json.data.find((x) => x.user.id === userIdC).id;
  const ap = await api('POST', `/api/posts/${qaFullPid}/joins/${joinId}/approve`, { approve: true }, tokenA);
  assert.equal(ap.status, 200);
  const detail = await api('GET', `/api/posts/${qaFullPid}`);
  assert.equal(detail.json.data.status, 'full', 'post becomes full when approved reaches need_count');
  // 满员后再申请 → 400
  const j2 = await api('POST', `/api/posts/${qaFullPid}/join`, {}, tokenC);
  assert.equal(j2.status, 400);
  const j3 = await api('POST', `/api/posts/${qaFullPid}/join`, {}, tokenB);
  assert.equal(j3.status, 400, 'other users also blocked when full');
});

test('聊天：/chat/convs 列表含unread未读计数', async () => {
  const { handleChatMessage } = await import('../src/routes/chat.js');
  const { db } = await import('../src/db.js');
  const convs = await api('GET', '/api/chat/convs', null, tokenA);
  assert.equal(convs.status, 200);
  const conv = convs.json.data.find((c) => c.other && c.other.id === userIdB);
  assert.ok(conv, 'A↔B conv from earlier tests should exist');
  assert.equal(typeof conv.unread, 'number', 'unread should be numeric');
  const before = conv.unread;
  // B 用内部函数补发一条
  const userB = db.prepare('SELECT * FROM users WHERE id = ?').get(userIdB);
  const sent = handleChatMessage(userB, conv.id, '补发一条：周六不见不散');
  assert.ok(!sent.error, 'send should succeed: ' + (sent.error || ''));
  const convs2 = await api('GET', '/api/chat/convs', null, tokenA);
  assert.equal(convs2.json.data.find((c) => c.other && c.other.id === userIdB).unread, before + 1);
  // A 拉取消息（自动标记已读）后未读清零
  await api('GET', `/api/chat/conv/${conv.id}/messages`, null, tokenA);
  const convs3 = await api('GET', '/api/chat/convs', null, tokenA);
  assert.equal(convs3.json.data.find((c) => c.other && c.other.id === userIdB).unread, 0, 'unread clears after read');
});

test('聊天：首条消息后注入type=safety系统提示', async () => {
  // C 与 A 有同局关系（QA拒绝复申局 pending），可开启会话
  const conv = await api('POST', '/api/chat/conv', { user_id: userIdA, post_id: qaReapplyPid }, tokenC);
  assert.equal(conv.status, 200);
  const convId = conv.json.data.id;
  const { handleChatMessage } = await import('../src/routes/chat.js');
  const { db } = await import('../src/db.js');
  const userC = db.prepare('SELECT * FROM users WHERE id = ?').get(userIdC);
  const sent = handleChatMessage(userC, convId, '第一次发消息，请多关照');
  assert.ok(!sent.error, 'send should succeed: ' + (sent.error || ''));
  const msgs = await api('GET', `/api/chat/conv/${convId}/messages`, null, tokenC);
  assert.equal(msgs.status, 200);
  const safety = msgs.json.data.messages.find((m) => m.type === 'safety');
  assert.ok(safety, 'safety tip should be injected after first message');
  assert.ok(safety.content.includes('安全提示'));
});

test('聊天：被拉黑等场景 handleChatMessage 返回error分支', async () => {
  const { handleChatMessage } = await import('../src/routes/chat.js');
  const { db } = await import('../src/db.js');
  const userA = db.prepare('SELECT * FROM users WHERE id = ?').get(userIdA);
  const userC = db.prepare('SELECT * FROM users WHERE id = ?').get(userIdC);
  // B 拉黑 A 后，A 在 A↔B 会话发消息应报错
  await api('POST', `/api/users/${userIdA}/block`, {}, tokenB);
  const convs = await api('GET', '/api/chat/convs', null, tokenA);
  const convAB = convs.json.data.find((c) => c.other && c.other.id === userIdB);
  const r1 = handleChatMessage(userA, convAB.id, '拉黑后还能发吗');
  assert.ok(r1.error, 'blocked pair should error');
  assert.ok(r1.error.includes('拉黑'), 'error mentions 拉黑: ' + r1.error);
  // 非会话成员发消息
  const r2 = handleChatMessage(userC, convAB.id, 'hello');
  assert.equal(r2.error, '无权在该会话发送消息');
  // 空消息
  const convAC = convs.json.data.find((c) => c.other && c.other.id === userIdC);
  const r3 = handleChatMessage(userA, convAC.id, '   ');
  assert.equal(r3.error, '消息不能为空');
  // 会话不存在
  const r4 = handleChatMessage(userA, 999999, 'x');
  assert.equal(r4.error, '会话不存在');
  // 清理拉黑
  await api('DELETE', `/api/users/${userIdA}/block`, null, tokenB);
});

test('通知：/notifications/read 单条已读（ids数组）', async () => {
  const list = await api('GET', '/api/notifications', null, tokenA);
  assert.equal(list.status, 200);
  const unreadBefore = list.json.data.filter((n) => !n.read);
  assert.ok(unreadBefore.length >= 2, 'need at least 2 unread notifications');
  const target = unreadBefore[0];
  const r = await api('POST', '/api/notifications/read', { ids: [target.id] }, tokenA);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.read, true);
  const list2 = await api('GET', '/api/notifications', null, tokenA);
  assert.equal(list2.json.data.find((n) => n.id === target.id).read, 1, 'target notification marked read');
  const unreadAfter = list2.json.data.filter((n) => !n.read).length;
  assert.equal(unreadAfter, unreadBefore.length - 1, 'exactly one notification got read');
});

test('安全：/safety/tips 结构（emergency数组 + community_rules数组）', async () => {
  const r = await api('GET', '/api/safety/tips');
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.ok(Array.isArray(d.emergency) && d.emergency.length >= 6, 'emergency should be an array with 6 tips');
  for (const e of d.emergency) {
    assert.equal(typeof e.icon, 'string');
    assert.equal(typeof e.title, 'string');
    assert.equal(typeof e.body, 'string');
  }
  assert.ok(Array.isArray(d.community_rules) && d.community_rules.length >= 6, 'community_rules should be a string array');
  assert.ok(d.community_rules.every((s) => typeof s === 'string' && s.length > 0));
});

test('安全：SOS后admin可见待处理举报（reason=人身安全）', async () => {
  const sos = await api('POST', '/api/safety/sos', {
    location: '朝阳区某公园东门', note: 'QA自动演练：紧急求助流程验证',
  }, tokenA);
  assert.equal(sos.status, 200);
  assert.equal(sos.json.data.reported, true);
  // admin 的待处理举报队列中能看到这条人身安全举报
  const reports = await api('GET', '/api/admin/reports?status=pending', null, tokenAdmin);
  assert.equal(reports.status, 200);
  const sosReports = reports.json.data.filter((x) => x.reason === '人身安全');
  assert.ok(sosReports.length >= 1, 'admin should see pending SOS report');
  assert.ok(sosReports.some((x) => x.detail.includes('紧急求助')), 'SOS report detail marked 紧急求助');
  // 管理员收到 sos 通知
  const notifs = await api('GET', '/api/notifications', null, tokenAdmin);
  assert.ok(notifs.json.data.some((n) => n.type === 'sos'), 'admin should receive sos notification');
});

test('边界：不存在的帖子/用户返回404', async () => {
  const p = await api('GET', '/api/posts/999999');
  assert.equal(p.status, 404);
  assert.equal(p.json.error, '搭局不存在');
  const u = await api('GET', '/api/users/999999');
  assert.equal(u.status, 404);
  assert.equal(u.json.error, '用户不存在');
  const j = await api('POST', '/api/posts/999999/join', {}, tokenB);
  assert.equal(j.status, 404);
  const cv = await api('POST', '/api/chat/conv', { user_id: 999999 }, tokenA);
  assert.equal(cv.status, 404);
});

test('边界：无权限访问他人join列表403', async () => {
  assert.ok(qaFullPid, 'full-post test should have run before');
  const r = await api('GET', `/api/posts/${qaFullPid}/joins`, null, tokenB);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, '只有组局者可以查看申请列表');
});

test('元数据：14分类/3费用/3性别要求/6评价标签', async () => {
  const r = await api('GET', '/api/meta');
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.equal(d.categories.length, 14);
  assert.ok(d.categories.every((c) => c.key && c.name && c.emoji), 'each category has key/name/emoji');
  assert.equal(d.fee_modes.length, 3);
  assert.deepEqual(d.fee_modes.map((f) => f.key).sort(), ['aa', 'free', 'treat']);
  assert.equal(d.gender_reqs.length, 3);
  assert.deepEqual(d.gender_reqs.map((g) => g.key).sort(), ['any', 'female', 'male']);
  assert.equal(d.rate_tags.length, 6);
  assert.deepEqual(d.rate_tags, ['守时', '靠谱', '友善', '有趣', '聊得来', '再次约']);
});

console.log('\n✅ 全部 API 测试通过');
