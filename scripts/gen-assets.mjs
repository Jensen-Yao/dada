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

// ---------- 封面：分类主题渐变插画（480×640 竖版 3:4，每分类 2 套配色变体） ----------
// 变体1 保持原文件名 {key}.svg（存量 posts.images 已引用，不可改名，C5）；
// 变体2 为 {key}-2.svg：同构图、不同渐变配色、装饰 emoji 位置镜像（BE-01）。
const COVERS = [
  // [key, 主emoji, 变体1渐变 c1/c2, 变体2渐变 c3/c4, 装饰emoji]
  ['food', '🍜', '#FFB199', '#FF7E5F', '#F6D365', '#FDA085', '🍲'],
  ['sports', '🏃', '#FFE259', '#FFA751', '#FF9A9E', '#FAD0C4', '💪'],
  ['study', '📚', '#A8CABA', '#517FA4', '#A1C4FD', '#C2E9FB', '✏️'],
  ['travel', '🏔️', '#89F7FE', '#66A6FF', '#43E97B', '#38F9D7', '🧭'],
  ['live', '🎤', '#F953C6', '#B91D73', '#F093FB', '#F5576C', '🎸'],
  ['game', '🎮', '#4E65FF', '#92EFFD', '#B721FF', '#21D4FD', '🕹️'],
  ['movie', '🎬', '#FA709A', '#FEE140', '#A18CD1', '#FBC2EB', '🍿'],
  ['photo', '📷', '#8EC5FC', '#E0C3FC', '#FFECD2', '#FCB69F', '🌆'],
  ['pet', '🐕', '#F6D365', '#FDA085', '#FFDEE9', '#B5FFFC', '🐾'],
  ['coffee', '☕', '#D4A373', '#FAEDCD', '#EACDA3', '#D6AE7B', '🥐'],
  ['shopping', '🛍️', '#FF9A9E', '#FECFEF', '#FC5C7D', '#6A82FB', '💝'],
  ['boardgame', '🎲', '#BFF098', '#6FD6FF', '#FF9966', '#FF5E62', '🃏'],
  ['commute', '🚗', '#96C93D', '#00B09B', '#7F7FD5', '#86A8E7', '🛣️'],
  ['other', '✨', '#C79081', '#DFA579', '#FBC2EB', '#A6C1EE', '🌈'],
];
const CW = 480;
const CH = 640; // 3:4 竖版，适配瀑布流
function coverSvg(c1, c2, emoji, deco, mirror) {
  const mx = (x) => (mirror ? CW - x : x);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="${CW}" height="${CH}" fill="url(#g)"/>
  <circle cx="${mx(396)}" cy="92" r="104" fill="#ffffff" opacity="0.16"/>
  <circle cx="${mx(84)}" cy="536" r="132" fill="#ffffff" opacity="0.12"/>
  <circle cx="${mx(430)}" cy="564" r="44" fill="#ffffff" opacity="0.18"/>
  <text x="${CW / 2}" y="${CH / 2}" font-size="176" text-anchor="middle" dominant-baseline="central">${emoji}</text>
  <text x="${mx(408)}" y="92" font-size="56" text-anchor="middle" dominant-baseline="central" opacity="0.9">${deco}</text>
  <text x="${mx(76)}" y="540" font-size="46" text-anchor="middle" dominant-baseline="central" opacity="0.85">${deco}</text>
</svg>`;
}
let coverCount = 0;
for (const [key, emoji, c1, c2, c3, c4, deco] of COVERS) {
  fs.writeFileSync(path.join(IMG_DIR, 'covers', `${key}.svg`), coverSvg(c1, c2, emoji, deco, false));
  fs.writeFileSync(path.join(IMG_DIR, 'covers', `${key}-2.svg`), coverSvg(c3, c4, emoji, deco, true));
  coverCount += 2;
}
console.log(`covers: ${coverCount} (${COVERS.length} 分类 x 2 变体)`);
console.log('DONE ->', IMG_DIR);
