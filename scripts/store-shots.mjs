// 商店上架截图生成：App 内真实页面 → 顶部说明条 + 浅色包装 → 6.5/5.5 寸成品 PNG
// 用法：
//   node scripts/store-shots.mjs                 # 默认 6.5 寸（1284×2778），5 张
//   node scripts/store-shots.mjs --size 5.5     # 5.5 寸（1242×2208）
//   node scripts/store-shots.mjs --raw          # 额外输出无包装原图（1170×2532，390×844@3x，国内商店用）
//   node scripts/store-shots.mjs --size both --raw
// 输出：docs/release/store-shots/
// 说明：6.5 寸逻辑分辨率 390×844 @3x 拍摄（1170×2532），再由 chromium 合成到 1284×2778 画布
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXEC = '/home/lzg/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'release', 'store-shots');
const PORT = parseInt(process.env.DADA_SHOTS_PORT || '3800');
const BASE = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const has = (s) => args.includes(s);
const sizeArg = has('--size') ? args[args.indexOf('--size') + 1] : '6.5';
const SIZES = sizeArg === 'both' ? ['6.5', '5.5'] : [sizeArg === '5.5' ? '5.5' : '6.5'];
const RAW = has('--raw');
// 设备像素画布；合成页以 2x 缩放渲染（CSS 视口 = 画布 / 2）
const CANVAS = { '6.5': { w: 1284, h: 2778 }, '5.5': { w: 1242, h: 2208 } };
// 每屏顶部说明条：大字 + 小字（面向商店首屏卖点）
const SHOTS = [
  { name: 'square', url: '/#/square', account: null, big: '找到你的搭子', small: '饭搭 · 学习搭 · 运动搭 · 旅行搭，万物皆可搭' },
  { name: 'post', url: '/#/post/1', account: null, big: '一个搭局，组齐同好', small: '申请 · 审批 · 满员自动关闭，组队就是快' },
  { name: 'chat', url: 'CONV', account: { username: 'xiaoyu', password: '123456' }, big: '安心聊，放心见', small: '首条安全提示 · 导流打码 · 一键拉黑' },
  { name: 'me', url: '/#/me', account: { username: 'xiaoyu', password: '123456' }, big: '搭力值，让靠谱看得见', small: '搭后互评沉淀搭子履历，信用高分先曝光' },
  { name: 'publish', url: '/#/publish', account: { username: 'xiaoyu', password: '123456' }, big: '一分钟发起搭局', small: '时间地点人数 AA 方式，写得明明白白' },
];

const run = (cmd, a, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, a, { stdio: 'inherit', ...opts });
  p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exit ${c}`))));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/meta`); if (r.ok) return; } catch { /* 未起 */ }
    await sleep(500);
  }
  throw new Error('server 未在 30s 内就绪');
}

// ---------- 启动本地服务（自给自足，不依赖外部已开的服务） ----------
const dbPath = path.join(ROOT, 'server', 'data', 'dada.sqlite');
if (!fs.existsSync(dbPath)) {
  console.log('seed 演示数据...');
  await run('node', ['src/seed.js'], { cwd: path.join(ROOT, 'server') });
}
const server = spawn('node', ['src/index.js'], {
  cwd: path.join(ROOT, 'server'),
  env: { ...process.env, DADA_PORT: String(PORT) },
  stdio: 'ignore',
});
try {
  await waitServer();
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--disable-gpu'] });

  // ---------- 第一步：390×844 @3x 拍摄 App 原图 ----------
  const appShots = {}; // name -> {base64, w, h}
  for (const s of SHOTS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (s.account) {
      const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s.account) }).then((r) => r.json());
      if (res.ok) await page.addInitScript(([t, u]) => { localStorage.setItem('dada_token', t); localStorage.setItem('dada_user', JSON.stringify(u)); }, [res.data.token, res.data.user]);
    }
    let url = s.url;
    if (url === 'CONV') {
      // 用真实会话 id（seed：xiaoyu ↔ meimei 日料帖）
      const token = (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s.account) }).then((r) => r.json())).data.token;
      const convs = await fetch(`${BASE}/api/chat/convs`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      url = `/#/conv/${convs.data?.[0]?.id || 1}`;
    }
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const buf = await page.screenshot({ type: 'png' });
    appShots[s.name] = buf.toString('base64');
    if (errors.length) console.log(`⚠️ ${s.name} 页面JS错误: ${errors.join(' | ')}`);
    if (RAW) fs.writeFileSync(path.join(OUT, `raw-${s.name}.png`), buf);
    await ctx.close();
    console.log('shot:', s.name);
  }

  // ---------- 第二步：合成 6.5 / 5.5 寸成品（顶部说明条 + 浅色包装） ----------
  for (const size of SIZES) {
    const { w: DW, h: DH } = CANVAS[size];
    const W = DW / 2, H = DH / 2; // CSS 视口（DSF 2 → 正好 DW×DH 设备像素）
    const small = size === '5.5';
    const ratio = 2532 / 1170; // App 原图高宽比
    const headH = small ? 118 : 148;           // 说明条区高度（CSS px）
    const shotW = Math.min(small ? 470 : 560, (H - headH - 14) / ratio); // 装得下就不裁切
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const s of SHOTS) {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { width:${W}px; height:${H}px; overflow:hidden;
          background: linear-gradient(175deg,#FFF1E7 0%,#FFF9F5 46%,#FBE9DD 100%);
          font-family:-apple-system,'PingFang SC','Noto Sans CJK SC','Source Han Sans SC','Microsoft YaHei',sans-serif;
          display:flex; flex-direction:column; align-items:center; }
        .brand { margin-top:${small ? 16 : 20}px; font-size:15px; letter-spacing:4px; color:#C08A6E; font-weight:600; }
        .big { margin-top:6px; font-size:${small ? 40 : 46}px; font-weight:900; color:#F05A24; }
        .small { margin-top:8px; font-size:${small ? 16 : 17}px; color:#967561; }
        .shot { margin-top:${small ? 12 : 16}px; width:${shotW}px; background:#fff; border-radius:26px;
          border:1px solid #F3DCCE; box-shadow:0 16px 44px rgba(240,90,36,.16); overflow:hidden; }
        .shot img { display:block; width:100%; }
      </style></head><body>
        <div class="brand">搭搭 · 万物皆可搭</div>
        <div class="big">${s.big}</div>
        <div class="small">${s.small}</div>
        <div class="shot"><img src="data:image/png;base64,${appShots[s.name]}"></div>
      </body></html>`;
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      const file = path.join(OUT, `${size}-${s.name}.png`);
      await page.screenshot({ path: file, type: 'png' });
      console.log(`store-shot: ${size}-${s.name}.png (${DW}x${DH})`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log('ALL DONE →', OUT);
} finally {
  server.kill('SIGTERM');
}
