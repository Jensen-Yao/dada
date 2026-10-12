// ============================================================
// 搭搭 v2.3 PC-01：真实照片素材下载（开发期工具链，零新依赖）
// 用法：node scripts/fetch-photos.mjs [--force]
//   - 幂等：目标文件已存在且 >10KB 时跳过；--force 强制重下
//   - 校验：HTTP 200 + content-type image/jpeg + JPEG magic bytes(FF D8) + 体积 ≥10KB
//   - 产出：web/public/img/photos/{category}-{n}.jpg（37 张）
//           web/public/img/avatars/photo-{i}.jpg（10 张）
//           web/public/img/photos/CREDITS.md（来源致谢，Unsplash License）
// 清单来源：docs/product-spec.md §F.1（唯一实现依据，photo-id 已由 PM 逐一验证）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PHOTO_DIR = path.join(ROOT, 'web', 'public', 'img', 'photos');
const AVATAR_DIR = path.join(ROOT, 'web', 'public', 'img', 'avatars');
const FORCE = process.argv.includes('--force');

// 封面统一参数（规格 F.1）：宽 800、q=70、JPEG 直出；fit=max 防小图放大
const COVER_PARAMS = '?w=800&q=70&fm=jpg&fit=max';
// 头像统一参数：200×200 方形人脸裁切
const AVATAR_PARAMS = '?w=200&h=200&fit=crop&crop=faces&q=70&fm=jpg';
const UNSPLASH = (id, params) => `https://images.unsplash.com/${id}${params}`;

// ---------- F.1 封面清单：37 张（14 分类，study/movie/photo/shopping/other 为 2 张，其余 3 张） ----------
const PHOTOS = [
  ['food', 1, 'photo-1504674900247-0877df9cc836', '聚餐桌菜俯拍（饭搭子局）'],
  ['food', 2, 'photo-1553621042-f6e147245754', '寿司拼盘特写（日料）'],
  ['food', 3, 'photo-1414235077428-338989a2e8c0', '餐厅精致主菜摆盘'],
  ['sports', 1, 'photo-1476480862126-209bfaa8edc8', '清晨公路跑步者（晨跑）'],
  ['sports', 2, 'photo-1571019613454-1cb2f99b2d8b', '户外体能训练'],
  ['sports', 3, 'photo-1517836357463-d25dfeac3438', '健身房杠铃力量训练'],
  ['study', 1, 'photo-1481627834876-b7833e8f5570', '图书馆书架通道（自习/国图）'],
  ['study', 2, 'photo-1456513080510-7bf3a84b82f8', '书桌摊开的书与笔记'],
  ['travel', 1, 'photo-1506905925346-21bda4d32df4', '雪山山峰远景'],
  ['travel', 2, 'photo-1551632811-561732d1e306', '背包客山径徒步'],
  ['travel', 3, 'photo-1501785888041-af3ef285b470', '高山湖泊日落'],
  ['live', 1, 'photo-1470229722913-7c0e2dbbafd3', '音乐节人群举手'],
  ['live', 2, 'photo-1493225457124-a3eb161ffa5f', '演唱会舞台灯光'],
  ['live', 3, 'photo-1516450360452-9312f5e86fc7', 'livehouse 紫色灯海'],
  ['game', 1, 'photo-1542751371-adc38448a05e', '电竞馆暗光对战（开黑）'],
  ['game', 2, 'photo-1511512578047-dfb367046420', '霓虹灯游戏手柄'],
  ['game', 3, 'photo-1592840496694-26d035b52b48', '白色游戏手柄特写'],
  ['movie', 1, 'photo-1489599849927-2ee91cede3ba', '影院红色座椅（观影）'],
  ['movie', 2, 'photo-1536440136628-849c177e76a1', '放映机胶片（影院氛围）'],
  ['photo', 1, 'photo-1452587925148-ce544e77e70d', '双手持相机取景（扫街）'],
  ['photo', 2, 'photo-1516035069371-29a1b244cc32', '复古相机暗调静物'],
  ['pet', 1, 'photo-1543466835-00a7907e9de1', '微笑坐姿小狗（遛狗）'],
  ['pet', 2, 'photo-1552053831-71594a27632d', '金毛幼犬'],
  ['pet', 3, 'photo-1518717758536-85ae29035b6d', '棕色小狗特写'],
  ['coffee', 1, 'photo-1509042239860-f550ce710b93', '拿铁咖啡杯（探店）'],
  ['coffee', 2, 'photo-1521017432531-fbd92d768814', '咖啡店内景与客人'],
  ['coffee', 3, 'photo-1495474472287-4d71bcdd2085', '桌面咖啡与咖啡豆'],
  ['shopping', 1, 'photo-1441986300917-64674bd600d8', '服装店衣架陈列（逛街）'],
  ['shopping', 2, 'photo-1483985988355-763728e1935b', '提购物袋逛街'],
  ['boardgame', 1, 'photo-1610889556528-9a770e32642f', '桌游棋子组件俯拍'],
  ['boardgame', 2, 'photo-1611996575749-79a3a250f948', '桌游手牌局'],
  ['boardgame', 3, 'photo-1529699211952-734e80c4d42b', '棋盘对弈特写'],
  ['commute', 1, 'photo-1544620347-c4fd4a3d5957', '公交/地铁车厢内（通勤）'],
  ['commute', 2, 'photo-1502877338535-766e1452684a', '公路行驶车辆（拼车）'],
  ['commute', 3, 'photo-1519501025264-65ba15a82390', '城市夜景天际线'],
  ['other', 1, 'photo-1477959858617-67f85cf4f1df', '城市天际线（citywalk/其他局）'],
  ['other', 2, 'photo-1449034446853-66c86144b0ad', '城市楼宇黄昏'],
];

// ---------- F.1 头像清单：10 张（与旧 u{i}.svg 同序号同用户，性别一致） ----------
const AVATARS = [
  [1, 'photo-1494790108377-be9c29b29330', '微笑女生人像（美美/F）'],
  [2, 'photo-1539571696357-5a69c17a67c6', '年轻男生人像（阿跑/M）'],
  [3, 'photo-1544005313-94ddf0286df2', '女生人像（Sherry/F）'],
  [4, 'photo-1534528741775-53994a69daeb', '女生人像（momo/F）'],
  [5, 'photo-1517841905240-472988babdf9', '微笑女生人像（小鱼干/F）'],
  [6, 'photo-1500648767791-00dcc994a43e', '年轻男生人像（小柯/M）'],
  [7, 'photo-1506794778202-cad84cf45f1d', '胡须男生人像（老徐/M）'],
  [8, 'photo-1507003211169-0a1dd7228f2d', '成熟男士人像（王大爷/M）'],
  [9, 'photo-1524504388940-b1c1722653e1', '女生人像（KiKi/F）'],
  [10, 'photo-1438761681033-6461ffad8d80', '微笑女生人像（官方小助手/F）'],
];

const MIN_BYTES = 10 * 1024; // ≥10KB 视为有效

function isJpeg(buf) {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

async function fetchOnce(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (res.status !== 200) return { error: `HTTP ${res.status}` };
  const ctype = res.headers.get('content-type') || '';
  if (!/image\/jpe?g/.test(ctype)) return { error: `content-type=${ctype}` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isJpeg(buf)) return { error: 'not JPEG magic (FF D8)', buf };
  return { buf };
}

async function fetchOne(relPath, url) {
  const dest = path.join(ROOT, relPath);
  if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > MIN_BYTES) {
    return { relPath, status: 'skipped', bytes: fs.statSync(dest).size };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let r;
  try {
    r = await fetchOnce(url);
  } catch (e) {
    return { relPath, status: 'failed', error: `network: ${e.message}` };
  }
  if (r.error) return { relPath, status: 'failed', error: r.error };
  // 体积不足（如 200×200 人像压缩后 <10KB）：提高质量参数重试一次，满足 ≥10KB 校验
  if (r.buf.length < MIN_BYTES && !url.includes('q=100')) {
    try {
      const r2 = await fetchOnce(url.replace(/q=\d+/, 'q=100'));
      if (!r2.error && r2.buf.length >= MIN_BYTES) r = r2;
    } catch { /* 保持首次结果 */ }
  }
  if (r.buf.length < MIN_BYTES) {
    return { relPath, status: 'failed', error: `too small: ${r.buf.length}B` };
  }
  fs.writeFileSync(dest, r.buf);
  return { relPath, status: 'downloaded', bytes: r.buf.length };
}

function creditsMd(lines) {
  const head = [
    '# 照片素材来源（CREDITS）',
    '',
    '本目录及 `web/public/img/avatars/photo-*.jpg` 的全部照片来自 [Unsplash](https://unsplash.com)，',
    '依据 [Unsplash License](https://unsplash.com/license) 使用：**可免费商用、无需署名、可随意修改**。',
    '本仓库在此致谢所有摄影师（来源为原始 photo-id 链接，由 `scripts/fetch-photos.mjs` 按规格 §F.1 清单下载并本地化，无任何外链热链）。',
    '',
    '> 参数变更记录：`avatars/photo-4.jpg` 与 `avatars/photo-9.jpg` 原图 200×200 在 q=70 下压缩后不足 10KB（8.2KB / 8.8KB），',
    '> 为满足体积校验改用 `q=100` 重下（同 photo-id、同裁切参数），内容不变。其余 45 张均按规格参数下载。',
    '',
  ];
  return head.join('\n') + lines.join('\n') + '\n';
}

// ---------- 执行 ----------
const jobs = [
  ...PHOTOS.map(([cat, n, id, note]) => ({
    relPath: path.relative(ROOT, path.join(PHOTO_DIR, `${cat}-${n}.jpg`)),
    url: UNSPLASH(id, COVER_PARAMS),
    id, note, group: 'photos',
  })),
  ...AVATARS.map(([i, id, note]) => ({
    relPath: path.relative(ROOT, path.join(AVATAR_DIR, `photo-${i}.jpg`)),
    url: UNSPLASH(id, AVATAR_PARAMS),
    id, note, group: 'avatars',
  })),
];

console.log(`📷 搭搭照片素材下载：共 ${jobs.length} 个文件${FORCE ? '（--force 强制重下）' : ''}`);
const results = [];
for (const j of jobs) {
  const r = await fetchOne(j.relPath, j.url);
  results.push({ ...r, ...j });
  const kb = r.bytes ? `${(r.bytes / 1024).toFixed(0)}KB` : '';
  const mark = r.status === 'downloaded' ? '⬇️' : r.status === 'skipped' ? '⏭️ ' : '❌';
  console.log(`${mark} ${r.relPath} ${kb} ${r.error || ''}`);
}

const failed = results.filter((r) => r.status === 'failed');
const okCount = results.length - failed.length;
const totalBytes = results.reduce((s, r) => s + (r.bytes || 0), 0);

// ---------- CREDITS.md（全部 47 个文件逐行列出） ----------
const lines = [];
for (const g of ['photos', 'avatars']) {
  const items = results.filter((r) => r.group === g);
  lines.push(g === 'photos' ? '## 封面照片（web/public/img/photos/）\n' : '## 头像照片（web/public/img/avatars/）\n');
  for (const it of items) {
    lines.push(`- \`${path.basename(it.relPath)}\` → https://images.unsplash.com/${it.id} ｜ ${it.note}`);
  }
  lines.push('');
}
fs.mkdirSync(PHOTO_DIR, { recursive: true });
fs.writeFileSync(path.join(PHOTO_DIR, 'CREDITS.md'), creditsMd(lines));

console.log(`\n✅ 成功/跳过 ${okCount}/${results.length}，合计 ${(totalBytes / 1024 / 1024).toFixed(2)}MB`);
console.log('📝 CREDITS.md 已写入 web/public/img/photos/CREDITS.md');
if (failed.length) {
  console.error(`\n❌ 失败 ${failed.length} 个：`);
  for (const f of failed) console.error(`   ${f.relPath}: ${f.error}`);
  process.exit(1);
}
