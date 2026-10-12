// 集成验证截图：移动端 + 桌面端双视口
import { chromium } from 'playwright-core';
const EXEC = '/home/lzg/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome';
const BASE = 'http://localhost:3000';
const OUT = '/tmp/dada-shots';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=2'] });

async function shot(name, url, { w = 390, h = 844, account = null, mobile = true, fullPage = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (account) {
    const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account) }).then((r) => r.json());
    if (res.ok) await page.addInitScript(([token, user]) => { localStorage.setItem('dada_token', token); localStorage.setItem('dada_user', JSON.stringify(user)); }, [res.data.token, res.data.user]);
  }
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  if (errors.length) console.log(`⚠️ ${name} JS错误:`, errors.join(' | '));
  await ctx.close();
  console.log('shot:', name);
}

const yu = { username: 'xiaoyu', password: '123456' };

// 移动端
await shot('m-square', '/#/square', {});
await shot('m-post', '/#/post/1', {});
await shot('m-me', '/#/me', { account: yu });
await shot('m-discover', '/#/discover', {});
await shot('m-conv', '/#/conv/1', { account: yu });
await shot('m-publish', '/#/publish', { account: yu });
await shot('m-login', '/#/login', {});

// 桌面端
await shot('d-square', '/#/square', { w: 1366, h: 900, mobile: false });
await shot('d-post', '/#/post/1', { w: 1366, h: 900, mobile: false });
await shot('d-me', '/#/me', { w: 1366, h: 900, account: yu, mobile: false });
await shot('d-conv', '/#/conv/1', { w: 1366, h: 900, account: yu, mobile: false });
await shot('d-chat', '/#/chat', { w: 1366, h: 900, account: yu, mobile: false });

await browser.close();
console.log('ALL DONE');
