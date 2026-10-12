import { chromium } from 'playwright-core';
const EXEC = '/home/lzg/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome';
const BASE = 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=2'] });
async function shot(name, url, account) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  if (account) {
    const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account) }).then((r) => r.json());
    await page.addInitScript(([token, user]) => { localStorage.setItem('dada_token', token); localStorage.setItem('dada_user', JSON.stringify(user)); }, [res.data.token, res.data.user]);
  }
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/tmp/dada-shots/${name}.png` });
  await ctx.close();
  console.log('shot:', name);
}
const acc = { username: 'xiaoyu', password: '123456' };
await shot('15-conv', '/#/conv/1', acc);
await shot('07-chat-list', '/#/chat', acc);
await browser.close();
console.log('DONE');
