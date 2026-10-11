// 搭搭 App 页面截图：用于视觉走查
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const EXEC = '/home/lzg/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome';
const BASE = 'http://localhost:3000';
const OUT = '/tmp/dada-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXEC,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=2'],
});

async function shot(name, url, { setup } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  // 注入登录态（xiaoyu 演示账号）
  if (setup !== 'guest') {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'xiaoyu', password: '123456' }),
    }).then((r) => r.json());
    if (res.ok) {
      await page.addInitScript(([token, user]) => {
        localStorage.setItem('dada_token', token);
        localStorage.setItem('dada_user', JSON.stringify(user));
      }, [res.data.token, res.data.user]);
    }
  }
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
  console.log('shot:', name);
}

await shot('01-login', '/#/login', { setup: 'guest' });
await shot('02-square', '/#/square', { setup: 'guest' });
await shot('03-square-cat', '/#/square?category=food', { setup: 'guest' });
await shot('04-post-detail', '/#/post/1', { setup: 'guest' });
await shot('05-publish', '/#/publish');
await shot('06-discover', '/#/discover');
await shot('07-chat-list', '/#/chat');
await shot('08-me', '/#/me');
await shot('09-user-profile', '/#/user/2');
await shot('10-notifications', '/#/notifications');
await shot('11-safety', '/#/safety');
await shot('12-myposts', '/#/myposts');
await shot('13-ratings', '/#/ratings');
await shot('14-admin', '/#/admin'); // xiaoyu 非管理员 → 会显示无权访问？改用admin登录

// admin 后台单独用管理员账号截
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  }).then((r) => r.json());
  await page.addInitScript(([token, user]) => {
    localStorage.setItem('dada_token', token);
    localStorage.setItem('dada_user', JSON.stringify(user));
  }, [res.data.token, res.data.user]);
  await page.goto(BASE + '/#/admin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/14-admin.png` });
  await ctx.close();
  console.log('shot: 14-admin (admin)');
}

// 聊天会话页：造一条会话（xiaoyu 与 runner 在其帖子下有评论互动，但需要join关系——用e2e留下的会话）
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'xiaotian_e2e', password: '123456' }),
  }).then((r) => r.json());
  if (res.ok) {
    await page.addInitScript(([token, user]) => {
      localStorage.setItem('dada_token', token);
      localStorage.setItem('dada_user', JSON.stringify(user));
    }, [res.data.token, res.data.user]);
    const convs = await fetch(`${BASE}/api/chat/convs`, { headers: { Authorization: `Bearer ${res.data.token}` } }).then((r) => r.json());
    if (convs.ok && convs.data.length) {
      await page.goto(BASE + '/#/conv/' + convs.data[0].id, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/15-conv.png` });
      console.log('shot: 15-conv');
    }
  }
  await ctx.close();
}

await browser.close();
console.log('ALL DONE ->', OUT);
