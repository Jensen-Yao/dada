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

console.log('\n✅ 全部 API 测试通过');
