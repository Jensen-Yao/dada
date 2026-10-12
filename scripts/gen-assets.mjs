// 生成本地图片资产：用户卡通头像 + 搭局分类封面图（纯SVG，零外部依赖）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, '..', 'web', 'public', 'img');
fs.mkdirSync(path.join(IMG_DIR, 'avatars'), { recursive: true });
fs.mkdirSync(path.join(IMG_DIR, 'covers'), { recursive: true });

// ---------- 头像：渐变底 + emoji 形象 ----------
const AVATARS = [
  ['u1', '🐱', '#FF9A62', '#FF6B8A'],
  ['u2', '🦊', '#FFC46B', '#FF8A5C'],
  ['u3', '🐼', '#8EC5FC', '#A78BFA'],
  ['u4', '🐸', '#6EE7B7', '#34D399'],
  ['u5', '🐰', '#F9A8D4', '#F472B6'],
  ['u6', '🐯', '#FDBA74', '#F97316'],
  ['u7', '🦉', '#A5B4FC', '#818CF8'],
  ['u8', '🐨', '#93C5FD', '#60A5FA'],
  ['u9', '🦋', '#C4B5FD', '#A78BFA'],
  ['u10', '🌟', '#FDE68A', '#FBBF24'],
];
for (const [name, emoji, c1, c2] of AVATARS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="240" height="240" fill="url(#g)"/>
  <circle cx="34" cy="42" r="52" fill="#ffffff" opacity="0.18"/>
  <circle cx="208" cy="200" r="66" fill="#ffffff" opacity="0.14"/>
  <circle cx="196" cy="34" r="20" fill="#ffffff" opacity="0.22"/>
  <text x="120" y="128" font-size="104" text-anchor="middle" dominant-baseline="central">${emoji}</text>
</svg>`;
  fs.writeFileSync(path.join(IMG_DIR, 'avatars', `${name}.svg`), svg);
}
console.log(`avatars: ${AVATARS.length}`);

// ---------- 封面：分类主题渐变插画 ----------
const COVERS = [
  ['food', '🍜', '#FFB199', '#FF7E5F', '🍲'],
  ['sports', '🏃', '#FFE259', '#FFA751', '💪'],
  ['study', '📚', '#A8CABA', '#517FA4', '✏️'],
  ['travel', '🏔️', '#89F7FE', '#66A6FF', '🧭'],
  ['live', '🎤', '#F953C6', '#B91D73', '🎸'],
  ['game', '🎮', '#4E65FF', '#92EFFD', '🕹️'],
  ['movie', '🎬', '#FA709A', '#FEE140', '🍿'],
  ['photo', '📷', '#8EC5FC', '#E0C3FC', '🌆'],
  ['pet', '🐕', '#F6D365', '#FDA085', '🐾'],
  ['coffee', '☕', '#D4A373', '#FAEDCD', '🥐'],
  ['shopping', '🛍️', '#FF9A9E', '#FECFEF', '💝'],
  ['boardgame', '🎲', '#BFF098', '#6FD6FF', '🃏'],
  ['commute', '🚗', '#96C93D', '#00B09B', '🛣️'],
  ['other', '✨', '#C79081', '#DFA579', '🌈'],
];
for (const [key, emoji, c1, c2, deco] of COVERS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <circle cx="540" cy="60" r="110" fill="#ffffff" opacity="0.16"/>
  <circle cx="80" cy="310" r="140" fill="#ffffff" opacity="0.12"/>
  <circle cx="600" cy="300" r="46" fill="#ffffff" opacity="0.18"/>
  <text x="320" y="185" font-size="170" text-anchor="middle" dominant-baseline="central">${emoji}</text>
  <text x="556" y="76" font-size="60" text-anchor="middle" dominant-baseline="central" opacity="0.9">${deco}</text>
  <text x="92" y="292" font-size="48" text-anchor="middle" dominant-baseline="central" opacity="0.85">${deco}</text>
</svg>`;
  fs.writeFileSync(path.join(IMG_DIR, 'covers', `${key}.svg`), svg);
}
console.log(`covers: ${COVERS.length}`);
console.log('DONE ->', IMG_DIR);
