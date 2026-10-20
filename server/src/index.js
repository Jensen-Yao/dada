import express from 'express';
import http from 'node:http';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { postsRouter } from './routes/posts.js';
import { chatRouter, handleChatMessage } from './routes/chat.js';
import { miscRouter } from './routes/misc.js';
import { adminRouter } from './routes/admin.js';
import { safetyRouter } from './routes/safety.js';
import { startJobs } from './jobs.js'; // VD-02 定时任务：过期 / 互评提醒 / 老搭子推送
import { getAuthUser } from './util.js';
import { db, now } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.DADA_PORT || 3000);

app.use(cors());
// R2性能建议：文本资产gzip压缩（JS/CSS/JSON -70%），图片已是压缩格式跳过
app.use(compression({ filter: (req, res) => !req.path.startsWith('/img/') && !req.path.startsWith('/uploads/') && compression.filter(req, res) }));
app.use(express.json({ limit: '1mb' }));

// 静态资源：头像上传 & 前端构建产物
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
const WEB_DIR = path.join(__dirname, '..', '..', 'web', 'public');
app.use('/uploads', express.static(UPLOAD_DIR));
if (fs.existsSync(WEB_DIR)) {
  app.use(express.static(WEB_DIR, {
    extensions: ['html'],
    // /img/* 文件名即版本（封面/头像为内容寻址静态资产），长缓存利于 PWA 与桌面端加载（BE-05）
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}img${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    },
  }));
}

const api = express.Router();
api.use('/auth', authRouter);
api.use('/users', usersRouter);
api.use('/posts', postsRouter);
api.use('/chat', chatRouter);
api.use('/admin', adminRouter);
api.use('/safety', safetyRouter);
api.use('/', miscRouter);
app.use('/api', api);

// [API-2] 未匹配的 /api/* 返回 JSON 404：此前 SPA fallback 正则把 /api 排除后无人接盘，
// 落到 Express 默认 HTML 404，第三方 JSON.parse 直接失败、无法区分"路径写错"与"资源不存在"。
// 位置约束：必须挂在全部 api 子路由之后、SPA catchall 之前。
app.use('/api', (_req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// SPA fallback（除 /api 与 /uploads 外全部回退到 index.html）
if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIR, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  // multer 上传错误（S11/A12）：类型不符/超限是用户输入问题，映射为 400 而非 500（避免污染错误监控）
  if (err && (err.name === 'MulterError' || err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件过大' : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? '文件数量超限' : err.message;
    return res.status(400).json({ error: `上传失败：${msg}` });
  }
  console.error('[dada] error:', err.message);
  res.status(err.status || 500).json({ error: err.status ? err.message : '服务器开小差了，请稍后再试' });
});

// ---------- WebSocket：实时聊天 ----------
const wss = new WebSocketServer({ server, path: '/ws' });
const onlineSockets = new Map(); // userId -> Set<ws>
// WS 加固（S5/S6/A2/A5）：连接上限 / 单用户上限 / 每连接 chat 帧限流
const WS_MAX_CLIENTS = 2000;   // 总连接上限（防 fd/内存无成本耗尽）
const WS_MAX_PER_USER = 5;     // 单用户并发连接上限（防单账号多连接放大）
const WS_CHAT_PER_SEC = 5;     // 每连接每秒最多 5 帧 chat（防单连接灌库/刷爆对端通知）

function removeSocket(uid, ws) {
  const set = onlineSockets.get(uid);
  if (!set) return;
  set.delete(ws);
  if (!set.size) onlineSockets.delete(uid);
}

function sendToUser(userId, payload) {
  const set = onlineSockets.get(userId);
  if (!set) return false;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(data);
  }
  return set.size > 0;
}

export function notifyWS(userId, type, payload) {
  sendToUser(userId, { type, ...payload });
}

wss.on('connection', (ws, req) => {
  // 总连接上限（A5）：超过即关闭新连（4003=服务端策略拒绝）
  if (wss.clients.size > WS_MAX_CLIENTS) {
    ws.close(4003, '连接数已达上限');
    return;
  }
  let user = null;
  ws.isAlive = true;      // 服务端心跳探活标记（A5）
  ws.missedPings = 0;
  ws.chatTimes = [];      // chat 帧限流滑动窗口（S5）
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'auth') {
      // 重复 auth（S6）：切换身份前先从旧身份集合移除本 socket——
      // 否则 sendToUser(旧uid) 会继续向"已换身份"的连接推送旧用户的全量实时消息（静默窃听）。
      if (user) removeSocket(user.id, ws);
      req.headers.authorization = `Bearer ${msg.token}`;
      user = getAuthUser(req);
      if (user) {
        // 单用户连接上限（A5）：超出拒绝本条 auth（4001 契约=客户端不自动重连）
        const set = onlineSockets.get(user.id);
        if (set && set.size >= WS_MAX_PER_USER) {
          ws.send(JSON.stringify({ type: 'auth_fail', error: '连接数过多' }));
          ws.close(4001, '连接数过多');
          user = null;
          return;
        }
        if (!onlineSockets.has(user.id)) onlineSockets.set(user.id, new Set());
        onlineSockets.get(user.id).add(ws);
        db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now(), user.id);
        ws.send(JSON.stringify({ type: 'auth_ok', user_id: user.id }));
      } else {
        // 认证失败即断开（A2）：此前只回 auth_fail 不关连接，后续消息被静默丢弃（用户消息蒸发）。
        // close code 4001 契约：前端收到 4001 不自动重连（token 已失效，需重新登录）。
        ws.send(JSON.stringify({ type: 'auth_fail' }));
        ws.close(4001, '认证失败');
      }
      return;
    }
    if (!user) return;
    if (msg.type === 'chat') {
      // 每秒 chat 帧限流（S5）：超 5 帧/秒直接断开（4003），防止单连接无限灌库/刷爆对端
      const t = Date.now();
      ws.chatTimes = ws.chatTimes.filter((ts) => t - ts < 1000);
      if (ws.chatTimes.length >= WS_CHAT_PER_SEC) {
        ws.close(4003, '发送过快');
        return;
      }
      ws.chatTimes.push(t);
      const result = handleChatMessage(user, parseInt(msg.conv_id), msg.content);
      if (result.error) {
        ws.send(JSON.stringify({ type: 'chat_error', error: result.error }));
        return;
      }
      const m = result.message;
      const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(m.conv_id);
      const otherId = conv.user_a === user.id ? conv.user_b : conv.user_a;
      const outgoing = { type: 'chat', message: { id: m.id, conv_id: m.conv_id, sender_id: m.sender_id, type: m.type, content: m.content, created_at: m.created_at } };
      sendToUser(user.id, outgoing);
      if (otherId !== user.id) sendToUser(otherId, outgoing);
      // 首条消息后的安全提示（handleChatMessage 中已插入 safety 消息，这里推送给双方）
      const safety = db.prepare('SELECT * FROM messages WHERE conv_id = ? AND type = ? ORDER BY id DESC LIMIT 1').get(m.conv_id, 'safety');
      if (safety && safety.id > m.id) {
        const sOut = { type: 'chat', message: { id: safety.id, conv_id: safety.conv_id, sender_id: safety.sender_id, type: 'safety', content: safety.content, created_at: safety.created_at } };
        sendToUser(user.id, sOut);
        sendToUser(otherId, sOut);
      }
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });
  ws.on('close', () => {
    // 重复 auth 已在切换时清理旧身份集合，这里只需移除当前身份
    if (user) removeSocket(user.id, ws);
  });
});

// 服务端主动心跳（A5 改造）：每 30s 对所有连接发协议级 ping，连续 2 次未收到 pong 判定半开/死连接并
// terminate()。此前只清理 readyState===3（本就触发 close 事件），对 NAT 超时/进程消失的"幽灵在线"零探测。
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    if (!ws.isAlive) {
      ws.missedPings++;
      if (ws.missedPings >= 2) {
        ws.terminate();
        continue;
      }
    } else {
      ws.missedPings = 0;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* 连接已断 */ }
  }
}, 30000).unref();

startJobs(); // VD-02：定时任务随服务启动（interval 已 unref，不阻止退出）

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dada] 搭搭 server running at http://localhost:${PORT}`);
  console.log(`[dada] WebSocket ready at ws://localhost:${PORT}/ws`);
});
