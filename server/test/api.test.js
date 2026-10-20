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
// S1 回归：强制走"文件密钥"路径（若外部环境恰好设置了 DADA_JWT_SECRET 则先摘掉，子进程同样继承不到）
delete process.env.DADA_JWT_SECRET;
// 记录密钥文件在本次测试启动前是否存在——决定是否断言"新生成密钥"的格式与权限
const JWT_FILE = path.join(ROOT, 'data', '.jwt-secret');
const jwtFileExistedAtStart = fs.existsSync(JWT_FILE);

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
  const r2 = handleChatMessage(userB, convId, '这次费用全包我来安排');
  assert.ok(!r2.error);
  // 软词（涉黄暗语等灰产信号）被替换为 *（R4 聊天升级：硬词改为直接拒收，见文末 R4 段）
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

test('帖子：cover与aspect字段存在且确定性（id%3 三级兜底公式）', async () => {
  const created = await api('POST', '/api/posts', {
    category: 'food', title: 'QA封面确定性无图局', content: '无配图帖', city: '北京',
  }, tokenA);
  assert.equal(created.status, 200);
  const pid = created.json.data.id;
  const expectAspect = ['3:4', '1:1', '4:3'][pid % 3];
  // PC-03 三级兜底：无配图 food 帖 → 分类实拍照 food-{(id%3)+1}.jpg（按 id 确定性取张）
  const expectCover = `/img/photos/food-${(pid % 3) + 1}.jpg`;
  const r1 = await api('GET', `/api/posts/${pid}`);
  const r2 = await api('GET', `/api/posts/${pid}`);
  for (const [i, r] of [r1, r2].entries()) {
    assert.equal(r.status, 200);
    assert.ok(r.json.data.cover, 'cover should exist');
    assert.ok(r.json.data.aspect, 'aspect should exist');
    assert.equal(r.json.data.aspect, expectAspect, `aspect = ASPECTS[id % 3] (request #${i + 1})`);
    assert.equal(r.json.data.cover, expectCover, `cover follows photo fallback formula (request #${i + 1})`);
  }
  assert.equal(r1.json.data.cover, r2.json.data.cover, 'same id twice → identical cover');
  assert.equal(r1.json.data.aspect, r2.json.data.aspect, 'same id twice → identical aspect');
  // 有配图的帖子 cover 命中 images[0]，不落照片层
  const seeded = await api('GET', '/api/posts?keyword=日料放题');
  assert.equal(seeded.json.data.list[0].cover, seeded.json.data.list[0].images[0], 'images[0] wins over photo fallback');
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
  // 私信门槛收紧（H3）：C 在 QA拒绝复申局 上是 pending，需组局者 A 先通过申请才能建会话
  const joins = await api('GET', `/api/posts/${qaReapplyPid}/joins`, null, tokenA);
  assert.equal(joins.status, 200);
  const joinC = joins.json.data.find((x) => x.user.id === userIdC && x.status === 'pending');
  assert.ok(joinC, 'C should have a pending join to approve');
  const ap = await api('POST', `/api/posts/${qaReapplyPid}/joins/${joinC.id}/approve`, { approve: true }, tokenA);
  assert.equal(ap.status, 200);
  // 通过后 C（已通过成员）可与组局者 A 开启会话
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
  assert.ok(d.categories.every((c) => c.key && c.name && c.icon), 'each category has key/name/icon');
  assert.equal(d.fee_modes.length, 3);
  assert.deepEqual(d.fee_modes.map((f) => f.key).sort(), ['aa', 'free', 'treat']);
  assert.equal(d.gender_reqs.length, 3);
  assert.deepEqual(d.gender_reqs.map((g) => g.key).sort(), ['any', 'female', 'male']);
  assert.equal(d.rate_tags.length, 6);
  assert.deepEqual(d.rate_tags, ['守时', '靠谱', '友善', '有趣', '聊得来', '再次约']);
});

// ==================================================================
// 评审 R1 修复回归（H3 私信门槛 / H2 拉黑落地 / H5 bio 200 / H9 conv非法id / H16 幂等 / H17 city 截断）
// ==================================================================

let tokenD, userIdD, tokenE, userIdE;

test('私信门槛：pending/无approved同局关系403，通过后放行', async () => {
  const regD = await api('POST', '/api/auth/register', { username: 'tester_d', password: '123456', nickname: '测试丁', gender: 'female', city: '北京' });
  assert.equal(regD.status, 200);
  tokenD = regD.json.data.token; userIdD = regD.json.data.user.id;
  const regE = await api('POST', '/api/auth/register', { username: 'tester_e', password: '123456', nickname: '测试戊', gender: 'male', city: '北京' });
  assert.equal(regE.status, 200);
  tokenE = regE.json.data.token; userIdE = regE.json.data.user.id;
  // A 发局，D、E 均为 pending 申请
  const created = await api('POST', '/api/posts', {
    category: 'study', title: '门槛回归测试局', content: 'x', city: '北京', need_count: 3,
  }, tokenA);
  assert.equal(created.status, 200);
  const pid = created.json.data.id;
  await api('POST', `/api/posts/${pid}/join`, {}, tokenD);
  await api('POST', `/api/posts/${pid}/join`, {}, tokenE);
  // pending 申请者 → 组局者：403，文案明确"申请通过后才能私信"
  const r1 = await api('POST', '/api/chat/conv', { user_id: userIdA, post_id: pid }, tokenD);
  assert.equal(r1.status, 403);
  assert.ok(r1.json.error.includes('申请通过后才能私信'), 'error copy should mention 申请通过后才能私信: ' + r1.json.error);
  // 组局者 → pending 申请者：403
  const r2 = await api('POST', '/api/chat/conv', { user_id: userIdD, post_id: pid }, tokenA);
  assert.equal(r2.status, 403);
  // 同帖两个 pending 陌生人互开私聊：403
  const r3 = await api('POST', '/api/chat/conv', { user_id: userIdE, post_id: pid }, tokenD);
  assert.equal(r3.status, 403);
  // 无任何关系的两个用户（不带 post_id）：403
  const r4 = await api('POST', '/api/chat/conv', { user_id: userIdB }, tokenE);
  assert.equal(r4.status, 403);
  // E 仍 pending → E→A 仍 403
  const r5 = await api('POST', '/api/chat/conv', { user_id: userIdA, post_id: pid }, tokenE);
  assert.equal(r5.status, 403);
  // A 通过 D 的申请后：D→A 放行
  const list = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  const joinD = list.json.data.find((x) => x.user.id === userIdD);
  const ap = await api('POST', `/api/posts/${pid}/joins/${joinD.id}/approve`, { approve: true }, tokenA);
  assert.equal(ap.status, 200);
  const r6 = await api('POST', '/api/chat/conv', { user_id: userIdA, post_id: pid }, tokenD);
  assert.equal(r6.status, 200);
  // A 再通过 E：两个已通过成员（D↔E）之间放行，且此前无预建会话
  const list2 = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  const joinE = list2.json.data.find((x) => x.user.id === userIdE);
  await api('POST', `/api/posts/${pid}/joins/${joinE.id}/approve`, { approve: true }, tokenA);
  const r7 = await api('POST', '/api/chat/conv', { user_id: userIdE }, tokenD);
  assert.equal(r7.status, 200);
});

test('拉黑落地：feed/评论/推荐过滤 + 点赞通知静默', async () => {
  // D 发一局、E 发一局；E 在 D 的局下留言
  const pD = await api('POST', '/api/posts', {
    category: 'food', title: '拉黑过滤回归局D', content: 'x', city: '北京',
  }, tokenD);
  const pidD = pD.json.data.id;
  const pE = await api('POST', '/api/posts', {
    category: 'food', title: '拉黑过滤回归局E', content: 'x', city: '北京',
  }, tokenE);
  const pidE = pE.json.data.id;
  const cm = await api('POST', `/api/posts/${pidD}/comments`, { content: '拉黑前E的评论' }, tokenE);
  assert.equal(cm.status, 200);
  // D 拉黑 E
  const blk = await api('POST', `/api/users/${userIdE}/block`, {}, tokenD);
  assert.equal(blk.status, 200);
  // ① D 登录视角 feed 不再出现 E 的帖；游客视角不受影响
  const feedD = await api('GET', '/api/posts?keyword=拉黑过滤回归局E', null, tokenD);
  assert.equal(feedD.json.data.list.length, 0, 'blocked author post filtered for logged-in viewer');
  const feedGuest = await api('GET', '/api/posts?keyword=拉黑过滤回归局E');
  assert.equal(feedGuest.json.data.list.length, 1, 'guest view not filtered');
  // ② 评论列表：D 视角过滤 E 的评论，游客可见
  const cmD = await api('GET', `/api/posts/${pidD}/comments`, null, tokenD);
  assert.equal(cmD.json.data.some((x) => x.user.id === userIdE), false, 'blocked user comment hidden');
  const cmGuest = await api('GET', `/api/posts/${pidD}/comments`);
  assert.equal(cmGuest.json.data.some((x) => x.user.id === userIdE), true, 'guest still sees comment');
  // ③ 推荐接口同样过滤（D 视角无 E 的帖）
  const rec = await api('GET', '/api/recommend?city=北京', null, tokenD);
  assert.equal(rec.json.data.list.some((p) => p.author.id === userIdE), false, 'recommend filters blocked author');
  // ④（R1动作级拦截）E 给 D 的帖点赞 → 直接 403，D 自然不会收到点赞通知
  const like = await api('POST', `/api/posts/${pidD}/like`, {}, tokenE);
  assert.equal(like.status, 403, 'blocked pair like should be rejected at action level');
  assert.equal(like.json.error, '无法与该用户互动');
  const notifs = await api('GET', '/api/notifications', null, tokenD);
  assert.equal(
    notifs.json.data.some((n) => n.type === 'like' && n.body.includes('测试戊')),
    false, 'like notification should be skipped when blocked'
  );
  // 清理拉黑，避免影响其他用例
  await api('DELETE', `/api/users/${userIdE}/block`, null, tokenD);
});

test('边界回归：200字bio读回200 / register city截断60 / /conv/abc 404', async () => {
  // H5：bio 200 字保存后读回长度 200（不再静默截断到 60）
  const bio = '标'.repeat(200);
  const edit = await api('PUT', '/api/users/me', { bio }, tokenA);
  assert.equal(edit.status, 200);
  assert.equal(edit.json.data.bio.length, 200, '200-char bio should persist in full');
  const profile = await api('GET', `/api/users/${userIdA}`);
  assert.equal(profile.json.data.bio.length, 200, 'bio read back from profile is 200 chars');
  // H17：注册 city 超长截断到 60（与 PUT /users/me 对齐）
  const reg = await api('POST', '/api/auth/register', {
    username: 'citylong01', password: '123456', nickname: '城市超长', city: '超'.repeat(1000),
  });
  assert.equal(reg.status, 200);
  assert.equal(reg.json.data.user.city.length, 60, 'register city truncated to 60');
  // H9：/conv/abc（parseInt=NaN）统一返回 404"会话不存在"，而非 500
  const badConv = await api('GET', '/api/chat/conv/abc/messages', null, tokenA);
  assert.equal(badConv.status, 404);
  assert.equal(badConv.json.error, '会话不存在');
});

test('发布幂等：同用户短窗口同标题同内容重复提交只落一帖', async () => {
  const payload = { category: 'coffee', title: '幂等回归局', content: '同一内容网络重试', city: '北京' };
  const r1 = await api('POST', '/api/posts', payload, tokenD);
  assert.equal(r1.status, 200);
  const r2 = await api('POST', '/api/posts', payload, tokenD);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.data.id, r1.json.data.id, 'duplicate submit returns the original post');
  const list = await api('GET', '/api/posts?keyword=幂等回归局');
  assert.equal(list.json.data.list.length, 1, 'only one post persisted');
  // 不同用户发同标题不受幂等护栏影响
  const r3 = await api('POST', '/api/posts', payload, tokenE);
  assert.equal(r3.status, 200);
  assert.notEqual(r3.json.data.id, r1.json.data.id, 'same title from another user creates a new post');
});

// ==================================================================
// 本轮迭代：拉黑动作级拦截（R1延期项）/ blocked_by_me 字段 / feed has_more
// ==================================================================

test('拉黑动作级拦截：先拉黑再点赞/评论/申请均403（双向）', async () => {
  // D 发一局
  const created = await api('POST', '/api/posts', {
    category: 'food', title: 'R1拦截测试局', content: 'x', city: '北京', need_count: 2,
  }, tokenD);
  assert.equal(created.status, 200);
  const pid = created.json.data.id;
  // 正向：E 拉黑 D 后，E 对 D 的帖 点赞/评论/申请 全部 403
  const blk = await api('POST', `/api/users/${userIdD}/block`, {}, tokenE);
  assert.equal(blk.status, 200);
  const like = await api('POST', `/api/posts/${pid}/like`, {}, tokenE);
  assert.equal(like.status, 403, 'like after block should be 403');
  assert.equal(like.json.error, '无法与该用户互动');
  const cm = await api('POST', `/api/posts/${pid}/comments`, { content: '拉黑后还想评论' }, tokenE);
  assert.equal(cm.status, 403, 'comment after block should be 403');
  assert.equal(cm.json.error, '无法与该用户互动');
  const jn = await api('POST', `/api/posts/${pid}/join`, { message: '拉黑后还想申请' }, tokenE);
  assert.equal(jn.status, 403, 'join after block should be 403');
  assert.equal(jn.json.error, '无法与该用户互动');
  // 未产生点赞/评论/申请副作用
  const detail = await api('GET', `/api/posts/${pid}`, null, tokenE);
  assert.equal(detail.json.data.likes_count, 0, 'no like persisted');
  assert.equal(detail.json.data.comments_count, 0, 'no comment persisted');
  assert.equal(detail.json.data.my_join, null, 'no join record persisted');
  const cms = await api('GET', `/api/posts/${pid}/comments`);
  assert.equal(cms.json.data.some((x) => x.content === '拉黑后还想评论'), false, 'no comment persisted');
  await api('DELETE', `/api/users/${userIdD}/block`, null, tokenE);
  // 反向：D 拉黑 E 后，E 对 D 的帖点赞同样 403（anyBlocked 双向任一）
  await api('POST', `/api/users/${userIdE}/block`, {}, tokenD);
  const like2 = await api('POST', `/api/posts/${pid}/like`, {}, tokenE);
  assert.equal(like2.status, 403, 'reverse-direction block also rejects like');
  assert.equal(like2.json.error, '无法与该用户互动');
  // 解除拉黑后点赞恢复正常
  await api('DELETE', `/api/users/${userIdE}/block`, null, tokenD);
  const like3 = await api('POST', `/api/posts/${pid}/like`, {}, tokenE);
  assert.equal(like3.status, 200, 'like succeeds after unblock');
  assert.equal(like3.json.data.liked, true);
});

test('拉黑关系字段：postView 与用户主页 blocked_by_me 拉黑前后 true/false', async () => {
  const mine = await api('GET', '/api/my/posts/published', null, tokenD);
  const pid = mine.json.data.find((p) => p.title === 'R1拦截测试局').id;
  // 拉黑前：登录视角 false；游客恒 false
  const before = await api('GET', `/api/posts/${pid}`, null, tokenE);
  assert.equal(before.status, 200);
  assert.equal(before.json.data.blocked_by_me, false, 'blocked_by_me=false before block (logged-in)');
  const guest = await api('GET', `/api/posts/${pid}`);
  assert.equal(guest.json.data.blocked_by_me, false, 'guest always false');
  // 用户主页拉黑前 false
  const ub = await api('GET', `/api/users/${userIdD}`, null, tokenE);
  assert.equal(ub.json.data.blocked_by_me, false, 'user profile blocked_by_me=false before block');
  // 拉黑后：帖子详情（直链）与用户主页均 true
  await api('POST', `/api/users/${userIdD}/block`, {}, tokenE);
  const after = await api('GET', `/api/posts/${pid}`, null, tokenE);
  assert.equal(after.json.data.blocked_by_me, true, 'blocked_by_me=true after block (post detail)');
  const ua = await api('GET', `/api/users/${userIdD}`, null, tokenE);
  assert.equal(ua.json.data.blocked_by_me, true, 'user profile blocked_by_me=true after block');
  // 游客依旧 false；他人视角（D 自己看自己的帖）false
  const guest2 = await api('GET', `/api/posts/${pid}`);
  assert.equal(guest2.json.data.blocked_by_me, false, 'guest still false after block');
  const self = await api('GET', `/api/posts/${pid}`, null, tokenD);
  assert.equal(self.json.data.blocked_by_me, false, 'author viewing own post is false');
  // 清理
  await api('DELETE', `/api/users/${userIdD}/block`, null, tokenE);
});

test('feed分页：has_more 元信息（size=5 时 true，且与 total 关系一致）', async () => {
  const r = await api('GET', '/api/posts?size=5');
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.equal(typeof d.has_more, 'boolean', 'has_more must be boolean');
  assert.equal(d.list.length, 5);
  assert.ok(d.total > 5, 'seeded feed has more than 5 posts');
  assert.equal(d.has_more, true, 'has_more=true when size=5');
  assert.equal(d.has_more, 0 + d.list.length < d.total, 'has_more consistent with offset+len<total');
  // 翻到足够靠后的页（每页5条，取一个必然超出 total 的页码）→ false；中间页与公式一致
  const lastPage = Math.ceil(d.total / 5) + 2;
  const r2 = await api('GET', `/api/posts?size=5&page=${lastPage}`);
  assert.equal(r2.json.data.has_more, false, 'has_more=false when past the end');
  const mid = await api('GET', '/api/posts?size=5&page=2');
  assert.equal(mid.json.data.has_more, 5 + mid.json.data.list.length < mid.json.data.total, 'page=2 has_more follows formula');
});

// ==================================================================
// 合规专项（docs/compliance-research-2026.md）：手机号注册（网安法24条）/
// 注销账号（PIPL 47条 + Apple 5.1.1(v)）/ 个性化推荐开关（算法推荐规定17条）/
// 静态法律页（Apple 5.1.1(i)）/ 敏感词补充
// ==================================================================

const PHONE_A = '13800001111'; // 注册全流程
const PHONE_B = '13900002222'; // 注销流程
let tokenPhoneA, userIdPhoneA, tokenPhoneB, userIdPhoneB, phoneBPid, phoneACode;

test('合规-短信：手机号格式校验 + demo_code 下发 + 60秒重发限制', async () => {
  // 非法格式
  for (const bad of ['12345', '23800001111', '1380000111', '']) {
    const r = await api('POST', '/api/auth/sms/send', { phone: bad });
    assert.equal(r.status, 400, `phone=${bad} should be rejected`);
    assert.equal(r.json.error, '手机号格式不正确');
  }
  // 合法号码：演示环境直接带回 demo_code（6 位数字）
  const r = await api('POST', '/api/auth/sms/send', { phone: PHONE_A });
  assert.equal(r.status, 200);
  assert.match(r.json.data.demo_code, /^\d{6}$/, 'demo_code should be 6 digits');
  assert.equal(r.json.data.sent, true);
  phoneACode = r.json.data.demo_code;
  // 60 秒内重发被拒
  const r2 = await api('POST', '/api/auth/sms/send', { phone: PHONE_A });
  assert.equal(r2.status, 429);
});

test('合规-注册：手机号+验证码全流程（错误码400 / 未成年400 / 成功 / 手机号登录）', async () => {
  // 沿用上一用例下发的验证码（未成功消费前保持有效，且受 60 秒重发限制不再重发）
  const code = phoneACode;
  assert.ok(code, 'should have a valid demo_code');
  // 错误验证码 → 400
  const badCode = await api('POST', '/api/auth/register', {
    phone: PHONE_A, code: '000000', password: '123456', adult_confirmed: true,
  });
  assert.equal(badCode.status, 400);
  assert.equal(badCode.json.error, '验证码错误或已过期');
  // 未确认年满 18 岁 → 400
  const minor = await api('POST', '/api/auth/register', {
    phone: PHONE_A, code, password: '123456', adult_confirmed: false,
  });
  assert.equal(minor.status, 400);
  assert.equal(minor.json.error, '需确认已满18岁');
  // 成功注册：username 自动生成 dadu_<手机号后8位>
  const reg = await api('POST', '/api/auth/register', {
    phone: PHONE_A, code, password: '123456', nickname: '手机注册用户', adult_confirmed: true,
  });
  assert.equal(reg.status, 200, 'register should succeed: ' + JSON.stringify(reg.json));
  assert.ok(reg.json.data.token);
  assert.ok(reg.json.data.user.username.startsWith('dadu_'), 'auto username starts with dadu_');
  assert.equal(reg.json.data.user.username, `dadu_${PHONE_A.slice(-8)}`);
  tokenPhoneA = reg.json.data.token;
  userIdPhoneA = reg.json.data.user.id;
  // 验证码一次性：用同一验证码再注册 → 400
  const replay = await api('POST', '/api/auth/register', {
    phone: PHONE_A, code, password: '123456', adult_confirmed: true,
  });
  assert.equal(replay.status, 400);
  // 已注册手机号再发短信 → 409
  const again = await api('POST', '/api/auth/sms/send', { phone: PHONE_A });
  assert.equal(again.status, 409);
  assert.equal(again.json.error, '该手机号已注册');
  // 手机号+密码登录
  const login = await api('POST', '/api/auth/login', { phone: PHONE_A, password: '123456' });
  assert.equal(login.status, 200);
  assert.ok(login.json.data.token);
  const badLogin = await api('POST', '/api/auth/login', { phone: PHONE_A, password: 'wrong' });
  assert.equal(badLogin.status, 401);
  assert.equal(badLogin.json.error, '手机号或密码错误');
});

test('合规-注销：confirm错值400 → DELETE成功 → 登录/旧token 401 → 资料清空 → 帖子保留', async () => {
  // 先注册一个专用账号并发一帖
  const sms = await api('POST', '/api/auth/sms/send', { phone: PHONE_B });
  assert.equal(sms.status, 200);
  const reg = await api('POST', '/api/auth/register', {
    phone: PHONE_B, code: sms.json.data.demo_code, password: '123456',
    nickname: '待注销用户', adult_confirmed: true,
  });
  assert.equal(reg.status, 200);
  tokenPhoneB = reg.json.data.token;
  userIdPhoneB = reg.json.data.user.id;
  // 补充资料，注销后验证清空
  const edit = await api('PUT', '/api/users/me', {
    bio: '马上注销了', school: '某某大学', occupation: '测试员', mbti: 'INTJ', tags: ['测试'],
  }, tokenPhoneB);
  assert.equal(edit.status, 200);
  const post = await api('POST', '/api/posts', {
    category: 'food', title: '注销用户的历史搭局', content: '注销后此帖保留', city: '北京',
  }, tokenPhoneB);
  assert.equal(post.status, 200);
  phoneBPid = post.json.data.id;
  // confirm 错值 → 400
  const wrong1 = await api('POST', '/api/users/me/delete', { confirm: 'delete' }, tokenPhoneB);
  assert.equal(wrong1.status, 400);
  const wrong2 = await api('POST', '/api/users/me/delete', { confirm: true }, tokenPhoneB);
  assert.equal(wrong2.status, 400);
  // confirm === 'DELETE' → 成功
  const del = await api('POST', '/api/users/me/delete', { confirm: 'DELETE' }, tokenPhoneB);
  assert.equal(del.status, 200);
  assert.equal(del.json.data.deleted, true);
  // 手机号已置空：登录改用保留的用户名（dadu_<后8位>）→ 401 账号已注销
  const login = await api('POST', '/api/auth/login', { username: `dadu_${PHONE_B.slice(-8)}`, password: '123456' });
  assert.equal(login.status, 401);
  assert.equal(login.json.error, '账号已注销');
  // 旧 token 访问 /auth/me 与受保护接口 → 401 账号已注销
  const me = await api('GET', '/api/auth/me', null, tokenPhoneB);
  assert.equal(me.status, 401);
  assert.equal(me.json.error, '账号已注销');
  const edit2 = await api('PUT', '/api/users/me', { bio: 'x' }, tokenPhoneB);
  assert.equal(edit2.status, 401);
  assert.equal(edit2.json.error, '账号已注销');
  // 资料已清空：主页显示"已注销用户"，敏感字段全空
  const profile = await api('GET', `/api/users/${userIdPhoneB}`);
  assert.equal(profile.status, 200);
  const d = profile.json.data;
  assert.equal(d.nickname, '已注销用户');
  assert.equal(d.bio, '');
  assert.equal(d.school, '');
  assert.equal(d.occupation, '');
  assert.equal(d.mbti, '');
  assert.deepEqual(d.tags, []);
  assert.equal(d.avatar, null);
  // 帖子保留（历史搭局完整性），作者显示已注销
  const detail = await api('GET', `/api/posts/${phoneBPid}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.title, '注销用户的历史搭局');
  assert.equal(detail.json.data.author.nickname, '已注销用户');
  // 手机号释放复用：重新发码注册不再 409
  const reSms = await api('POST', '/api/auth/sms/send', { phone: PHONE_B });
  assert.equal(reSms.status, 200, 'deleted phone should be reusable');
  const reReg = await api('POST', '/api/auth/register', {
    phone: PHONE_B, code: reSms.json.data.demo_code, password: '654321',
    nickname: '复用该号码的新用户', adult_confirmed: true,
  });
  assert.equal(reReg.status, 200);
});

test('合规-推荐开关：rec_off=1 后 for-you 返回空（/recommend 不受影响）', async () => {
  // B 有关注分类（参加过火锅局），for-you 正常应有内容
  const before = await api('GET', '/api/for-you', null, tokenB);
  assert.equal(before.status, 200);
  assert.ok(before.json.data.list.length > 0, 'for-you should have items before rec_off');
  assert.notEqual(before.json.data.rec_off, true);
  // 非法值 → 400
  const bad = await api('PUT', '/api/users/me', { rec_off: 2 }, tokenB);
  assert.equal(bad.status, 400);
  // 关闭个性化推荐：立即生效
  const off = await api('PUT', '/api/users/me', { rec_off: 1 }, tokenB);
  assert.equal(off.status, 200);
  assert.equal(off.json.data.rec_off, true);
  const fy = await api('GET', '/api/for-you', null, tokenB);
  assert.equal(fy.status, 200);
  assert.deepEqual(fy.json.data.list, [], 'for-you must be empty when rec_off=1');
  assert.equal(fy.json.data.rec_off, true, 'response carries rec_off flag for frontend fallback');
  // 热门排序的非个性化 /recommend 不受影响
  const rec = await api('GET', '/api/recommend?city=北京', null, tokenB);
  assert.equal(rec.status, 200);
  assert.ok(rec.json.data.list.length > 0, 'recommend (hot ranking) unaffected by rec_off');
  // 重新打开恢复正常（清理，避免影响其他用例）
  const on = await api('PUT', '/api/users/me', { rec_off: 0 }, tokenB);
  assert.equal(on.status, 200);
  assert.equal(on.json.data.rec_off, false);
  const fy2 = await api('GET', '/api/for-you', null, tokenB);
  assert.equal(fy2.status, 200);
  assert.notEqual(fy2.json.data.rec_off, true);
});

test('合规-敏感词：搭子赛道涉黄暗语拦截（纯绿/线下有偿等）', async () => {
  const r1 = await api('POST', '/api/posts', {
    category: 'travel', title: '周末徒步找纯绿搭子', content: 'x', city: '北京',
  }, tokenA);
  assert.equal(r1.status, 400);
  const r2 = await api('POST', '/api/posts', {
    category: 'coffee', title: '咖啡局正常标题', content: '线下有偿可聊', city: '北京',
  }, tokenA);
  assert.equal(r2.status, 400);
});

test('合规-静态法律页：/legal/privacy 与 /legal/terms 服务端直出 200', async () => {
  // extensions: ['html'] → /legal/privacy 命中 /legal/privacy.html 静态文件（Apple 5.1.1(i) 可抓取 URL）
  const r1 = await fetch(`${BASE}/legal/privacy`);
  assert.equal(r1.status, 200);
  const html1 = await r1.text();
  assert.ok(html1.includes('隐私政策'), 'privacy page has title');
  assert.ok(html1.includes('返回App'), 'back-to-app link present');
  assert.ok(html1.includes('注销'), 'privacy page mentions account deletion');
  // 完整路径同样命中
  const r2 = await fetch(`${BASE}/legal/privacy.html`);
  assert.equal(r2.status, 200);
  assert.ok((await r2.text()).includes('隐私政策'));
  const r3 = await fetch(`${BASE}/legal/terms`);
  assert.equal(r3.status, 200);
  const html3 = await r3.text();
  assert.ok(html3.includes('用户服务协议'), 'terms page has title');
  assert.ok(html3.includes('返回App'));
});

// ==================================================================
// v2.9 匹配算法升级（MT-01/02/05）：确定性多维评分 / for-you 接入 / 冷启动
// ==================================================================

test('MT-05-1 mbtiScore锚点 + WEIGHTS权重守恒', async () => {
  const { mbtiScore, WEIGHTS } = await import('../src/match.js');
  // H.1 矩阵锚点（验收清单 MT 抽查项）
  assert.equal(mbtiScore('INTJ', 'ENFP'), 1.0, 'INTJ×ENFP 四维全优 = 1.0');
  assert.equal(mbtiScore('INTJ', 'INTP'), 0.8, 'INTJ×INTP（E/I、T/F 同类）= 0.8');
  assert.equal(mbtiScore('INTJ', 'ISTJ'), 0.55, 'INTJ×ISTJ（N/S 错配 + 三维同类）= 0.55');
  // 任一方为空 → 该维度剔除（mbtiScore 返回 null，不参与评分）
  assert.equal(mbtiScore('INTJ', ''), null, 'empty author mbti → null');
  assert.equal(mbtiScore('', 'ENFP'), null, 'empty my mbti → null');
  // 权重守恒：Σw = 100（30+15+20+20+10+5）
  assert.deepEqual(WEIGHTS, { tags: 30, mbti: 15, city: 20, category: 20, credit: 10, active: 5 });
  assert.equal(Object.values(WEIGHTS).reduce((s, w) => s + w, 0), 100);
});

test('MT-05-2 matchScore确定性与Jaccard手工算例', async () => {
  const { matchScore } = await import('../src/match.js');
  const input = {
    myTags: ['a', 'b'], authorTags: ['b', 'c'],                        // Jaccard = |{b}|/|{a,b,c}| = 1/3
    myMbti: 'INTJ', authorMbti: 'ENFP',                                // 1.0
    myCity: '北京', postCity: '北京',                                    // 同城 = 1
    myCatHistory: ['food', 'food', 'sports'], postCategory: 'food',    // 分类占比 = 2/3
    authorCredit: 600,                                                 // (600-300)/500 = 0.6
    authorActive: true,                                                // 1
  };
  // 手工：Σ = 30×(1/3) + 15×1 + 20×1 + 20×(2/3) + 10×0.6 + 5×1 = 69.33… → round → 69
  assert.equal(matchScore(input), 69, 'hand-computed weighted score');
  // 确定性：同输入两次调用逐位相等
  assert.equal(matchScore(input), matchScore({ ...input }));
  // Jaccard 单点验证：{a,b}×{b,c} = 1/3（其余维度剔除，credit=300→0、active=false→0）
  // 仅剩 tags+credit+active：30×(1/3)/45 = 22.22… → 22
  assert.equal(
    matchScore({ myTags: ['a', 'b'], authorTags: ['b', 'c'], authorCredit: 300, authorActive: false }),
    22
  );
  // 输入完全缺失 → 全维度剔除 → null
  assert.equal(matchScore({}), null);
});

test('MT-05-3 空值剔除：只有credit+active时按这两项加权归一', async () => {
  const { matchScore, WEIGHTS } = await import('../src/match.js');
  const r = matchScore({
    myTags: [], authorTags: [], myMbti: '', authorMbti: '',
    myCity: '', postCity: '', myCatHistory: [], postCategory: 'food',
    authorCredit: 600, authorActive: true,
  });
  // (10×0.6 + 5×1) / (10+5) = 11/15 = 0.7333… → 73（空值分摊：其余维度权重从分母消失）
  const expect = Math.round(100 * (WEIGHTS.credit * 0.6 + WEIGHTS.active * 1) / (WEIGHTS.credit + WEIGHTS.active));
  assert.equal(r, expect, 'score = weighted normalization over credit+active only');
  assert.equal(r, 73);
});

test('MT-05-4 /for-you 登录用户返回match_score与match_reasons', async () => {
  // 构造：注册用户设 tags 含「美食」「电影」、同城北京、mbti=ENFJ
  // → xiaoyu（北京 / tags 含美食电影 / INFP）的日料帖应命中 共同兴趣 + 同城 + MBTI互补
  const reg = await api('POST', '/api/auth/register', {
    username: 'matcher_fy', password: '123456', nickname: '匹配测', gender: 'female',
  });
  assert.equal(reg.status, 200);
  const t = reg.json.data.token;
  const edit = await api('PUT', '/api/users/me', { tags: ['美食', '电影'], city: '北京', mbti: 'ENFJ' }, t);
  assert.equal(edit.status, 200);

  const fy = await api('GET', '/api/for-you', null, t);
  assert.equal(fy.status, 200);
  assert.equal(fy.json.data.cold_start, false, 'personalized user is not cold start');
  assert.deepEqual(fy.json.data.my_tags, ['美食', '电影']);
  assert.equal(fy.json.data.my_city, '北京');
  assert.ok(fy.json.data.list.length > 0, 'for-you should have items');
  for (const p of fy.json.data.list) {
    assert.ok(Number.isInteger(p.match_score) && p.match_score >= 0 && p.match_score <= 100, 'match_score is int 0-100');
    assert.ok(Array.isArray(p.match_reasons) && p.match_reasons.length <= 3, 'match_reasons is array of at most 3');
  }
  // 排序：match_score 降序，同分 id 降序
  const list = fy.json.data.list;
  for (let i = 1; i < list.length; i++) {
    const [a, b] = [list[i - 1], list[i]];
    assert.ok(a.match_score > b.match_score || (a.match_score === b.match_score && a.id > b.id),
      'sorted by match_score desc then id desc');
  }
  // 确定性：同用户连调两次，全量评分与理由逐帖一致
  const fy2 = await api('GET', '/api/for-you', null, t);
  assert.deepEqual(fy2.json.data.list, fy.json.data.list, 'same user twice → identical scores & reasons');
  // 命中种子帖「周六中午五道口吃日料放题」（xiaoyu·北京·food·tags含美食电影）
  const foodPost = list.find((p) => p.title.includes('日料放题'));
  assert.ok(foodPost, 'seeded xiaoyu food post should appear in top 20');
  assert.ok(foodPost.match_reasons.includes('2个共同兴趣'), 'reasons: ' + JSON.stringify(foodPost.match_reasons));
  assert.ok(foodPost.match_reasons.includes('同城·北京'), 'reasons: ' + JSON.stringify(foodPost.match_reasons));
  assert.ok(foodPost.match_reasons.includes('MBTI互补'), 'ENFJ×INFP=0.9 → MBTI互补');
});

test('MT-05-5 冷启动：cold_start=true无match_score；补标签后恢复；rec_off回归', async () => {
  // 新注册：无标签 / 无城市 / 无MBTI / 无历史 → 冷启动，热门序，不出评分
  const reg = await api('POST', '/api/auth/register', {
    username: 'cold_fresh', password: '123456', nickname: '冷启动', gender: 'male',
  });
  assert.equal(reg.status, 200);
  const t = reg.json.data.token;
  const fy = await api('GET', '/api/for-you', null, t);
  assert.equal(fy.status, 200);
  assert.equal(fy.json.data.cold_start, true, 'fresh user without tags/city/mbti/history → cold_start');
  assert.ok(fy.json.data.list.length > 0, 'cold start still returns hot list');
  for (const p of fy.json.data.list) {
    assert.equal('match_score' in p, false, 'cold-start items carry no match_score');
    assert.equal('match_reasons' in p, false, 'cold-start items carry no match_reasons');
  }
  // 热门序与 /recommend 完全一致（likes + comments×2 降序，同分 id 降序）
  const rec = await api('GET', '/api/recommend', null, t);
  assert.equal(rec.status, 200);
  assert.deepEqual(
    fy.json.data.list.map((p) => p.id),
    rec.json.data.list.map((p) => p.id),
    'cold-start list ids == hot ranking ids'
  );
  // 补标签后冷启动消失，恢复出个性化评分
  const edit = await api('PUT', '/api/users/me', { tags: ['美食'] }, t);
  assert.equal(edit.status, 200);
  const fy2 = await api('GET', '/api/for-you', null, t);
  assert.equal(fy2.json.data.cold_start, false, 'cold_start disappears after setting tags');
  assert.ok(fy2.json.data.list.length > 0);
  assert.ok(fy2.json.data.list.every((p) => Number.isInteger(p.match_score)), 'scored items all carry integer match_score');
  // rec_off=1 行为不回退：空列表 + rec_off 标记
  await api('PUT', '/api/users/me', { rec_off: 1 }, t);
  const fy3 = await api('GET', '/api/for-you', null, t);
  assert.deepEqual(fy3.json.data.list, [], 'rec_off → empty list');
  assert.equal(fy3.json.data.rec_off, true, 'rec_off flag for frontend fallback');
});

// ==================================================================
// v3.0 多维洞察（BE-1/2/3/4/6）：埋点落库 / 漏斗 / partners / 老搭子加分 /
// read_at + context + peer_read / 定时任务
// ==================================================================

let tokenF, userIdF; // 本轮隔离用户 F（事件全链路）

test('VD-01 埋点落库：register/publish/post_view/join/approve/done/rate 全部进 events', async () => {
  const { db } = await import('../src/db.js');
  const cnt = (type, postId) => db.prepare('SELECT COUNT(*) c FROM events WHERE type = ? AND post_id = ?').get(type, postId).c;
  // register
  const reg = await api('POST', '/api/auth/register', { username: 'vd_event_u', password: '123456', nickname: '事件用户', city: '北京' });
  assert.equal(reg.status, 200);
  tokenF = reg.json.data.token;
  userIdF = reg.json.data.user.id;
  assert.ok(db.prepare("SELECT COUNT(*) c FROM events WHERE type = 'register' AND user_id = ?").get(userIdF).c >= 1, 'register 事件落库');
  // publish
  const pub = await api('POST', '/api/posts', { category: 'sports', title: 'VD埋点追踪羽毛球局', content: 'x', city: '北京', need_count: 2 }, tokenF);
  assert.equal(pub.status, 200);
  const pid = pub.json.data.id;
  assert.equal(cnt('publish', pid), 1, 'publish 事件落库');
  // 游客浏览详情 → post_view 落库且 user_id 为 NULL
  const view = await api('GET', `/api/posts/${pid}`);
  assert.equal(view.status, 200);
  const ev = db.prepare("SELECT * FROM events WHERE type = 'post_view' AND post_id = ?").get(pid);
  assert.ok(ev, 'post_view 事件落库');
  assert.equal(ev.user_id, null, '游客浏览 user_id 为 NULL');
  // 登录浏览 → post_view 带 user_id
  await api('GET', `/api/posts/${pid}`, null, tokenB);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM events WHERE type = 'post_view' AND post_id = ? AND user_id = ?").get(pid, userIdB).c >= 1, '登录浏览 user_id 正确');
  // join / approve / done / rate
  await api('POST', `/api/posts/${pid}/join`, { message: '带上我' }, tokenB);
  assert.equal(cnt('join', pid), 1, 'join 事件落库');
  const joins = await api('GET', `/api/posts/${pid}/joins`, null, tokenF);
  const joinId = joins.json.data[0].id;
  await api('POST', `/api/posts/${pid}/joins/${joinId}/approve`, { approve: true }, tokenF);
  assert.equal(cnt('approve', pid), 1, 'approve 事件落库');
  await api('PUT', `/api/posts/${pid}`, { status: 'done' }, tokenF);
  assert.equal(cnt('done', pid), 1, 'done 事件落库');
  await api('POST', `/api/posts/${pid}/rate`, { ratee_id: userIdB, stars: 5 }, tokenF);
  assert.equal(cnt('rate', pid), 1, 'rate 事件落库');
});

test('VD-01 admin/funnel：固定七级顺序 + 全级计数 + 日活近似 + 非管理员403', async () => {
  const r = await api('GET', '/api/admin/funnel?days=30', null, tokenAdmin);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.data.days, 30);
  assert.deepEqual(
    r.json.data.funnel.map((f) => f.type),
    ['register', 'post_view', 'publish', 'join', 'approve', 'done', 'rate'],
    '漏斗固定顺序：register→post_view→publish→join→approve→done→rate'
  );
  for (const f of r.json.data.funnel) {
    assert.equal(typeof f.count, 'number');
    assert.ok(f.count >= 1, `funnel[${f.type}] count>=1（本轮流程已触发各级），got ${f.count}`);
  }
  assert.ok(Array.isArray(r.json.data.daily_active) && r.json.data.daily_active.length >= 1, 'daily_active 存在');
  for (const d of r.json.data.daily_active) {
    assert.equal(typeof d.date, 'string');
    assert.ok(d.count >= 1, '按日去重计数 >= 1');
  }
  const forbidden = await api('GET', '/api/admin/funnel', null, tokenB);
  assert.equal(forbidden.status, 403);
});

test('VD-03 partners：互评完成后 times+1，双方搭友列表互见且含共同完成局数', async () => {
  const { db } = await import('../src/db.js');
  const mine = await api('GET', '/api/my/posts/published', null, tokenF);
  const pid = mine.json.data.find((p) => p.title === 'VD埋点追踪羽毛球局').id;
  // 上一用例 F 已评 B；B 回评 F → 互评完成 → 建立搭友关系 times=1
  const rate = await api('POST', `/api/posts/${pid}/rate`, { ratee_id: userIdF, stars: 5 }, tokenB);
  assert.equal(rate.status, 200);
  const [a, b] = userIdF < userIdB ? [userIdF, userIdB] : [userIdB, userIdF];
  const row = db.prepare('SELECT * FROM partners WHERE user_a = ? AND user_b = ?').get(a, b);
  assert.ok(row, 'partners 行存在（a<b 排序）');
  assert.equal(row.times, 1, '首次互评完成 times=1');
  assert.equal(row.last_post_id, pid, 'last_post_id 记录共同搭的局');
  // F 视角搭友列表
  const mineF = await api('GET', '/api/users/me/partners', null, tokenF);
  assert.equal(mineF.status, 200);
  const item = mineF.json.data.list.find((x) => x.partner.id === userIdB);
  assert.ok(item, 'B 出现在 F 的搭友列表');
  assert.equal(item.times, 1);
  assert.equal(item.partner.nickname, '测试乙');
  assert.equal(typeof item.done_count, 'number');
  assert.ok(item.done_count >= 1, '共同完成的局数计入该 done 局');
  // B 视角互见
  const mineB = await api('GET', '/api/users/me/partners', null, tokenB);
  assert.ok(mineB.json.data.list.some((x) => x.partner.id === userIdF), 'F 出现在 B 的搭友列表');
});

test('VD-04 老搭子加权：构造 partner 后 /for-you 加分、理由置顶、封顶100', async () => {
  const { db } = await import('../src/db.js');
  // A 发一个新 open 帖作为观测对象
  const pub = await api('POST', '/api/posts', { category: 'food', title: 'VD老搭子加权测试局', content: 'x', city: '北京' }, tokenA);
  assert.equal(pub.status, 200);
  const pid = pub.json.data.id;
  // 收窄候选池：临时关闭其他人的 open 帖（结束恢复），确保目标帖进入 top20
  const otherIds = db.prepare("SELECT id FROM posts WHERE status = 'open' AND user_id != ?").all(userIdA).map((r) => r.id);
  if (otherIds.length) {
    db.prepare(`UPDATE posts SET status = 'closed' WHERE id IN (${otherIds.map(() => '?').join(',')})`).run(...otherIds);
  }
  const [pa, pb] = userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
  const prev = db.prepare('SELECT * FROM partners WHERE user_a = ? AND user_b = ?').get(pa, pb);
  db.prepare('DELETE FROM partners WHERE user_a = ? AND user_b = ?').run(pa, pb); // 先清掉基线（早前火锅局互评产生过 A-B）
  try {
    // 无搭友：基线分，不含老搭子理由
    const before = await api('GET', '/api/for-you', null, tokenB);
    const itemBefore = before.json.data.list.find((p) => p.id === pid);
    assert.ok(itemBefore, '目标帖可见');
    const scoreBefore = itemBefore.match_score;
    assert.ok(Number.isInteger(scoreBefore));
    assert.ok(!itemBefore.match_reasons.some((r) => r.includes('老搭子')), '无搭友时理由不含老搭子');
    assert.equal(itemBefore.partner_times, 0);
    // 构造 partner times=2 → +20
    db.prepare('INSERT INTO partners (user_a, user_b, times, last_post_id, created_at) VALUES (?,?,?,?,?)')
      .run(pa, pb, 2, pid, Date.now());
    const after = await api('GET', '/api/for-you', null, tokenB);
    const itemAfter = after.json.data.list.find((p) => p.id === pid);
    assert.ok(itemAfter);
    assert.equal(itemAfter.match_score, Math.min(100, scoreBefore + 20), 'times=2 → +10×min(2,3)=+20');
    assert.equal(itemAfter.partner_times, 2);
    assert.equal(itemAfter.match_reasons[0], '老搭子·搭过2次', '老搭子理由放最前');
    // times=5 → 加分封顶 +30，总分不超 100
    db.prepare('UPDATE partners SET times = 5 WHERE user_a = ? AND user_b = ?').run(pa, pb);
    const after2 = await api('GET', '/api/for-you', null, tokenB);
    const item2 = after2.json.data.list.find((p) => p.id === pid);
    assert.equal(item2.match_score, Math.min(100, scoreBefore + 30), 'times=5 → 加分取 min(5,3)=3');
    assert.ok(item2.match_score <= 100, '总分封顶 100');
    assert.equal(item2.match_reasons[0], '老搭子·搭过5次');
  } finally {
    // 恢复：搭友行与被收窄的帖子状态
    if (prev) {
      db.prepare('UPDATE partners SET times = ?, last_post_id = ? WHERE user_a = ? AND user_b = ?')
        .run(prev.times, prev.last_post_id, pa, pb);
    } else {
      db.prepare('DELETE FROM partners WHERE user_a = ? AND user_b = ?').run(pa, pb);
    }
    if (otherIds.length) {
      db.prepare(`UPDATE posts SET status = 'open' WHERE id IN (${otherIds.map(() => '?').join(',')})`).run(...otherIds);
    }
  }
});

test('VD-07+BE-6 messages 回传 read_at 与 context，拉取触发 WS peer_read', async () => {
  const { handleChatMessage } = await import('../src/routes/chat.js');
  const { db } = await import('../src/db.js');
  const { default: WebSocket } = await import('ws');
  const convs = await api('GET', '/api/chat/convs', null, tokenB);
  const conv = convs.json.data.find((c) => c.other && c.other.id === userIdA);
  assert.ok(conv, 'A↔B 会话存在（火锅局审批时建立，post_id=火锅局）');
  // A 发一条新消息（B 侧产生未读）
  const userA = db.prepare('SELECT * FROM users WHERE id = ?').get(userIdA);
  const sent = handleChatMessage(userA, conv.id, 'VD-07已读回执测试消息');
  assert.ok(!sent.error, 'send ok: ' + (sent.error || ''));
  // A 先拉取：自己发的消息未被读 → read_at 字段存在且为 null
  const aMsgs = await api('GET', `/api/chat/conv/${conv.id}/messages`, null, tokenA);
  const aMsg = aMsgs.json.data.messages.find((m) => m.id === sent.message.id);
  assert.ok('read_at' in aMsg, '消息对象携带 read_at 字段');
  assert.equal(aMsg.read_at, null, '未读时 read_at=null');
  // A 连 WS 等待 peer_read（B 拉取置读后推送）
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: tokenA })));
    ws.on('message', (raw) => { if (JSON.parse(raw.toString()).type === 'auth_ok') resolve(); });
  });
  const peerRead = new Promise((resolve) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'peer_read' && m.conv_id === conv.id) resolve(m);
    });
  });
  const bMsgs1 = await api('GET', `/api/chat/conv/${conv.id}/messages`, null, tokenB);
  const evt = await Promise.race([
    peerRead,
    new Promise((_, rej) => setTimeout(() => rej(new Error('peer_read 超时')), 5000)),
  ]);
  assert.equal(evt.type, 'peer_read');
  assert.equal(evt.conv_id, conv.id);
  // B 再次拉取：该消息 read_at 已有值
  const bMsgs2 = await api('GET', `/api/chat/conv/${conv.id}/messages`, null, tokenB);
  const m2 = bMsgs2.json.data.messages.find((m) => m.id === sent.message.id);
  assert.equal(typeof m2.read_at, 'number', '读后 read_at 为时间戳');
  // BE-6 破冰上下文：关联帖（火锅局 food）+ 双方 tags
  const ctx = bMsgs1.json.data.context;
  assert.ok(ctx, 'context 存在');
  assert.equal(ctx.post_category, 'food');
  assert.equal(ctx.post_title, '测试火锅局');
  assert.deepEqual(ctx.other_tags, ['美食', '摄影'], '对端（A）tags');
  assert.ok(Array.isArray(ctx.my_tags), '我的 tags 字段存在');
  ws.close();
});

test('VD-02 jobs：14天过期 / done超72h互评提醒一次 / 老搭子同城新局推送幂等', async () => {
  const { db } = await import('../src/db.js');
  const { runJobs } = await import('../src/jobs.js');
  const DAY = 86400000;

  // ① 老搭子推送：A↔B 已是搭友（火锅局互评产生），A 发同城（北京）新局 → B 收到定向通知
  const notifBefore = await api('GET', '/api/notifications', null, tokenB);
  const pushBefore = notifBefore.json.data.filter((n) => n.type === 'partner_new_post').length;
  const pub = await api('POST', '/api/posts', { category: 'coffee', title: 'VD老搭子新局通知测试局', content: 'x', city: '北京' }, tokenA);
  assert.equal(pub.status, 200);
  runJobs();
  const notifAfter = await api('GET', '/api/notifications', null, tokenB);
  const pushes = notifAfter.json.data.filter((n) => n.type === 'partner_new_post');
  assert.ok(pushes.length > pushBefore, 'B 收到老搭子推送');
  assert.ok(pushes.some((n) => n.body.includes('VD老搭子新局通知测试局')), '推送正文含新局标题');
  assert.ok(pushes.some((n) => n.body.includes('测试甲')), '推送正文含老搭子昵称');
  // 幂等：再跑一轮不重复
  runJobs();
  const notifAfter2 = await api('GET', '/api/notifications', null, tokenB);
  assert.equal(
    notifAfter2.json.data.filter((n) => n.type === 'partner_new_post').length,
    pushes.length,
    '同帖不重复推送（events 防重）'
  );

  // ② 过期：open 帖 created_at 回拨 15 天 → expired
  const old = await api('POST', '/api/posts', { category: 'study', title: 'VD过期测试局', content: 'x', city: '北京' }, tokenA);
  assert.equal(old.status, 200);
  const oldPid = old.json.data.id;
  db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run(Date.now() - 15 * DAY, oldPid);
  runJobs();
  const expiredDetail = await api('GET', `/api/posts/${oldPid}`);
  assert.equal(expiredDetail.json.data.status, 'expired', '超 14 天 open 帖自动过期');

  // ③ 搭后互评提醒：done 超 72h 双方未互评 → 各提醒一次且不重复
  const done = await api('POST', '/api/posts', { category: 'movie', title: 'VD互评提醒测试局', content: 'x', city: '北京', need_count: 2 }, tokenA);
  const dpid = done.json.data.id;
  await api('POST', `/api/posts/${dpid}/join`, {}, tokenB);
  const jlist = await api('GET', `/api/posts/${dpid}/joins`, null, tokenA);
  await api('POST', `/api/posts/${dpid}/joins/${jlist.json.data[0].id}/approve`, { approve: true }, tokenA);
  await api('PUT', `/api/posts/${dpid}`, { status: 'done' }, tokenA);
  // done 事件回拨到 73h 前
  db.prepare("UPDATE events SET created_at = ? WHERE type = 'done' AND post_id = ?").run(Date.now() - 73 * 3600_000, dpid);
  runJobs();
  const bN1 = await api('GET', '/api/notifications', null, tokenB);
  assert.equal(bN1.json.data.filter((n) => n.type === 'rate_reminder' && n.data && n.data.post_id === dpid).length, 1, 'B 收到一次互评提醒');
  const aN1 = await api('GET', '/api/notifications', null, tokenA);
  assert.equal(aN1.json.data.filter((n) => n.type === 'rate_reminder' && n.data && n.data.post_id === dpid).length, 1, 'A（也未互评）收到一次提醒');
  runJobs();
  const bN2 = await api('GET', '/api/notifications', null, tokenB);
  assert.equal(bN2.json.data.filter((n) => n.type === 'rate_reminder' && n.data && n.data.post_id === dpid).length, 1, '不重复提醒（防重标记生效）');
});

// ==================================================================
// 评审 R1 修复回归（安全 S1/S2/S3/S8 + 架构 A1/A3/A7 + 用户批评 P0/P1）：
// JWT 文件密钥 / 注册 gender·city 入库 / 举报去重与当日首扣 /
// banned·deleted WS 状态复查 / 满员自动婉拒 / 登录每IP限流
// ==================================================================

test('JWT密钥：文件密钥生成与跨进程复用 + 伪造默认密钥 token 401（S1/A1）', async () => {
  const { signToken, verifyToken } = await import('../src/util.js');
  const jwt = (await import('jsonwebtoken')).default;
  // 密钥文件存在且为强随机（新生成时 = crypto.randomBytes(32).hex、权限 600）
  assert.ok(fs.existsSync(JWT_FILE), 'server/data/.jwt-secret 应存在');
  const content = fs.readFileSync(JWT_FILE, 'utf8').trim();
  assert.ok(content.length >= 64, '密钥长度应 ≥64 字符（32 字节 hex）');
  if (!jwtFileExistedAtStart) {
    assert.match(content, /^[0-9a-f]{64}$/, '新生成密钥应为 64 位 hex');
    assert.equal(fs.statSync(JWT_FILE).mode & 0o777, 0o600, '密钥文件权限应为 600');
  }
  // 进程内 sign/verify 一致
  const token = signToken({ id: 424242, username: 'jwt_check' });
  const payload = verifyToken(token);
  assert.ok(payload, 'signToken 后 verifyToken 应通过');
  assert.equal(payload.uid, 424242);
  // 进程内密钥 == 文件内容：用文件内容直接校验签名通过
  assert.equal(jwt.verify(token, content).uid, 424242, '内存密钥应等于 .jwt-secret 文件内容');
  // 跨进程复用：子进程重新加载 util.js（读同一密钥文件、独立临时库）签发，本进程可验证
  const childToken = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [
      '--input-type=module', '-e',
      `const m = await import(${JSON.stringify(path.join(ROOT, 'src', 'util.js'))}); process.stdout.write(m.signToken({ id: 777777, username: 'crossproc' }));`,
    ], { env: { ...process.env, DADA_DB: `/tmp/dada-jwt-test-${process.pid}.sqlite` } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    // R5 起 db.js 启动时会打印 schema 版本行 → 取 stdout 最后一行作为 token
    p.on('exit', () => resolve(out.trim().split('\n').pop()));
  });
  const cross = verifyToken(childToken);
  assert.ok(cross, '子进程签发的 token 应可被本进程验证（两次进程读同一密钥文件）');
  assert.equal(cross.uid, 777777);
  // 攻击重放（S1 核心）：用旧默认密钥 'dada-dev-secret-change-me' 伪造 admin token → 必须失效
  const forged = jwt.sign({ uid: 1, username: 'admin' }, 'dada-dev-secret-change-me');
  assert.equal(verifyToken(forged), null, '默认密钥伪造的 token 校验必须失败');
  const r = await api('GET', '/api/auth/me', null, forged);
  assert.equal(r.status, 401, '伪造默认密钥 token 请求 /auth/me 应 401');
});

test('注册gender/city入库：女性手机号注册可申请并通过女生局（用户批评R1 P0）', async () => {
  // 手机号注册模式不再硬编码 gender='secret', city=''
  const sms = await api('POST', '/api/auth/sms/send', { phone: '13733334444' });
  assert.equal(sms.status, 200, 'sms/send: ' + JSON.stringify(sms.json));
  const reg = await api('POST', '/api/auth/register', {
    phone: '13733334444', code: sms.json.data.demo_code, password: '123456',
    nickname: 'Amy手机注册', adult_confirmed: true, gender: 'female', city: '北京',
  });
  assert.equal(reg.status, 200, 'register: ' + JSON.stringify(reg.json));
  assert.equal(reg.json.data.user.gender, 'female', 'gender=female 应入库');
  assert.equal(reg.json.data.user.city, '北京', 'city 应入库');
  const tokenF = reg.json.data.token;
  // 女性手机号注册用户申请女生局 → 不再被"该搭局仅限女生参加"拒绝
  const post = await api('POST', '/api/posts', {
    category: 'coffee', title: '女性注册回归女生局', content: 'x', city: '北京', gender_req: 'female',
  }, tokenA); // A（tester_a）为女生
  assert.equal(post.status, 200);
  const pid = post.json.data.id;
  const join = await api('POST', `/api/posts/${pid}/join`, { message: '我也是女生' }, tokenF);
  assert.equal(join.status, 200, '女性注册用户应可申请女生局: ' + JSON.stringify(join.json));
  // 组局者通过该申请（全链路闭环）
  const joins = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  const j = joins.json.data.find((x) => x.user.id === reg.json.data.user.id);
  assert.ok(j, '申请出现在列表中');
  const ap = await api('POST', `/api/posts/${pid}/joins/${j.id}/approve`, { approve: true }, tokenA);
  assert.equal(ap.status, 200, '女生局申请应可通过: ' + JSON.stringify(ap.json));
  // 边界：非法 gender 回落 secret；city 截断到 60（与 PUT /me 对齐）
  const sms2 = await api('POST', '/api/auth/sms/send', { phone: '13733335555' });
  assert.equal(sms2.status, 200, '第二次 sms/send 不应被 IP 限流误伤');
  const reg2 = await api('POST', '/api/auth/register', {
    phone: '13733335555', code: sms2.json.data.demo_code, password: '123456',
    nickname: '默认资料', adult_confirmed: true, gender: 'attack', city: '市'.repeat(100),
  });
  assert.equal(reg2.status, 200);
  assert.equal(reg2.json.data.user.gender, 'secret', '非法 gender 回落 secret');
  assert.equal(reg2.json.data.user.city.length, 60, 'city 截断到 60');
});

test('举报：24h内同reporter同target去重409 + 仅当日首次扣分（S2）', async () => {
  const { db } = await import('../src/db.js');
  // 全新 reporter×2 + 全新 target，避免与既有用例的举报记录相互干扰
  const t1 = await api('POST', '/api/auth/register', { username: 's2_target', password: '123456', nickname: '被举报者' });
  const t2 = await api('POST', '/api/auth/register', { username: 's2_reporter1', password: '123456', nickname: '举报者一' });
  const t3 = await api('POST', '/api/auth/register', { username: 's2_reporter2', password: '123456', nickname: '举报者二' });
  const targetId = t1.json.data.user.id;
  const rp1 = t2.json.data.token, rp2 = t3.json.data.token;
  const credit = () => db.prepare('SELECT credit FROM users WHERE id = ?').get(targetId).credit;
  const credit0 = credit(); // 新用户 600
  // 首次举报：200 且扣 20（当日首条）
  const first = await api('POST', `/api/users/${targetId}/report`, { reason: '骚扰' }, rp1);
  assert.equal(first.status, 200);
  assert.equal(credit(), credit0 - 20, '当日首次被举报扣 20');
  // 同一 reporter 24h 内重复举报 → 409，不再扣分、不再落库
  const second = await api('POST', `/api/users/${targetId}/report`, { reason: '欺诈' }, rp1);
  assert.equal(second.status, 409);
  assert.equal(second.json.error, '已举报，请等待处理');
  assert.equal(credit(), credit0 - 20, '重复举报不再扣分');
  // 另一 reporter 同日举报 → 200 但不重复扣分（仅当日首条扣）
  const third = await api('POST', `/api/users/${targetId}/report`, { reason: '骚扰' }, rp2);
  assert.equal(third.status, 200);
  assert.equal(credit(), credit0 - 20, '同日第二位举报者不重复扣分');
  // 409 的重复举报未落库
  const cnt = db.prepare("SELECT COUNT(*) c FROM reports WHERE target_type = 'user' AND target_id = ?").get(targetId).c;
  assert.equal(cnt, 2, 'reports 表应只有 2 条（409 不落库）');
});

test('WS消息：banned/deleted 账号状态复查返回"账号状态异常"（S3/A7）', async () => {
  const { handleChatMessage } = await import('../src/routes/chat.js');
  const { db } = await import('../src/db.js');
  const convs = await api('GET', '/api/chat/convs', null, tokenA);
  const convAB = convs.json.data.find((c) => c.other && c.other.id === userIdB);
  assert.ok(convAB, 'A↔B 会话存在');
  // 模拟"残留连接"：封禁发生前拿到的用户快照（快照里 status 仍是 active）
  const staleA = db.prepare('SELECT * FROM users WHERE id = ?').get(userIdA);
  const before = db.prepare('SELECT COUNT(*) c FROM messages WHERE conv_id = ?').get(convAB.id).c;
  // 封禁：即使传入的是封禁前的旧快照，服务端按库内实时状态拦截
  db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(userIdA);
  const r1 = handleChatMessage(staleA, convAB.id, 'banned ghost message');
  assert.equal(r1.error, '账号状态异常', 'banned 账号发消息应报账号状态异常');
  // 注销（deleted）：同理拦截（S3 活幽灵连接）
  db.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").run(userIdA);
  const r2 = handleChatMessage(staleA, convAB.id, 'deleted ghost message');
  assert.equal(r2.error, '账号状态异常', 'deleted 账号发消息应报账号状态异常');
  // 拦截的消息不得入库
  const after = db.prepare('SELECT COUNT(*) c FROM messages WHERE conv_id = ?').get(convAB.id).c;
  assert.equal(after, before, '状态异常的消息不得写入 messages');
  // 恢复 active 后可正常发送
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(userIdA);
  const r3 = handleChatMessage(staleA, convAB.id, '恢复active后的正常消息');
  assert.ok(!r3.error, '恢复 active 后应放行: ' + (r3.error || ''));
});

test('满员自动婉拒：帖子 full 时剩余 pending 置 rejected 并通知（用户批评R1 搭子王#3）', async () => {
  const created = await api('POST', '/api/posts', {
    category: 'pet', title: '满员婉拒回归局', content: 'x', city: '北京', need_count: 1,
  }, tokenA);
  assert.equal(created.status, 200);
  const pid = created.json.data.id;
  // B、C 同时申请（need_count=1，通过一人即满员）
  await api('POST', `/api/posts/${pid}/join`, { message: '先到' }, tokenB);
  await api('POST', `/api/posts/${pid}/join`, { message: '后到' }, tokenC);
  const joins = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  const joinB = joins.json.data.find((x) => x.user.id === userIdB);
  const ap = await api('POST', `/api/posts/${pid}/joins/${joinB.id}/approve`, { approve: true }, tokenA);
  assert.equal(ap.status, 200);
  // 帖子已满员 → C 的 pending 自动置 rejected（不再悬置）
  const joins2 = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  const jc = joins2.json.data.find((x) => x.user.id === userIdC);
  assert.equal(jc.status, 'rejected', '满员后剩余 pending 自动置 rejected');
  // C 收到结果通知（带 post_id 供前端深链跳转）
  const notifs = await api('GET', '/api/notifications', null, tokenC);
  const n = notifs.json.data.find((x) => x.type === 'join_result' && x.data && x.data.post_id === pid);
  assert.ok(n, 'C 应收到 join_result 通知');
  assert.ok(n.body.includes('满员'), '通知正文应说明满员: ' + n.body);
});

// ==================================================================
// R3 批评修复回归：B9 seed点赞一致 / B1 性别局过滤 / B2 满员扩容闭环 /
// B3 验证码找回密码 / B4 举报进度查询 / B5 主页 open_posts / B8 dismiss 返还
// （置于"登录限流"用例之前：该用例会耗尽本测试出口 IP 的登录限额）
// ==================================================================

test('B9 P1-3 seed数据：likes_count 与 likes 表行数一致（假点赞修复）', async () => {
  const { db } = await import('../src/db.js');
  const rows = db.prepare(`
    SELECT p.id, p.likes_count, (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) actual
    FROM posts p
  `).all();
  assert.ok(rows.length >= 24, 'seed posts present');
  for (const r of rows) {
    assert.equal(r.likes_count, r.actual, `post ${r.id}: likes_count must equal real likes rows`);
  }
  const withLikes = rows.filter((r) => r.actual > 0).length;
  assert.ok(withLikes >= 10, `seed should generate real like rows for most posts, got ${withLikes}`);
});

test('B1 P1-4 性别局过滤：for-you/recommend 不再推荐不可加入的性别局（男生/secret视角）', async () => {
  const { db } = await import('../src/db.js');
  // A（女）发仅限男生局 + 仅限女生局
  const pm = await api('POST', '/api/posts', { category: 'game', title: 'R3仅男生过滤局', content: 'x', city: '北京', gender_req: 'male' }, tokenA);
  const pf = await api('POST', '/api/posts', { category: 'coffee', title: 'R3仅女生过滤局', content: 'x', city: '北京', gender_req: 'female' }, tokenA);
  assert.equal(pm.status, 200);
  assert.equal(pf.status, 200);
  const malePid = pm.json.data.id, femalePid = pf.json.data.id;
  // 收窄候选池：临时关闭其他开放帖，保证过滤断言非空转（finally 恢复）
  const others = db.prepare("SELECT id FROM posts WHERE status = 'open' AND id NOT IN (?, ?)").all(malePid, femalePid).map((r) => r.id);
  if (others.length) db.prepare(`UPDATE posts SET status = 'closed' WHERE id IN (${others.map(() => '?').join(',')})`).run(...others);
  try {
    // 男生视角（B）：仅男生局可见，仅女生局必须被硬过滤
    const fyB = await api('GET', '/api/for-you', null, tokenB);
    assert.equal(fyB.status, 200);
    const idsB = fyB.json.data.list.map((p) => p.id);
    assert.ok(idsB.includes(malePid), 'male viewer still sees male-only post');
    assert.equal(idsB.includes(femalePid), false, 'male viewer for-you must filter female-only post');
    const recB = await api('GET', '/api/recommend?city=北京', null, tokenB);
    assert.equal(recB.status, 200);
    assert.equal(recB.json.data.list.some((p) => p.id === femalePid), false, 'male viewer recommend must filter female-only post');
    assert.ok(recB.json.data.list.some((p) => p.id === malePid), 'male viewer recommend keeps male-only post');
    // secret 用户（未公开性别）：只看不限性别 → 池内两条限制局全被过滤
    const sms = await api('POST', '/api/auth/sms/send', { phone: '13699990000' });
    assert.equal(sms.status, 200);
    const reg = await api('POST', '/api/auth/register', {
      phone: '13699990000', code: sms.json.data.demo_code, password: '123456',
      nickname: '未公开性别', adult_confirmed: true,
    });
    assert.equal(reg.status, 200);
    assert.equal(reg.json.data.user.gender, 'secret');
    const fyS = await api('GET', '/api/for-you', null, reg.json.data.token);
    assert.equal(fyS.status, 200);
    assert.equal(fyS.json.data.list.length, 0, 'secret user sees no gender-restricted posts (pool only has male/female-only)');
    // 广场不受影响：全量可见（发现性保留）
    const square = await api('GET', '/api/posts?keyword=R3仅女生过滤局');
    assert.equal(square.json.data.list.length, 1, 'square feed keeps full visibility');
  } finally {
    if (others.length) db.prepare(`UPDATE posts SET status = 'open' WHERE id IN (${others.map(() => '?').join(',')})`).run(...others);
  }
});

test('B2 C2 满员扩容闭环：扩容回open + rejected批量回pending + 回流通知', async () => {
  const created = await api('POST', '/api/posts', { category: 'food', title: 'R3扩容回归局', content: 'x', city: '北京', need_count: 1 }, tokenA);
  assert.equal(created.status, 200);
  const pid = created.json.data.id;
  await api('POST', `/api/posts/${pid}/join`, { message: '乙申请' }, tokenB);
  await api('POST', `/api/posts/${pid}/join`, { message: '丙申请' }, tokenC);
  const joins = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  const jB = joins.json.data.find((x) => x.user.id === userIdB);
  const ap = await api('POST', `/api/posts/${pid}/joins/${jB.id}/approve`, { approve: true }, tokenA);
  assert.equal(ap.status, 200);
  const d0 = await api('GET', `/api/posts/${pid}`);
  assert.equal(d0.json.data.status, 'full', 'approved=need_count → full');
  // 扩容 1 → 2：status 回 open，被满员婉拒的 C 的申请回到 pending 并收到回流通知
  const put = await api('PUT', `/api/posts/${pid}`, { need_count: 2 }, tokenA);
  assert.equal(put.status, 200);
  assert.equal(put.json.data.status, 'open', 'expanding a full post reopens recruitment');
  assert.equal(put.json.data.approved_count, 1);
  const joins2 = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  assert.equal(joins2.json.data.find((x) => x.user.id === userIdC).status, 'pending', 'auto-rejected join restored to pending');
  const notifs = await api('GET', '/api/notifications', null, tokenC);
  const n = notifs.json.data.find((x) => x.type === 'join_result' && x.data && x.data.post_id === pid && x.body.includes('扩容'));
  assert.ok(n, 'C should receive reopen notification');
  // 扩容后新用户可以申请（此前 full 时 400"已停止招募"）
  const jD = await api('POST', `/api/posts/${pid}/join`, { message: '丁申请' }, tokenD);
  assert.equal(jD.status, 200, 'new join allowed after expansion');
  // A 通过 D → 再次满员；此时降到 1 人 < 已通过 2 人 → 400
  const joins3 = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  const jDrow = joins3.json.data.find((x) => x.user.id === userIdD);
  await api('POST', `/api/posts/${pid}/joins/${jDrow.id}/approve`, { approve: true }, tokenA);
  const d2 = await api('GET', `/api/posts/${pid}`);
  assert.equal(d2.json.data.status, 'full', 'full again at approved=2');
  const bad = await api('PUT', `/api/posts/${pid}`, { need_count: 1 }, tokenA);
  assert.equal(bad.status, 400, 'need_count below approved count still rejected');
});

test('B3 C5 验证码找回/重置密码：scene=reset 下发 + 一次性消费 + 旧密码失效', async () => {
  const PHONE_C = '13544445555';
  // 注册一个手机号用户（注册成功即消费验证码 → 60s 重发限制不阻碍立刻为 reset 再发一条）
  const sms1 = await api('POST', '/api/auth/sms/send', { phone: PHONE_C });
  assert.equal(sms1.status, 200);
  const reg = await api('POST', '/api/auth/register', {
    phone: PHONE_C, code: sms1.json.data.demo_code, password: '123456',
    nickname: '重置密码用户', adult_confirmed: true,
  });
  assert.equal(reg.status, 200);
  // 注册通道对已注册号码 409；reset 通道放行
  const again = await api('POST', '/api/auth/sms/send', { phone: PHONE_C });
  assert.equal(again.status, 409);
  const sms2 = await api('POST', '/api/auth/sms/send', { phone: PHONE_C, scene: 'reset' });
  assert.equal(sms2.status, 200, 'reset scene allows registered phone');
  const code = sms2.json.data.demo_code;
  // 错误验证码 → 400（不烧码）
  const bad = await api('POST', '/api/auth/password/reset', { phone: PHONE_C, code: '000000', password: 'newpass123' });
  assert.equal(bad.status, 400);
  // 未注册手机号 → 404
  const sms3 = await api('POST', '/api/auth/sms/send', { phone: '13611112222' });
  assert.equal(sms3.status, 200);
  const unreg = await api('POST', '/api/auth/password/reset', { phone: '13611112222', code: sms3.json.data.demo_code, password: 'newpass123' });
  assert.equal(unreg.status, 404);
  assert.equal(unreg.json.error, '该手机号未注册');
  // 密码过短 → 400（验证码不消费）
  const short = await api('POST', '/api/auth/password/reset', { phone: PHONE_C, code, password: '123' });
  assert.equal(short.status, 400);
  assert.equal(short.json.error, '密码至少 6 位');
  // 正确重置
  const okR = await api('POST', '/api/auth/password/reset', { phone: PHONE_C, code, password: 'newpass123' });
  assert.equal(okR.status, 200);
  assert.equal(okR.json.data.reset, true);
  // 旧密码 401 / 新密码 200
  const oldLogin = await api('POST', '/api/auth/login', { phone: PHONE_C, password: '123456' });
  assert.equal(oldLogin.status, 401);
  const newLogin = await api('POST', '/api/auth/login', { phone: PHONE_C, password: 'newpass123' });
  assert.equal(newLogin.status, 200);
  // 验证码一次性：重放 → 400
  const replay = await api('POST', '/api/auth/password/reset', { phone: PHONE_C, code, password: 'another123' });
  assert.equal(replay.status, 400, 'code is single-use across register & reset');
});

test('B4 C7 举报进度查询：GET /api/reports/mine 挂载生效，含处理时间与动作说明', async () => {
  const anon = await api('GET', '/api/reports/mine');
  assert.equal(anon.status, 401, 'requires login');
  const r = await api('GET', '/api/reports/mine', null, tokenB);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.data), 'reports/mine returns array');
  assert.ok(r.json.data.length >= 1, 'B has reports from earlier tests');
  for (const row of r.json.data) {
    assert.ok(['pending', 'resolved'].includes(row.status));
    if (row.status === 'resolved') {
      assert.equal(typeof row.resolved_at, 'number', 'resolved report carries resolved_at');
      assert.equal(typeof row.action_text, 'string', 'resolved report carries action_text');
    } else {
      assert.equal(row.resolved_at, null);
      assert.equal(row.action_text, null);
    }
  }
  const resolved = r.json.data.find((x) => x.status === 'resolved');
  assert.ok(resolved, 'earlier admin resolve(warn) marked B report resolved');
  assert.ok(resolved.action_text.includes('警告'), 'action_text describes the action: ' + resolved.action_text);
});

test('B5 C9 他人主页返回 open_posts（招募中的局，≤5条，含封面）', async () => {
  const r = await api('GET', `/api/users/${userIdA}`);
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.ok(Array.isArray(d.open_posts), 'open_posts field exists');
  assert.ok(d.open_posts.length >= 1, 'A has open posts');
  assert.ok(d.open_posts.length <= 5, 'open_posts limited to 5');
  for (const p of d.open_posts) {
    for (const k of ['id', 'title', 'category', 'city', 'meet_time', 'cover']) {
      assert.ok(k in p, `open_posts item has ${k}`);
    }
    assert.ok(p.cover, 'cover resolved via coverFields fallback chain');
  }
});

test('B8 L3 举报驳回返还：dismiss 后被举报用户返还 +20 搭力值', async () => {
  const { db } = await import('../src/db.js');
  const t1 = await api('POST', '/api/auth/register', { username: 'l3_target', password: '123456', nickname: 'L3被举报者' });
  const t2 = await api('POST', '/api/auth/register', { username: 'l3_reporter', password: '123456', nickname: 'L3举报者' });
  const targetId = t1.json.data.user.id;
  const rp = t2.json.data.token;
  const credit = () => db.prepare('SELECT credit FROM users WHERE id = ?').get(targetId).credit;
  const before = credit(); // 新用户 600
  await api('POST', `/api/users/${targetId}/report`, { reason: '骚扰' }, rp);
  assert.equal(credit(), before - 20, 'report deducts 20');
  const reports = await api('GET', '/api/admin/reports?status=pending', null, tokenAdmin);
  const rid = reports.json.data.find((x) => x.target_type === 'user' && x.target_id === targetId).id;
  const res = await api('POST', `/api/admin/reports/${rid}/resolve`, { action: 'dismiss' }, tokenAdmin);
  assert.equal(res.status, 200);
  assert.equal(credit(), before, 'dismiss refunds +20, net zero');
  // 被举报人收到返还通知；举报人收到处理结果通知
  const targetNotifs = await api('GET', '/api/notifications', null, t1.json.data.token);
  assert.ok(
    targetNotifs.json.data.some((x) => x.type === 'credit' && x.body.includes('举报不实，返还搭力值')),
    'target notified of refund'
  );
  const rpNotifs = await api('GET', '/api/notifications', null, rp);
  assert.ok(rpNotifs.json.data.some((x) => x.type === 'report_result' && x.body.includes('未发现违规')), 'reporter notified of dismissal');
});

test('登录限流：每IP 15分钟20次，超出429"尝试过于频繁"（S8）', async () => {
  // 此前套件内已有若干次 /auth/login（同一测试出口 IP）——继续尝试直到触发限流窗口
  let hitAt = -1;
  for (let i = 0; i < 30; i++) {
    const r = await api('POST', '/api/auth/login', { username: 'bruteforce_probe', password: 'wrong' + i });
    if (r.status === 429) {
      assert.equal(r.json.error, '尝试过于频繁，请稍后再试');
      hitAt = i;
      break;
    }
    assert.equal(r.status, 401, '限流触发前应为 401（账号不存在/密码错误）');
  }
  assert.ok(hitAt >= 0, '30 次内应触发 429 登录限流');
  // 窗口期内继续请求仍被限流
  const r2 = await api('POST', '/api/auth/login', { username: 'bruteforce_probe', password: 'x' });
  assert.equal(r2.status, 429);
});

// ==================================================================
// R4 批评修复回归（状态机 review-state-r4 + 灰产对抗 review-gray-r4）：
// T3 done幂等+零成员不加分 / T4 approve帖子状态守卫 / T5 账号状态复查 /
// T2 quit退出通道 / T7 phone部分唯一索引 / G1 用户名注册开关 /
// G2 资料字段归一化过滤 / G3 聊天硬词拒收 / Ops-O5 意见反馈
// ==================================================================

test('R4-T3 done幂等：重复标记完成400且不重复加分/不重复通知', async () => {
  const { db } = await import('../src/db.js');
  const created = await api('POST', '/api/posts', {
    category: 'food', title: 'R4幂等完成局', content: 'x', city: '北京', need_count: 1,
  }, tokenA);
  assert.equal(created.status, 200);
  const pid = created.json.data.id;
  await api('POST', `/api/posts/${pid}/join`, { message: '带我一个' }, tokenB);
  const jlist = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  await api('POST', `/api/posts/${pid}/joins/${jlist.json.data[0].id}/approve`, { approve: true }, tokenA);
  const creditOf = (id) => db.prepare('SELECT credit FROM users WHERE id = ?').get(id).credit;
  const a0 = creditOf(userIdA), b0 = creditOf(userIdB);
  // 第 1 次 done：正常完成，双方各 +20
  const d1 = await api('PUT', `/api/posts/${pid}`, { status: 'done' }, tokenA);
  assert.equal(d1.status, 200);
  assert.equal(d1.json.data.status, 'done');
  assert.equal(creditOf(userIdA), a0 + 20, 'author +20 once');
  assert.equal(creditOf(userIdB), b0 + 20, 'member +20 once');
  // 第 2 次 done（双击/网络重试）：400 幂等护栏，分值与通知都不再变动
  const d2 = await api('PUT', `/api/posts/${pid}`, { status: 'done' }, tokenA);
  assert.equal(d2.status, 400);
  assert.equal(d2.json.error, '该搭局已完成');
  assert.equal(creditOf(userIdA), a0 + 20, 'no double credit for author');
  assert.equal(creditOf(userIdB), b0 + 20, 'no double credit for member');
  const bNotifs = await api('GET', '/api/notifications', null, tokenB);
  const doneNotifs = bNotifs.json.data.filter((n) => n.type === 'post_done' && n.data && n.data.post_id === pid);
  assert.equal(doneNotifs.length, 1, 'exactly one post_done notification');
  // done 后重开再完成也拒不掉（防 done→open→done 循环刷分）
  const reopen = await api('PUT', `/api/posts/${pid}`, { status: 'open' }, tokenA);
  assert.equal(reopen.status, 400);
});

test('R4-T3 零成员open局直接done：状态流转但作者不加分', async () => {
  const { db } = await import('../src/db.js');
  const created = await api('POST', '/api/posts', {
    category: 'coffee', title: 'R4零成员完成局', content: 'x', city: '北京', need_count: 1,
  }, tokenA);
  assert.equal(created.status, 200);
  const pid = created.json.data.id;
  const creditOf = (id) => db.prepare('SELECT credit FROM users WHERE id = ?').get(id).credit;
  const a0 = creditOf(userIdA);
  const d = await api('PUT', `/api/posts/${pid}`, { status: 'done' }, tokenA);
  assert.equal(d.status, 200, '0-member post can still be marked done');
  assert.equal(d.json.data.status, 'done');
  assert.equal(d.json.data.approved_count, 0);
  assert.equal(creditOf(userIdA), a0, 'author must NOT gain credit without any approved member');
});

test('R4-T4 approve帖子状态守卫：expired局不复活、不可批准', async () => {
  const { db } = await import('../src/db.js');
  const { runJobs } = await import('../src/jobs.js');
  const created = await api('POST', '/api/posts', {
    category: 'study', title: 'R4过期审批守卫局', content: 'x', city: '北京', need_count: 1,
  }, tokenA);
  assert.equal(created.status, 200);
  const pid = created.json.data.id;
  await api('POST', `/api/posts/${pid}/join`, { message: '过期前申请' }, tokenB);
  // 走真实 jobs 路径置 expired（created_at 回拨 15 天）
  db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run(Date.now() - 15 * 86400000, pid);
  assert.equal(runJobs().expired >= 1, true, 'post expired by job');
  const jlist = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  const joinId = jlist.json.data[0].id;
  const ap = await api('POST', `/api/posts/${pid}/joins/${joinId}/approve`, { approve: true }, tokenA);
  assert.equal(ap.status, 400);
  assert.equal(ap.json.error, '该搭局已过期或结束');
  // expired 不被"复活"为 full；申请保持 pending 未被批准
  const detail = await api('GET', `/api/posts/${pid}`);
  assert.equal(detail.json.data.status, 'expired', 'expired post must not be revived to full');
  assert.equal(detail.json.data.my_join === undefined || detail.json.data.my_join !== 'approved', true);
  const joins2 = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  assert.equal(joins2.json.data[0].status, 'pending');
});

test('R4-T5 approve账号复查：已注销申请人的join自动拒绝并说明', async () => {
  const reg = await api('POST', '/api/auth/register', {
    username: 'r4_gone_user', password: '123456', nickname: '将注销申请人', gender: 'male', city: '北京',
  });
  assert.equal(reg.status, 200);
  const tokenG = reg.json.data.token, userIdG = reg.json.data.user.id;
  const created = await api('POST', '/api/posts', {
    category: 'game', title: 'R4注销复查局', content: 'x', city: '北京', need_count: 1,
  }, tokenA);
  const pid = created.json.data.id;
  await api('POST', `/api/posts/${pid}/join`, { message: '我还在' }, tokenG);
  // 申请人注销（与 approve 的时序无关：顺序执行同样必须拦截）
  const del = await api('POST', '/api/users/me/delete', { confirm: 'DELETE' }, tokenG);
  assert.equal(del.status, 200);
  const jlist = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  const joinId = jlist.json.data.find((x) => x.user.id === userIdG).id;
  const ap = await api('POST', `/api/posts/${pid}/joins/${joinId}/approve`, { approve: true }, tokenA);
  assert.equal(ap.status, 400);
  assert.ok(ap.json.error.includes('注销'), 'error explains the account is gone: ' + ap.json.error);
  // 该 join 被置 rejected（不悬置、不占名额）
  const joins2 = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  assert.equal(joins2.json.data.find((x) => x.user.id === userIdG).status, 'rejected');
  const detail = await api('GET', `/api/posts/${pid}`);
  assert.equal(detail.json.data.status, 'open', 'post stays open (deleted applicant did not take a slot)');
});

test('R4-T5 done账号复查：已注销成员跳过加分与通知，其余照常', async () => {
  const { db } = await import('../src/db.js');
  const reg = await api('POST', '/api/auth/register', {
    username: 'r4_gone_member', password: '123456', nickname: '将注销成员', gender: 'male', city: '北京',
  });
  assert.equal(reg.status, 200);
  const tokenM = reg.json.data.token, userIdM = reg.json.data.user.id;
  const created = await api('POST', '/api/posts', {
    category: 'sports', title: 'R4注销成员完成局', content: 'x', city: '北京', need_count: 1,
  }, tokenA);
  const pid = created.json.data.id;
  await api('POST', `/api/posts/${pid}/join`, { message: '先通过再注销' }, tokenM);
  const jlist = await api('GET', `/api/posts/${pid}/joins`, null, tokenA);
  await api('POST', `/api/posts/${pid}/joins/${jlist.json.data[0].id}/approve`, { approve: true }, tokenA);
  // 通过后注销，再标记完成
  await api('POST', '/api/users/me/delete', { confirm: 'DELETE' }, tokenM);
  const creditOf = (id) => db.prepare('SELECT credit FROM users WHERE id = ?').get(id).credit;
  const a0 = creditOf(userIdA), m0 = creditOf(userIdM);
  const notifCount = () => db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ?').get(userIdM).c;
  const notifBefore = notifCount();
  const d = await api('PUT', `/api/posts/${pid}`, { status: 'done' }, tokenA);
  assert.equal(d.status, 200);
  assert.equal(creditOf(userIdM), m0, 'deleted member must NOT gain credit');
  assert.equal(creditOf(userIdA), a0 + 20, 'active author still +20');
  assert.equal(notifCount(), notifBefore, 'deleted member receives no notification from done');
});

test('R4-T2 quit退出通道：pending/rejected可退出+通知组局者+不回流', async () => {
  // -- 场景1：pending 退出
  const p1 = await api('POST', '/api/posts', {
    category: 'movie', title: 'R4退出通道局', content: 'x', city: '北京', need_count: 2,
  }, tokenA);
  assert.equal(p1.status, 200);
  const pid1 = p1.json.data.id;
  await api('POST', `/api/posts/${pid1}/join`, { message: 'C申请' }, tokenC);
  const q1 = await api('POST', `/api/posts/${pid1}/quit`, {}, tokenC);
  assert.equal(q1.status, 200);
  assert.equal(q1.json.data.quit, true);
  const j1 = await api('GET', `/api/posts/${pid1}/joins`, null, tokenA);
  assert.equal(j1.json.data.find((x) => x.user.id === userIdC).status, 'quit');
  // 组局者收到"退出"通知
  const aNotifs = await api('GET', '/api/notifications', null, tokenA);
  const quitNotif = aNotifs.json.data.find((n) => n.type === 'join_quit' && n.data && n.data.post_id === pid1);
  assert.ok(quitNotif, 'author notified of quit');
  assert.ok(quitNotif.body.includes('退出'), 'quit notification mentions exit: ' + quitNotif.body);
  // 重复退出 → 400
  const q2 = await api('POST', `/api/posts/${pid1}/quit`, {}, tokenC);
  assert.equal(q2.status, 400);
  assert.equal(q2.json.error, '已退出过该搭局');
  // 退出后可重新申请（退出不是单行道）
  const reJoin = await api('POST', `/api/posts/${pid1}/join`, { message: '改主意了' }, tokenC);
  assert.equal(reJoin.status, 200);
  const j2 = await api('GET', `/api/posts/${pid1}/joins`, null, tokenA);
  assert.equal(j2.json.data.find((x) => x.user.id === userIdC).status, 'pending');
  // approved 成员不可退出（已占名额）
  const jlist = await api('GET', `/api/posts/${pid1}/joins`, null, tokenA);
  const joinC = jlist.json.data.find((x) => x.user.id === userIdC);
  await api('POST', `/api/posts/${pid1}/joins/${joinC.id}/approve`, { approve: true }, tokenA);
  const q3 = await api('POST', `/api/posts/${pid1}/quit`, {}, tokenC);
  assert.equal(q3.status, 400);
  assert.equal(q3.json.error, '申请已通过，无法退出');

  // -- 场景2：rejected 退出后，满员扩容回流不捞 quit 行
  const p2 = await api('POST', '/api/posts', {
    category: 'food', title: 'R4退出不回流局', content: 'x', city: '北京', need_count: 1,
  }, tokenA);
  const pid2 = p2.json.data.id;
  await api('POST', `/api/posts/${pid2}/join`, { message: 'C再来' }, tokenC);
  await api('POST', `/api/posts/${pid2}/join`, { message: 'D也来' }, tokenD);
  const jl = await api('GET', `/api/posts/${pid2}/joins`, null, tokenA);
  const joinC2 = jl.json.data.find((x) => x.user.id === userIdC);
  await api('POST', `/api/posts/${pid2}/joins/${joinC2.id}/approve`, { approve: true }, tokenA); // 满员，D 被自动婉拒
  const q4 = await api('POST', `/api/posts/${pid2}/quit`, {}, tokenD); // rejected → quit
  assert.equal(q4.status, 200);
  // 扩容：rejected 回流 pending，quit 不回流
  const exp = await api('PUT', `/api/posts/${pid2}`, { need_count: 2 }, tokenA);
  assert.equal(exp.status, 200);
  assert.equal(exp.json.data.status, 'open');
  const jl2 = await api('GET', `/api/posts/${pid2}/joins`, null, tokenA);
  const dJoin = jl2.json.data.find((x) => x.user.id === userIdD);
  assert.equal(dJoin.status, 'quit', 'quit row must NOT flow back on expansion');
  // D 没有收到"扩容回流"通知
  const dNotifs = await api('GET', '/api/notifications', null, tokenD);
  const backflow = dNotifs.json.data.find((n) => n.type === 'join_result' && n.data && n.data.post_id === pid2 && n.title.includes('扩容'));
  assert.equal(backflow, undefined, 'no expansion reflow notification for quit user');
  // 从未申请过的人 quit → 404
  const q5 = await api('POST', `/api/posts/${pid1}/quit`, {}, tokenE);
  assert.equal(q5.status, 404);
});

test('R4-T7 phone部分唯一索引：active同号双插抛UNIQUE，deleted释放、NULL不受限', async () => {
  const { db } = await import('../src/db.js');
  const t = Date.now();
  const ins = (username, phone, status) => db.prepare(`
    INSERT INTO users (username, password_hash, nickname, gender, tags, phone, status, created_at, last_active_at)
    VALUES (?,?,?,?, '[]', ?, ?, ?, ?)
  `).run(username, 'x', '索引测试', 'secret', phone, status, t, t);
  ins('r4_ph_a', '13877770001', 'active');
  // 同号第二个 active 用户 → 唯一索引拒绝（多进程部署下应用层 check 失守时的最后防线）
  assert.throws(() => ins('r4_ph_b', '13877770001', 'active'), /UNIQUE/, 'duplicate active phone must violate unique index');
  // 注销态不占号（保留"注销释放手机号"语义）
  ins('r4_ph_c', '13877770001', 'deleted');
  // 未绑手机号（NULL）可多行
  ins('r4_ph_d', null, 'active');
  ins('r4_ph_e', null, 'active');
});

test('R4-G1 用户名注册开关：DADA_USERNAME_REG=0 时 403，恢复后可用', async () => {
  // 关闭（生产姿态）：用户名模式一律 403
  process.env.DADA_USERNAME_REG = '0';
  try {
    const r = await api('POST', '/api/auth/register', { username: 'r4_closed', password: '123456', nickname: '被关门' });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, '注册已改为手机号方式');
  } finally {
    delete process.env.DADA_USERNAME_REG; // 恢复演示开放（默认）
  }
  // 恢复后用户名注册可用（存量测试兼容路径仍在）
  const r2 = await api('POST', '/api/auth/register', { username: 'r4_open', password: '123456', nickname: '恢复开放' });
  assert.equal(r2.status, 200);
  assert.ok(r2.json.data.token);
});

test('R4-G2 资料字段过滤：bio/nickname/occupation/school/tags 过归一化敏感词管道', async () => {
  // bio：词表原文
  const r1 = await api('PUT', '/api/users/me', { bio: '加V看我主页' }, tokenE);
  assert.equal(r1.status, 400);
  // bio：分隔符绕过变体（加·V）——归一化后同样命中
  const r2 = await api('PUT', '/api/users/me', { bio: '加·V看主页' }, tokenE);
  assert.equal(r2.status, 400);
  // bio：空格拆字（威 信）
  const r3 = await api('PUT', '/api/users/me', { bio: '威 信 找我' }, tokenE);
  assert.equal(r3.status, 400);
  // bio：全角变体（ｖｘ：ａｂｃ）
  const r4 = await api('PUT', '/api/users/me', { bio: 'ｖｘ：ａｂｃ2026' }, tokenE);
  assert.equal(r4.status, 400);
  // nickname / occupation / school 同管道
  const r5 = await api('PUT', '/api/users/me', { nickname: '加V客服' }, tokenE);
  assert.equal(r5.status, 400);
  const r6 = await api('PUT', '/api/users/me', { occupation: '加V看主页' }, tokenE);
  assert.equal(r6.status, 400);
  const r7 = await api('PUT', '/api/users/me', { school: 'vx:abc2026中学' }, tokenE);
  assert.equal(r7.status, 400);
  // tags 逐个过滤
  const r8 = await api('PUT', '/api/users/me', { tags: ['徒步', 'vx'] }, tokenE);
  assert.equal(r8.status, 400);
  // 正常值放行（无副作用）
  const ok1 = await api('PUT', '/api/users/me', { bio: '喜欢爬山看日出', tags: ['徒步', '摄影'] }, tokenE);
  assert.equal(ok1.status, 200);
  assert.equal(ok1.json.data.bio, '喜欢爬山看日出');
  // 学生认证 school 同守卫（曾成"+30分认证广告牌"）
  const reg = await api('POST', '/api/auth/register', { username: 'r4_student', password: '123456', nickname: '认证过滤' });
  assert.equal(reg.status, 200);
  const v1 = await api('POST', '/api/users/me/verify', { type: 'student', school: 'vx:abc2026中学' }, reg.json.data.token);
  assert.equal(v1.status, 400);
  assert.ok(v1.json.error.includes('学校'), 'verify school error mentions school: ' + v1.json.error);
  const v2 = await api('POST', '/api/users/me/verify', { type: 'student', school: '北京邮电大学' }, reg.json.data.token);
  assert.equal(v2.status, 200);
});

test('R4-G2 帖子location_name过滤：引流变体400，正常地点入库', async () => {
  const bad = await api('POST', '/api/posts', {
    category: 'travel', title: 'R4地点过滤局', content: 'x', city: '杭州', location_name: '西湖边上 vx:abc2026',
  }, tokenA);
  assert.equal(bad.status, 400);
  const good = await api('POST', '/api/posts', {
    category: 'travel', title: 'R4地点正常局', content: 'x', city: '杭州', location_name: '西湖断桥',
  }, tokenA);
  assert.equal(good.status, 200);
  assert.equal(good.json.data.location_name, '西湖断桥');
});

test('R4-G3 聊天硬词拒收+软词打码：变体同样命中硬词', async () => {
  const { handleChatMessage } = await import('../src/routes/chat.js');
  const { db } = await import('../src/db.js');
  const convs = await api('GET', '/api/chat/convs', null, tokenA);
  const convAB = convs.json.data.find((c) => c.other && c.other.id === userIdB);
  assert.ok(convAB, 'A↔B 会话存在');
  const count = () => db.prepare('SELECT COUNT(*) c FROM messages WHERE conv_id = ?').get(convAB.id).c;
  const before = count();
  // 硬词（导流/资金类）→ 拒收，不入库
  const r1 = handleChatMessage(db.prepare('SELECT * FROM users WHERE id = ?').get(userIdA), convAB.id, '加微信吧 abc12345');
  assert.equal(r1.error, '消息包含违规内容，已被拦截');
  // 硬词变体：分隔符绕过（加·V）归一化后命中 → 同样拒收
  const r2 = handleChatMessage(db.prepare('SELECT * FROM users WHERE id = ?').get(userIdA), convAB.id, '加·V：abc12345');
  assert.equal(r2.error, '消息包含违规内容，已被拦截');
  // 硬词变体：转账（资金诈骗类）→ 拒收
  const r3 = handleChatMessage(db.prepare('SELECT * FROM users WHERE id = ?').get(userIdA), convAB.id, '先转保证金再进群');
  assert.equal(r3.error, '消息包含违规内容，已被拦截');
  assert.equal(count(), before, 'rejected messages must not be stored');
  // 软词（涉黄暗语等灰产信号）→ 打码放行
  const userA = db.prepare('SELECT * FROM users WHERE id = ?').get(userIdA);
  const r4 = handleChatMessage(userA, convAB.id, '我们纯绿徒步，费用全包也没事');
  assert.ok(!r4.error, 'soft word passes masked: ' + (r4.error || ''));
  assert.deepEqual([...r4.blocked_words].sort(), ['纯绿', '费用全包'].sort(), 'soft hits reported (order follows wordlist scan)');
  assert.ok(r4.message.content.includes('*'), 'soft word masked');
  assert.equal(r4.message.content, '我们**徒步，****也没事');
  assert.equal(count(), before + 1, 'masked message stored exactly once');
});

test('R4-O5 意见反馈：提交/校验/admin列表/处理留痕/通知', async () => {
  // 长度校验
  const short = await api('POST', '/api/feedback', { content: '太短' }, tokenE);
  assert.equal(short.status, 400);
  assert.equal(short.json.error, '反馈内容需为 5-500 字');
  const long = await api('POST', '/api/feedback', { content: '好'.repeat(501) }, tokenE);
  assert.equal(long.status, 400);
  // 违规内容拦截
  const dirty = await api('POST', '/api/feedback', { content: '这个app不行，我要加V去别家' }, tokenE);
  assert.equal(dirty.status, 400);
  // 正常提交
  const sub = await api('POST', '/api/feedback', { content: '希望增加批量取消申请的功能，谢谢' }, tokenE);
  assert.equal(sub.status, 200);
  assert.equal(sub.json.data.submitted, true);
  // 非管理员不可见队列
  const forbidden = await api('GET', '/api/admin/feedback', null, tokenE);
  assert.equal(forbidden.status, 403);
  // admin 队列可见（含提交人昵称）
  const list = await api('GET', '/api/admin/feedback', null, tokenAdmin);
  assert.equal(list.status, 200);
  const mine = list.json.data.find((f) => f.content === '希望增加批量取消申请的功能，谢谢');
  assert.ok(mine, 'submitted feedback visible in admin queue');
  assert.equal(mine.status, 'open');
  assert.equal(mine.user_nickname !== undefined, true, 'queue rows carry submitter nickname');
  // resolve 必须带处理说明
  const noText = await api('POST', `/api/admin/feedback/${mine.id}/resolve`, {}, tokenAdmin);
  assert.equal(noText.status, 400);
  // resolve 成功 → 状态与处理说明留痕
  const res1 = await api('POST', `/api/admin/feedback/${mine.id}/resolve`, { action_text: '已收到，规划中' }, tokenAdmin);
  assert.equal(res1.status, 200);
  const resolvedList = await api('GET', '/api/admin/feedback?status=resolved', null, tokenAdmin);
  const done = resolvedList.json.data.find((f) => f.id === mine.id);
  assert.ok(done, 'resolved feedback in resolved queue');
  assert.equal(done.action_text, '已收到，规划中');
  // 重复 resolve → 400
  const res2 = await api('POST', `/api/admin/feedback/${mine.id}/resolve`, { action_text: '再处理一次' }, tokenAdmin);
  assert.equal(res2.status, 400);
  assert.equal(res2.json.error, '该反馈已处理');
  // 提交人收到处理结果通知
  const eNotifs = await api('GET', '/api/notifications', null, tokenE);
  const fbNotif = eNotifs.json.data.find((n) => n.type === 'feedback_result' && n.data && n.data.feedback_id === mine.id);
  assert.ok(fbNotif, 'submitter notified of resolution');
  assert.ok(fbNotif.body.includes('已收到，规划中'));
});

// ==================== R5 修复回归（db-r5 / api-r5 / time-r5 后端条目） ====================

test('R5-API2 未匹配 /api/* 返回 JSON 404（此前是 Express 默认 HTML）', async () => {
  const r = await api('GET', '/api/nonexistent');
  assert.equal(r.status, 404);
  assert.ok(r.json, 'body must be parseable JSON');
  assert.equal(r.json.error, '接口不存在');
  // 路径匹配但方法不支持，同样落 JSON 404 兜底（posts 路由无 DELETE /:id）
  const r2 = await api('DELETE', '/api/posts/1');
  assert.equal(r2.status, 404);
  assert.equal(r2.json.error, '接口不存在');
});

test('R5-API8 /cities 白名单：返回 {city,count}，不再泄漏 SQL 别名 c', async () => {
  const r = await api('GET', '/api/cities');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.data) && r.json.data.length > 0);
  for (const row of r.json.data) {
    assert.equal(typeof row.city, 'string', 'row.city is string');
    assert.equal(typeof row.count, 'number', 'row.count is number');
    assert.equal('c' in row, false, 'SQL alias c must not leak');
    assert.equal(Object.keys(row).length, 2, 'whitelist: only city+count');
  }
});

test('R5-API8 /reports/mine 白名单：不外泄 reporter_id/resolve_action 等内部字段', async () => {
  // 独立新账号举报，避开既有测试的 24h 重复举报 409
  const reg1 = await api('POST', '/api/auth/register', { username: 'r5_reporter', password: '123456', nickname: 'R5举报人', city: '北京' });
  const reg2 = await api('POST', '/api/auth/register', { username: 'r5_target', password: '123456', nickname: 'R5被举报人', city: '北京' });
  const reporter = reg1.json.data;
  const rep = await api('POST', `/api/users/${reg2.json.data.user.id}/report`, { reason: '骚扰', detail: 'R5 白名单用例' }, reporter.token);
  assert.equal(rep.status, 200);
  const mine = await api('GET', '/api/reports/mine', null, reporter.token);
  assert.equal(mine.status, 200);
  const row = mine.json.data.find((x) => x.detail === 'R5 白名单用例');
  assert.ok(row, 'report visible to reporter');
  for (const k of ['id', 'target_type', 'target_id', 'reason', 'detail', 'status', 'created_at', 'resolved_at', 'action_text']) {
    assert.ok(k in row, `whitelist field ${k} present`);
  }
  for (const k of ['reporter_id', 'resolve_action']) {
    assert.equal(k in row, false, `internal field ${k} must not leak`);
  }
});

test('R5-API8 /auth/me 返回 is_admin（管理员 true / 普通用户 false）', async () => {
  const admin = await api('GET', '/api/auth/me', null, tokenAdmin);
  assert.equal(admin.status, 200);
  assert.equal(admin.json.data.is_admin, true, 'admin sees is_admin=true');
  const normal = await api('GET', '/api/auth/me', null, tokenA);
  assert.equal(normal.json.data.is_admin, false, 'normal user sees is_admin=false');
});

test('R5-TS1 meet_at 结构化：校验/入库/透传/周期豁免/编辑一致', async () => {
  const base = { category: 'food', title: 'R5结构化时间局', content: 'x', city: '北京' };
  // 过近（< now+5min）→ 400
  const tooSoon = await api('POST', '/api/posts', { ...base, title: 'R5过近局', meet_at: Date.now() + 60_000 }, tokenA);
  assert.equal(tooSoon.status, 400);
  assert.equal(tooSoon.json.error, '开始时间需在5分钟到一年之内');
  // 过远（> now+365d）→ 400
  const tooFar = await api('POST', '/api/posts', { ...base, title: 'R5过远局', meet_at: Date.now() + 400 * 86400000 }, tokenA);
  assert.equal(tooFar.status, 400);
  assert.equal(tooFar.json.error, '开始时间需在5分钟到一年之内');
  // 非数字 → 400
  const notNum = await api('POST', '/api/posts', { ...base, title: 'R5非数字局', meet_at: '本周六 11:30' }, tokenA);
  assert.equal(notNum.status, 400);
  // 合法值入库并透传
  const at = Date.now() + 2 * 3600_000;
  const good = await api('POST', '/api/posts', { ...base, title: 'R5合法时间局', meet_at: at }, tokenA);
  assert.equal(good.status, 200);
  assert.equal(good.json.data.meet_at, at, 'meet_at stored as provided epoch ms');
  assert.equal(good.json.data.meet_repeat, null);
  // 周期局：repeat=weekly 豁免未来校验（锚点可以是过去）
  const weekly = await api('POST', '/api/posts', { ...base, title: 'R5每周局', meet_at: Date.now() - 7 * 86400000, meet_repeat: 'weekly' }, tokenA);
  assert.equal(weekly.status, 200, 'weekly repeat exempts future check');
  assert.equal(weekly.json.data.meet_repeat, 'weekly');
  // 周期局可以只有 repeat 没有 meet_at
  const weeklyOnly = await api('POST', '/api/posts', { ...base, title: 'R5纯周期局', meet_repeat: 'daily' }, tokenA);
  assert.equal(weeklyOnly.status, 200);
  assert.equal(weeklyOnly.json.data.meet_at, null);
  // 非法 repeat → 400
  const badRepeat = await api('POST', '/api/posts', { ...base, title: 'R5非法周期局', meet_repeat: 'monthly' }, tokenA);
  assert.equal(badRepeat.status, 400);
  // 编辑：合法新值生效；非法值 400
  const at2 = Date.now() + 3 * 3600_000;
  const edit = await api('PUT', `/api/posts/${good.json.data.id}`, { meet_at: at2 }, tokenA);
  assert.equal(edit.status, 200);
  assert.equal(edit.json.data.meet_at, at2);
  const badEdit = await api('PUT', `/api/posts/${good.json.data.id}`, { meet_at: Date.now() + 10_000 }, tokenA);
  assert.equal(badEdit.status, 400);
  assert.equal(badEdit.json.error, '开始时间需在5分钟到一年之内');
  // 创建/编辑 slice 一致性：meet_time 统一 ≤30、location_name ≤50（此前编辑路径 1000）
  const longEdit = await api('PUT', `/api/posts/${good.json.data.id}`, {
    meet_time: 'X'.repeat(31), location_name: 'Y'.repeat(51),
  }, tokenA);
  assert.equal(longEdit.status, 200);
  assert.equal(longEdit.json.data.meet_time.length, 30, 'meet_time edit clamps to 30 like create');
  assert.equal(longEdit.json.data.location_name.length, 50, 'location_name edit clamps to 50 like create');
});

test('R5-TS2 过期双轨 + join 入口时间守卫：meet_at+24h / repeat 永续 / NULL 维持14天', async () => {
  const { db } = await import('../src/db.js');
  const { runJobs } = await import('../src/jobs.js');
  const mk = async (title, body) => {
    const r = await api('POST', '/api/posts', { category: 'sports', title, content: 'x', city: '北京', ...body }, tokenA);
    assert.equal(r.status, 200);
    return r.json.data.id;
  };
  // ① 有 meet_at 无 repeat：活动过后 24h 才过期；入口守卫即刻拒绝新申请
  const pastId = await mk('R5已散场的局', { meet_at: Date.now() + 2 * 3600_000 });
  db.prepare('UPDATE posts SET meet_at = ? WHERE id = ?').run(Date.now() - 25 * 3600_000, pastId); // 回拨成已散场
  const join = await api('POST', `/api/posts/${pastId}/join`, { message: '散场后报名' }, tokenB);
  assert.equal(join.status, 400);
  assert.equal(join.json.error, '该搭局时间已过', 'join guard rejects posts whose meet_at passed 24h ago');
  assert.equal(runJobs().expired >= 1, true, 'past meet_at post expired by job');
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(pastId).status, 'expired');
  // 未过缓冲（活动过后 <24h）不过期
  const soonId = await mk('R5刚散场的局', { meet_at: Date.now() + 3600_000 });
  db.prepare('UPDATE posts SET meet_at = ? WHERE id = ?').run(Date.now() - 2 * 3600_000, soonId);
  runJobs();
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(soonId).status, 'open', 'within 24h grace not expired');
  // ② 周期局（repeat）永不过期——即使 meet_at 在过去、发布超 14 天
  const weeklyId = await mk('R5每周跑步局', { meet_at: Date.now() - 7 * 86400000, meet_repeat: 'weekly' });
  db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run(Date.now() - 20 * 86400000, weeklyId);
  runJobs();
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(weeklyId).status, 'open', 'repeat post never expires');
  // ③ 无 meet_at：维持 14 天规则
  const legacyId = await mk('R5无结构化时间局', {});
  db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run(Date.now() - 15 * 86400000, legacyId);
  runJobs();
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(legacyId).status, 'expired', 'no meet_at keeps 14-day rule');
});

test('R5-D1 schema 版本：user_version 落库为 1，jobs 每日 WAL checkpoint', async () => {
  const { db } = await import('../src/db.js');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1, 'user_version set after migrations');
  const { runJobs } = await import('../src/jobs.js');
  const summary = runJobs();
  assert.equal(typeof summary.checkpoint, 'boolean', 'runJobs exposes checkpoint subtask');
  // TRUNCATE 模式可用且幂等（WAL 收缩进主文件）
  assert.doesNotThrow(() => db.exec('PRAGMA wal_checkpoint(TRUNCATE);'));
});

test('R5-D1 迁移动态列：users 清单外的中间版本列迁移后保留（不再静默丢列）', async () => {
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dada-mig-'));
  const dbPath = path.join(dir, 'old.sqlite');
  // ① 子进程造一个"v2.7 时代 + 中间版本 ALTER 加过 loyalty 列"的老库（status CHECK 无 deleted）
  const seedOld = `
    import('node:sqlite').then(({ DatabaseSync }) => {
      const db = new DatabaseSync(${JSON.stringify(dbPath)});
      db.exec(\`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        nickname TEXT NOT NULL,
        avatar TEXT DEFAULT NULL,
        gender TEXT NOT NULL DEFAULT 'secret' CHECK (gender IN ('male','female','secret')),
        birth_year INTEGER DEFAULT NULL,
        city TEXT NOT NULL DEFAULT '',
        district TEXT DEFAULT '',
        school TEXT DEFAULT '',
        occupation TEXT DEFAULT '',
        mbti TEXT DEFAULT '',
        bio TEXT DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        verify_student INTEGER NOT NULL DEFAULT 0,
        verify_real INTEGER NOT NULL DEFAULT 0,
        verify_pending INTEGER NOT NULL DEFAULT 0,
        is_admin INTEGER NOT NULL DEFAULT 0,
        credit INTEGER NOT NULL DEFAULT 600,
        warnings INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      )\`);
      db.prepare("INSERT INTO users (username, password_hash, nickname, status, created_at, last_active_at) VALUES ('u1','h','n1','active',111,222)").run();
      db.exec('ALTER TABLE users ADD COLUMN loyalty INTEGER NOT NULL DEFAULT 5');
      db.prepare("UPDATE users SET loyalty = 9 WHERE username = 'u1'").run();
      db.close();
    });`;
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', seedOld], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('seeding old db failed'))));
  });
  // ② 子进程用当前代码跑迁移：loyalty 值 9 必须保真携带，且 user_version=1
  const migrate = `
    import(${JSON.stringify(path.join(ROOT, 'src', 'db.js'))}).then(({ db }) => {
      const row = db.prepare("SELECT loyalty, status FROM users WHERE username = 'u1'").get();
      if (!row || row.loyalty !== 9) { console.error('FAIL: loyalty 列丢失', row); process.exit(1); }
      if (db.prepare("SELECT COUNT(*) c FROM users").get().c !== 1) { console.error('FAIL: 行数不符'); process.exit(1); }
      if (db.prepare('PRAGMA user_version').get().user_version !== 1) { console.error('FAIL: user_version != 1'); process.exit(1); }
      console.log('dynamic column carried: loyalty=9');
      process.exit(0);
    });`;
  await new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', migrate], { env: { ...process.env, DADA_DB: dbPath }, stdio: 'inherit' });
    p.on('exit', (c) => {
      assert.equal(c, 0, 'migration must carry out-of-list column and set user_version');
      resolve();
    });
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('R5-D1 损坏库友好启动：拒绝启动并给出恢复指引（非裸崩溃）', async () => {
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dada-corrupt-'));
  const dbPath = path.join(dir, 'corrupt.sqlite');
  fs.writeFileSync(dbPath, Buffer.from('X' + 'A'.repeat(511))); // 破坏文件头 magic（SQLite -> XQLite...）
  const out = [];
  await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
      env: { ...process.env, DADA_DB: dbPath, DADA_PORT: '3998' },
    });
    p.stdout.on('data', (d) => out.push(String(d)));
    p.stderr.on('data', (d) => out.push(String(d)));
    p.on('exit', (c) => { assert.equal(c, 1, 'corrupt db must exit(1)'); resolve(); });
  });
  const text = out.join('');
  assert.ok(text.includes('数据库文件可能已损坏'), 'must explain corruption');
  assert.ok(text.includes('备份'), 'must point to backup recovery');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log('\n✅ 全部 API 测试通过');