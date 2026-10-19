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

// SPA fallback（除 /api 与 /uploads 外全部回退到 index.html）
if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIR, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error('[dada] error:', err.message);
  res.status(err.status || 500).json({ error: err.status ? err.message : '服务器开小差了，请稍后再试' });
});

// ---------- WebSocket：实时聊天 ----------
const wss = new WebSocketServer({ server, path: '/ws' });
const onlineSockets = new Map(); // userId -> Set<ws>

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
  let user = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'auth') {
      req.headers.authorization = `Bearer ${msg.token}`;
      user = getAuthUser(req);
      if (user) {
        if (!onlineSockets.has(user.id)) onlineSockets.set(user.id, new Set());
        onlineSockets.get(user.id).add(ws);
        db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now(), user.id);
        ws.send(JSON.stringify({ type: 'auth_ok', user_id: user.id }));
      } else {
        ws.send(JSON.stringify({ type: 'auth_fail' }));
      }
      return;
    }
    if (!user) return;
    if (msg.type === 'chat') {
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
    if (user && onlineSockets.has(user.id)) {
      onlineSockets.get(user.id).delete(ws);
      if (!onlineSockets.get(user.id).size) onlineSockets.delete(user.id);
    }
  });
});

// 心跳清理死连接
setInterval(() => {
  for (const set of onlineSockets.values()) {
    for (const ws of set) if (ws.readyState === 3) set.delete(ws);
  }
}, 30000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dada] 搭搭 server running at http://localhost:${PORT}`);
  console.log(`[dada] WebSocket ready at ws://localhost:${PORT}/ws`);
});
