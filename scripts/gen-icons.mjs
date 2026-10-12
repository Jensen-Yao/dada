// APP-05：品牌图标 SVG → PWA PNG（playwright-core + 本机 chromium 截图，零新原生依赖）
// 输出 web/public/img/icons/：192.png / 512.png / maskable-512.png / apple-touch-icon-180.png
// 并同步产出规格书 APP-01/APP-04 引用的别名：icon-192.png / icon-512.png / icon-180.png
// 底图为 img/logo.svg（品牌橙渐变圆角方块 + 搭手抽象形），衬同色品牌渐变实现满幅（full-bleed）；
// maskable 版内容缩至 80% 安全区居中。
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LOGO = path.join(ROOT, 'web', 'public', 'img', 'logo.svg');
const OUT = path.join(ROOT, 'web', 'public', 'img', 'icons');
const EXEC = process.env.CHROME_PATH || '/home/lzg/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome';

fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(LOGO)) {
  console.error('logo.svg 不存在：', LOGO);
  process.exit(1);
}

const logoB64 = fs.readFileSync(LOGO).toString('base64');
// 与 logo.svg 同一条品牌渐变，作为满幅底色（补齐圆角四角）
const BG = 'linear-gradient(135deg, #FF8A5C 0%, #FF7A45 55%, #F05A24 100%)';

function pageHTML(size, scale) {
  const inner = Math.round(size * scale);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent; }
    #icon { width: ${size}px; height: ${size}px; background: ${BG};
      display: flex; align-items: center; justify-content: center; overflow: hidden; }
    #icon img { width: ${inner}px; height: ${inner}px; display: block; }
  </style></head><body><div id="icon"><img src="data:image/svg+xml;base64,${logoB64}"></div></body></html>`;
}

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });

async function render(size, name, scale = 1) {
  await page.setContent(pageHTML(size, scale), { waitUntil: 'networkidle' });
  await page.locator('#icon').screenshot({ path: path.join(OUT, name) });
  console.log('icon:', name, `${size}x${size}`, scale < 1 ? `(safe ${Math.round(scale * 100)}%)` : '');
}

// 任务指定产物
await render(512, '512.png');
await render(512, 'maskable-512.png', 0.8); // maskable：内容缩至 80% 安全区居中
await render(192, '192.png');
await render(180, 'apple-touch-icon-180.png');
// 规格书 APP-01 manifest / APP-04 引用的文件名（由 FE-B 消费）
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(180, 'icon-180.png');

await browser.close();
console.log('DONE ->', OUT);
