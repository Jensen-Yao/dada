// 造一条演示会话（含安全提示与消息），用于截图
const BASE = 'http://localhost:3000/api';
const j = (method, path, body, token) => fetch(BASE + path, {
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json());

async function login(username) {
  const r = await j('POST', '/auth/login', { username, password: '123456' });
  if (!r.ok) throw new Error('login fail ' + username);
  return r.data.token;
}

const tian = await login('xiaoyu');
const posts = await j('GET', '/posts?category=food&city=北京');
const pid = posts.data.list[0].id;
const post = await j('GET', `/posts/${pid}`);

// 用另一个用户申请加入该局 → 组局者通过 → 建会话
const reg = await j('POST', '/auth/register', { username: 'demo_mate', password: '123456', nickname: '栗子', gender: 'female', city: '北京' });
let mate;
if (reg.ok) mate = reg.data;
else mate = await j('POST', '/auth/login', { username: 'demo_mate', password: '123456' }).then((r) => r.data);
const tm = mate.token;

if (!post.my_join) {
  await j('POST', `/posts/${pid}/join`, { message: '我也超想去！周六全天有空，还能帮忙占座～' }, tm);
  const joins = await j('GET', `/posts/${pid}/joins`, null, tian);
  const jid = joins.data.find((x) => x.user.id === mate.user.id).id;
  await j('POST', `/posts/${pid}/joins/${jid}/approve`, { approve: true }, tian);
}

const conv = await j('POST', '/chat/conv', { user_id: mate.user.id, post_id: pid }, tian);
const convId = conv.data.id;

// 通过 WS 发两条消息
import WebSocket from '/opt/.interval/dada/server/node_modules/ws/index.js';
await new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://localhost:3000/ws');
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'auth', token: tm }));
    setTimeout(() => ws.send(JSON.stringify({ type: 'chat', conv_id: convId, content: '周六见！顺便***聊聊？' })), 300);
    setTimeout(() => ws.send(JSON.stringify({ type: 'chat', conv_id: convId, content: '好呀好呀，几点在五道口地铁口碰面？' })), 800);
  });
  ws.on('error', reject);
  setTimeout(() => { ws.close(); resolve(); }, 1600);
});
console.log('conv ready:', convId);
