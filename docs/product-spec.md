# 搭搭多端产品规格书 v2

> 版本：v2.0-draft ｜ 日期：2026-10-12 ｜ 负责人：PM（本文档）｜ 实现：前端 FE-A / FE-B、后端 BE
> 上游文档：`docs/research.md`（赛道四大顽疾）、`docs/roadmap.md`（v1.0 已闭环 → v2.0 多端）
> 验收方式：PM 按 §E 验收清单逐项勾选，每条验收项都引用需求 ID（H5-xx / APP-xx / WEB-xx / BE-xx）。

---

## 0. 目标、范围与硬约束

### 0.1 v2 总目标

把已闭环的 H5 MVP（v1.0）升级为**三端产品**，同时完成对标小红书的现代化视觉改版：

| 端 | 形态 | 定位 |
|---|---|---|
| ① H5 | 移动端网页 App（现有，改版） | 主战场：零安装、扫码即用、需求验证（research.md 洞察 #3） |
| ② App | PWA + Capacitor 原生壳 | 可安装、有图标/启动屏、近原生体验；本环境交付"可打包工程"，不编译 APK |
| ③ 桌面网页 | 响应式桌面布局（≥768px） | 同一 URL 自适应：多列瀑布流、侧边导航、聊天分栏 |

### 0.2 硬约束（所有需求默认受此约束，违反即验收不通过）

- **C1 零构建**：H5 保持原生 JS + `<script>` 全局模块模式，不引入打包器/框架/TS/npm 前端构建链。新增 CSS/JS 均为静态文件直接引用。
- **C2 功能不回退**：聊天 WebSocket（实时收发、断线重连、角标）、搭力值体系（认证/完成/互评加减分、<300 禁发布）、安全中心（SOS/拉黑/举报/敏感词）、运营后台（看板/举报队列/封禁）行为不变。
- **C3 API 向后兼容**：后端只**新增**字段，不删改既有字段语义；响应包裹结构 `{ok, data}`、分页参数、错误格式不变；`server/test/api.test.js` 的 **23 个测试必须全绿**。
- **C4 零外部服务依赖**：部署仍为单机 Node + 内置 SQLite + 静态文件；新增依赖只允许出现在开发期工具链（Capacitor、图标生成），不得进入 server 运行时。
- **C5 兼容旧数据**：数据库中已存的文章配图路径（`/img/covers/*.svg`、`/uploads/*`）继续有效，**不重命名/删除**任何已存在的静态资源文件。

### 0.3 现状盘点（改版基线）

- 设计体系：`web/public/css/app.css`（Token：--primary #FF7A45 等；卡片为横向列表式 `post-card`）。
- TabBar：`web/public/index.html` 内联，5 个 emoji 图标（🧭✨➕💬👤），角标节点 `#chat-badge`、`#me-badge`（`app.js` 引用，必须保留 id）。
- 路由：hash 路由（`app.js`），Tab 页 `square/discover/chat/me` 显示 TabBar，其余隐藏；`container.innerHTML` 整页重绘，页面模块经 `App.register` 注册。
- 广场/发现：横向卡片列表（52px 小图 + 标题 + pill 元信息），非瀑布流。
- 详情页：图片为横向滚动 gallery（固定 210×128），无轮播指示、无底部操作栏。
- 后端：`postView()` 返回 27 个字段（无 cover/aspect）；`/recommend`、`/for-you` 为精简视图（无 aspect）；`images` 来自用户上传或 seed 写入的 `/img/covers/{key}.svg`。
- 资产：`scripts/gen-assets.mjs` 生成 10 头像（240×240）+ 14 封面（640×360 横版 SVG）。

---

## A. H5 端：对标小红书改版（H5-xx）

> 设计基调：保留搭搭品牌橙作为品牌与行动色，引入小红书红作为互动色；信息密度向 XHS 靠拢 —— 双列瀑布流大图、两行标题、轻量作者行。

### A.1 设计 Token（H5-01 ~ H5-03）

**H5-01 颜色体系：品牌橙 × 互动红融合方案**

在 `:root` 中新增/调整以下 Token（既有变量名一律保留，只调值或新增，防止存量样式失效）：

```css
:root {
  /* 品牌色（保持不变）：logo、主 CTA、TabBar 选中、发布按钮 */
  --primary: #FF7A45;
  --primary-deep: #F05A24;
  --primary-soft: #FFF1EA;
  /* 互动色（新增，取小红书红 #FF2442）：点赞、收藏等"互动动作"专用 */
  --like: #FF2442;
  --like-soft: #FFEEF0;
  /* 品牌渐变统一为一条，全端复用 */
  --grad-primary: linear-gradient(135deg, #FF7A45, #FF9A62);
  /* 语义色保持：--danger 仍用于删除/封禁/SOS 等破坏性场景（不与互动红混用） */
}
```

融合规则（写入规范，FE 按此执行）：
1. **橙 = 品牌与行动**：主按钮、发布按钮、TabBar 激活态、链接色、聚焦边框、页面头部渐变（我的页/登录页）。
2. **红 = 互动**：仅用于点赞爱心（`liked=true` 时心形与数字变 `--like`）、未读消息红点可沿用 `--danger`（视觉同为警示，不强制换）。
3. **红橙不同框**：同一控件上不得同时出现品牌橙与互动红（避免脏色），如卡片上"招募中"pill 保持绿系。
4. `--danger: #F04438` 保留给危险操作（拉黑/SOS/退出），与互动红 `--like` 在语义上区分。

验收：改版后任意页面截图中，橙色系只出现在品牌/CTA/导航，红色只出现在点赞与危险操作。

**H5-02 圆角与阴影 Token**

```css
:root {
  --radius-sm: 10px;   /* pill、小按钮 */
  --radius-md: 14px;   /* 输入框、瀑布流卡片、缩略图 */
  --radius: 18px;      /* 大卡片（保留原名，存量样式继续生效） */
  --radius-xl: 24px;   /* 底部弹层 */
  --shadow:      0 1px 8px rgba(34,36,38,.05);   /* 调轻：瀑布流卡片用 */
  --shadow-card: 0 2px 12px rgba(34,36,38,.06);  /* 原值，普通卡片用 */
  --shadow-pop:  0 8px 32px rgba(34,36,38,.16);  /* 保留 */
}
```

验收：`.card` 阴影仍为 `--shadow-card` 视觉不变；新瀑布流卡片使用 `--shadow`，观感更轻盈。

**H5-03 字号层级 Token**

```css
:root {
  --fs-xs: 11px;    /* 角标、页脚 */
  --fs-sm: 12.5px;  /* pill、辅助信息、作者名 */
  --fs-md: 14px;    /* 正文、瀑布流卡片标题 */
  --fs-base: 15px;  /* 界面默认（保持） */
  --fs-lg: 16px;    /* 区块标题 */
  --fs-xl: 17px;    /* 导航标题（保持） */
  --fs-title: 18px; /* 详情标题 */
  --fs-display: 26px;/* 登录页/页面大标题 */
}
```

验收：body 字号仍 15px；瀑布流标题用 `--fs-md/600`、两行截断。

### A.2 图标系统与 TabBar（H5-04 ~ H5-05）

**H5-04 线性 SVG 图标库（UI.icon）**

`ui.js` 新增 `UI.icon(name, cls)`：返回 24×24 stroke 图标（`fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`），颜色随 `color` 继承。图标 path 采用 Feather Icons（MIT）线条风格，具体 path 定义如下（**此表为唯一实现依据**）：

| name | 用途 | SVG 内容（viewBox 0 0 24 24） |
|---|---|---|
| `compass`（广场） | TabBar/侧栏 | `<circle cx="12" cy="12" r="10"/><path d="M16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88z"/>` |
| `star`（发现） | TabBar/侧栏 | `<path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01z"/>` |
| `plus-square`（发布） | TabBar 中央按钮 | `<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>` |
| `message-circle`（消息） | TabBar/侧栏 | `<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>` |
| `user`（我的） | TabBar/侧栏 | `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>` |
| `search` | 搜索栏（替换🔍） | `<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>` |
| `heart` | 点赞/想去 | `<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>`（liked 时该 path 加 `fill="currentColor"` 并继承 `--like`） |
| `bell` | 通知入口 | `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>` |
| `share` | 详情分享 | `<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4M12 2v13"/>` |
| `chevron-left` | 返回 | `<path d="M15 18l-6-6 6-6"/>` |
| `more-horizontal` | 更多（···） | `<circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/><circle cx="5" cy="12" r="1.6"/>` |
| `send` | 聊天发送 | `<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>` |

另需一个**品牌 logo 图标** `logo`（握手/搭手抽象形，橙色填充，用于登录页与 PWA 图标底稿），由 FE-A 绘制并放入 `web/public/img/logo.svg`（导出 240×240）。验收：全局不再出现功能性 emoji 图标（保留内容中的装饰 emoji，如分类 emoji、空状态插画）。

**H5-05 TabBar 换装**

- `index.html` 中 5 个 `<span class="tab-icon">emoji</span>` 全部替换为 `UI.icon` 对应的内联 SVG（或构建时直接内联同样 path），`.tab-icon` 的 grayscale filter 逻辑移除；选中态 = `color: var(--primary-deep)` + `transform: scale(1.08)`（保留现动画）。
- **必须保留**：`data-tab` 属性、`#chat-badge` / `#me-badge` 节点、发布按钮渐变胶囊（`.tab-publish` 样式保留，内部图标用 `plus-square` 白色 stroke）。
- 验收：TabBar 五个图标为线性 SVG，视觉对齐 XHS 底栏密度；角标数字仍实时刷新（复用 `refreshBadges`）。

### A.3 广场页：双列瀑布流（H5-06 ~ H5-09）

**H5-06 瀑布流布局（CSS columns 实现）**

```css
.wf { column-count: 2; column-gap: 8px; padding: 8px; }
.wf-item { break-inside: avoid; margin-bottom: 8px; display: inline-block; width: 100%; }
```

实现要点（写入规范，逐条为验收点）：
1. 容器禁用 flex/grid（columns 的前提是块级流）。
2. `.wf-item` 用 `display:inline-block; width:100%; break-inside:avoid;` 双保险，规避 iOS Safari 老版本截断 bug。
3. 封面必须由服务端 `aspect` 字段驱动 `aspect-ratio`（见 H5-07），杜绝图片加载引起的跳变；`<img>` 加 `loading="lazy"`。
4. 分页/筛选刷新时**整容器重绘**（延续现有 `refreshList` 模式），不做增量插入（columns 下增量插入会重排列序）。
5. 已知取舍：CSS columns 为"先列后行"排序（左列自上而下再右列），对按时间排序的信息流可接受；后续如需严格左右平衡再升级 JS 分列，本版不做。
6. 触底加载更多可不做（当前 size=30 一次拉取，保持现状）。

**H5-07 瀑布流卡片（大图封面 + 2 行标题 + 作者行）**

结构（`square.js` 的 `postCard` 重写为 `.wf-item`）：

```
┌─────────────────────┐
│ 封面 aspect-ratio:var(--ar) │ ← 顶部左上角覆盖"招募中/已满员"小 pill
│ （object-fit:cover）        │ ← 右上角覆盖 ♀/♂ 限定 pill（仅有性别要求时）
├─────────────────────┤
│ 标题（最多2行，--fs-md/600，│
│  -webkit-line-clamp:2）     │
│ 📍城市 · 🕐时间 · 还缺N人    │ ← 单行 --fs-xs，text-3，溢出省略
│ ────────────────────        │
│ (avatar 16px) 昵称   ❤ 12   │ ← 作者行 --fs-sm；❤ 用 heart 图标
└─────────────────────┘
```

- `--ar` 由 `UI.aspectOf(p)` 计算（优先 `p.aspect`，兜底本地同规则，见 D-02），映射：`3:4 → aspect-ratio:3/4`、`1:1 → 1/1`、`4:3 → 4/3`。
- 封面 `src` 由 `UI.coverOf(p)` 计算（优先 `p.cover`，兜底 `p.images[0]`，再兜底本地分类封面规则，见 D-02）；无任何图时降级为分类 emoji 渐变块（保留现 `post-emoji`）。
- 点击整卡进 `#/post/:id`；状态 pill、性别 pill 用半透明白底（`rgba(255,255,255,.9)`）覆盖在图上，保证可读。

**H5-08 顶部搜索 + 分类横滑 chip（保留并微调）**

- 结构沿用现 navbar（标题行 + 搜索行 + chip 行），改动点：搜索框 🔍 换 `search` 图标、通知 🔔 换 `bell`；搜索框背景改 `--bg`（去阴影，更贴 XHS）。
- chip 行保持横向滑动，选中 chip 橙底白字（现 `pill` 主色态即满足），未选中 `--line` 灰底。
- 城市选择器、热门排序逻辑不变（C2）。

**H5-09 发现页同构**

- `discover.js` 的"为你而设 / 本周热门"两个区块改用同一套瀑布流卡片（`.wf`），推荐理由 pill 叠加在封面左下角；其余逻辑不动。

### A.4 详情页改版（H5-10 ~ H5-11）

**H5-10 大图轮播（scroll-snap + 页码指示）**

```css
.carousel { position: relative; display: flex; overflow-x: auto;
  scroll-snap-type: x mandatory; aspect-ratio: 3/4; background: var(--line); }
.carousel img { flex: 0 0 100%; width: 100%; height: 100%;
  object-fit: cover; scroll-snap-align: center; }
.carousel::-webkit-scrollbar { display: none; }
.carousel-index { position: absolute; right: 10px; bottom: 10px;
  background: rgba(0,0,0,.45); color:#fff; font-size: var(--fs-xs);
  padding: 2px 8px; border-radius: 99px; }
```

- 仅当 `p.images.length > 0` 时渲染轮播，`aspect-ratio` 用 `UI.aspectOf(p)`；无图则保留分类 emoji 头图块。
- 页码指示 `cur/total`：监听 scroll，`idx = Math.round(scrollLeft / clientWidth) + 1`，rAF 节流。
- 标题、状态 pill、正文、meta 行沿用现有信息结构，仅按新 Token 调字号间距；标题下移至轮播下方（XHS 式）。

**H5-11 底部固定操作栏**

```css
.detail-bar { position: fixed; left:0; right:0; bottom:0; z-index:35;
  display:flex; align-items:center; gap:10px;
  padding:10px 14px calc(10px + var(--safe-bottom));
  background: rgba(255,255,255,.96); backdrop-filter: blur(16px);
  border-top:.5px solid var(--line); }
```

- 布局：作者（avatar+昵称+搭力 pill，点击跳作者主页，占 flex:1）｜点赞按钮（heart 图标+数字，liked 红）｜评论按钮（滚动到评论区并聚焦输入框）｜主按钮「申请加入」按现有 `joinBtnText()` 全状态逻辑。
- 详情内容容器增加 `padding-bottom: 76px`（栏高 + 安全区）防遮挡。
- 组局者视角：主按钮显示状态文本且置灰（逻辑沿用），申请管理/互评/评论区结构不变。
- 原卡片内"想去/申请加入"按钮移除，功能全部收敛到底栏。

### A.5 我的页改版（H5-12 ~ H5-13）

**H5-12 头部**：保留橙色渐变头部（`me-header`），改动：编辑按钮换文字+`chevron`、认证/MBTI/标签 chip 保留；下方搭力值卡片与三栏数据（发布的局/参加的局/搭后评分）保留现结构，仅统一圆角阴影 Token。

**H5-13 内容网格（XHS 式）**：新增 Tab 切换区（`发布` / `参加`）+ 3 列方形缩略网格：

```css
.my-grid { display:grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 0 4px; }
.my-grid .cell-cover { aspect-ratio: 1/1; border-radius: 6px; object-fit: cover; width: 100%; }
```

- 数据源：`/my/posts/published`、`/my/posts/joined`（已有接口，无后端改动）；封面用 `UI.coverOf`，正方形裁切。
- 原「我的搭局/收到的评价/安全中心/运营后台/设置」入口 cell 列表保留在网格下方（或收进"更多"），入口不得减少（C2）。

### A.6 其余页面一致性（H5-14 ~ H5-17）

- **H5-14 发布页**：分类 4 宫格、分段选择器、计数器结构不变；视觉统一 Token（选中橙、圆角 --radius-md）；配图缩略 84px 圆角 14 保持；提示卡、发布按钮不变。
- **H5-15 消息/会话页**：会话列表行高与头像统一（avatar 44px）；会话页输入框发送按钮换 `send` 图标；气泡样式保持（本就接近 XHS）；顶部返回/更多换 `chevron-left` / `more-horizontal`。
- **H5-16 登录页**：hero 区使用 `logo.svg` + 品牌渐变点缀；表单结构不变；演示账号提示保留。
- **H5-17 其他页（user/misc/admin/safety/settings）**：不做结构改版，仅随 Token 与图标库被动统一（返回键、cell 图标可用 emoji 保留）；admin 表格类信息在移动端保持现状（桌面端见 WEB-05）。

---

## B. App 端：PWA + Capacitor（APP-xx）

### B.1 PWA

**APP-01 manifest**

新增 `web/public/manifest.json`（字段即验收标准）：

```json
{
  "name": "搭搭 · 找到你的搭子",
  "short_name": "搭搭",
  "description": "万物皆可搭，找人别犯难 —— 找搭子轻社交平台",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "lang": "zh-CN",
  "background_color": "#F6F7F9",
  "theme_color": "#FF7A45",
  "icons": [
    { "src": "/img/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/img/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/img/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`index.html` 增加 `<link rel="manifest" href="/manifest.json">`。SPA fallback（index.js 已有）覆盖 `/manifest.json` 之前需确认静态文件优先级（express.static 在前，天然满足，无需改路由）。

**APP-02 Service Worker 缓存策略**

新增 `web/public/sw.js` + `app.js` 中 `if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')`（仅 https 或 localhost）。

策略（验收标准）：
1. 缓存名带版本：`dada-static-v2`、`dada-api-v2`；`activate` 时清理旧版本。
2. **预缓存**（install）：`/`、`/css/app.css`、`/css/desktop.css`、`/js/api.js`、`/js/ui.js`、`/js/ws.js`、`/js/app.js`、`/img/logo.svg`。
3. **同源静态资源**（css/js/img，GET）：Stale-While-Revalidate（先缓存秒开，后台更新）。
4. **`/api/` GET**：Network-First（成功才写入缓存，失败回退缓存 → 弱网可读旧数据）；非 200 不缓存。
5. **`/uploads/`**：Cache-First（文件名含时间戳，天然不可变）。
6. **导航请求**：Network-First，失败回退 `/`（SPA 壳离线可开）。
7. **`/ws` 与非 GET 一律直连不拦截**（保证聊天实时性，C2）。

**APP-03 安装横幅**

- `app.js` 监听 `beforeinstallprompt` 存入变量；用户第 2 次进入或在"设置"页点「安装 App」时弹出 `UI.sheet`：「把搭搭装到桌面，下次一键直达」→ 调 `prompt()`。
- iOS（无该事件）：检测 Safari 后展示引导 sheet：「分享 → 添加到主屏幕」。
- 已安装（`display-mode: standalone`）不再提示。

**APP-04 iOS meta**

`index.html` 补充（现有 `apple-mobile-web-app-capable`、`status-bar-style`、`theme-color` 保留）：

```html
<link rel="apple-touch-icon" href="/img/icons/icon-180.png">
<meta name="apple-mobile-web-app-title" content="搭搭">
<meta name="format-detection" content="telephone=no">
```

**APP-05 启动图标生成（SVG → PNG）**

新增 `scripts/gen-icons.mjs`，做法与现有 `scripts/screenshot.mjs` 一致：用仓库已有的 `playwright-core` + 本机 chromium 打开模板 SVG 页面截图导出 PNG（**不引入 sharp 等新原生依赖**，符合 C4）。

- 模板：`img/logo.svg`（品牌橙渐变圆角方块 + 握手图形）。
- 输出：`web/public/img/icons/icon-192.png`、`icon-512.png`、`icon-180.png`、`maskable-512.png`（maskable 版内容缩至 80% 安全区居中）。
- 运行 `node scripts/gen-icons.mjs` 一次性生成并提交产物（图标属静态资产，不进构建）。

### B.2 Capacitor 原生壳

**APP-06 工程接入（交付"可打包工程"）**

仓库根新增 Capacitor 工程（devDependencies，不进 server 运行时）：

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/android @capacitor/ios
npx cap init "搭搭" "com.dada.app" --web-dir=web/public
npx cap add android
npx cap add ios   # 可选，无 macOS 环境时可后补
```

`capacitor.config.json` 关键配置（验收标准）：

```json
{
  "appId": "com.dada.app",
  "appName": "搭搭",
  "webDir": "web/public",
  "server": { "url": "https://<部署域名>", "androidScheme": "https" },
  "android": { "backgroundColor": "#F6F7F9" }
}
```

> 说明：前端全部走相对路径 `/api`、`/uploads`、`ws(s)://host/ws`，因此原生壳用 `server.url` 直接加载远端 H5（zero-build 方案，C1 不被破坏）。自签/本地演示时改为 `http://<局域网IP>:3000` 并在 Android 侧允许 cleartext。README 必须写明这一取舍与「打包本地离线包」的后续升级路径。

**APP-07 图标与启动屏**

- Android：`npx @capacitor/assets generate --iconBackgroundColor '#FF7A45'`（或手工放置）——源图复用 APP-05 生成的 `icon-1024.png`（由 gen-icons.mjs 追加输出）与 `splash-2732.png`（品牌橙底 + 居中 logo）。
- iOS：同上生成 AppIcon 与 Launch Storyboard 资源。

**APP-08 交付说明（README）**

根 README 增加「App 打包指南」章节：环境要求（JDK 17 + Android Studio）、`npx cap sync`、`npx cap open android`、出 APK/AAB 的命令路径；明确本仓库当前交付物为**可打包工程**（CI/本机无 Android SDK 时不产出 APK）。

---

## C. 桌面网页端（WEB-xx）

> 策略总纲：**移动端样式零回归** —— 全部桌面能力收敛在新增 `web/public/css/desktop.css`（仅含 `@media (min-width:768px)` 规则）+ `app.js` 给 `body` 打 `data-page` 标记 + 个别页面的条件渲染分支。不新建桌面专用路由。

**WEB-01 断点与全局布局（TabBar → 侧边栏）**

- 断点定义：`≥768px`（平板/小桌面）与 `≥1080px`（桌面）两档；`<768px` 完全维持现状。
- `app.js`：`render()` 中 `document.body.dataset.page = page`（一次改动，全端受益）。
- `desktop.css`：

```css
@media (min-width: 768px) {
  #app { flex-direction: row; }
  #tabbar { position: fixed; inset: 0 auto 0 0; width: 72px; flex-direction: column;
    padding: 12px 0; border-top: none; border-right: .5px solid var(--line); }
  .tab { flex: none; height: 52px; }
  .tab-publish { margin: 8px 12px; }
  .badge { top: 4px; right: auto; left: 40px; }
  #page-container { margin-left: 72px; }
  .page { padding-bottom: 24px; }  /* 不再给 TabBar 让位 */
}
@media (min-width: 1080px) {
  #tabbar { width: 200px; align-items: stretch; }
  .tab { flex-direction: row; justify-content: flex-start; padding: 0 24px; gap: 12px; }
  .tab .tab-label { font-size: 15px; font-weight: 600; }
  #page-container { margin-left: 200px; }
}
```

- 验收：桌面端左侧竖排导航（1080px+ 显示文字标签），移动端 DOM 与样式与改版前完全一致。

**WEB-02 广场/发现多列瀑布流**

```css
@media (min-width: 768px)  { .wf { column-count: 3; max-width: 1024px; margin: 0 auto; } }
@media (min-width: 1080px) { .wf { column-count: 4; max-width: 1200px; } }
```

- 广场顶部 navbar 在桌面居中收窄（max-width 与列表一致）；搜索框加宽。
- 验收：≥768px 三列、≥1080px 四列，卡片比例不变形，筛选/chip 功能正常。

**WEB-03 聊天左右分栏（列表 + 会话）**

- `conv.js` 增加桌面分支（`matchMedia('(min-width:768px)')` 为真时）：页面渲染为两栏 —— 左栏 320px 复用 `/chat/convs` 列表（当前会话高亮，点击切换 hash）+ 右栏现有会话 DOM 原样挂载；WS 逻辑不动。
- `chat.js`（列表页）在桌面端：列表左栏化 + 右栏空态「选择一个会话开始聊天」。
- 会话高度：桌面下 `.chat-scroll` 占满视口剩余高度，输入栏吸底（现有 flex 结构天然支持）。
- 验收：桌面进入 `#/conv/:id` 无需返回即可切换会话；移动端两页行为不变。

**WEB-04 详情页居中卡片**

```css
@media (min-width: 768px) {
  [data-page="post"] .page { background: var(--bg); }
  [data-page="post"] .page > .detail-card,
  [data-page="post"] .page > * { max-width: 640px; margin-left: auto; margin-right: auto; }
  .detail-bar { max-width: 640px; left: 50%; transform: translateX(-50%);
    border-radius: 16px 16px 0 0; bottom: 0; }
}
```

- 详情页整体呈居中卡片流（轮播 + 标题 + meta + 评论区），底部操作栏同宽居中悬浮。
- 验收：≥768px 详情内容 640px 居中，操作栏不横贯全屏。

**WEB-05 其余页面**

- 发布/编辑资料/登录：表单容器 `max-width: 640px`（登录页 720px 双栏：左 hero 右表单）居中。
- 我的页：网格改 4-5 列，头部卡片居中限宽。
- 管理后台：`stat-grid` 桌面 5 列；举报/用户列表卡片限宽 720px 居中（信息密度已够，不做表格化）。
- 通知/评价/安全中心：内容列 `max-width: 680px` 居中。
- 验收：桌面端无"手机页面拉伸全屏"的观感；所有交互（审批、SOS、封禁）在桌面可用。

**WEB-06 实现策略红线**

1. `desktop.css` 之外不允许出现新的 `min-width` 媒体查询（集中管理）。
2. JS 条件分支只允许 `matchMedia` 判定 + 渲染期分支（conv/chat 两处），禁止为桌面单独造路由或全局重写页面。
3. 移动端回归：改版后 390×844 截图走查 `scripts/screenshot.mjs` 全页面，与验收基线比对。

---

## D. 后端支撑（BE-xx）

**BE-01 封面资产：每分类 2 套配色变体（gen-assets.mjs 扩展）**

- `scripts/gen-assets.mjs` 的 COVERS 表每行追加第二套渐变色 `[c3, c4]`，循环同时产出：
  - `covers/{key}.svg` —— 变体1（**文件名不变**，DB/seed 已引用，满足 C5），尺寸从 640×360 改为 **480×640（3:4 竖版）**，服务瀑布流裁切；
  - `covers/{key}-2.svg` —— 变体2（同构图、不同渐变配色 + 装饰 emoji 位置镜像）。
- `server/src/seed.js`：写 `images` 时按帖子序号奇偶交替 `/img/covers/{key}.svg` 与 `{key}-2.svg`（仅影响演示数据，重新 seed 即生效；存量 DB 不强制迁移）。
- 验收：`node scripts/gen-assets.mjs` 产出 14×2=28 张封面；老路径 200；瀑布流中同分类出现两种配色。

**BE-02 postView 增加 `cover` 与 `aspect`（确定性规则）**

`server/src/routes/posts.js` 的 `postView()` 追加两个字段（只增不改，C3）：

```js
const ASPECTS = ['3:4', '1:1', '4:3'];
// aspect：按帖子 id 确定性分档（同帖永远同档，刷新不变）
const aspect = ASPECTS[p.id % 3];
// cover：有用户配图用首图；否则用分类封面（变体按 id 奇偶确定性选择）
const cover = (safeJSON(p.images, [])[0]) || `/img/covers/${p.category}${p.id % 2 ? '-2' : ''}.svg`;
```

返回体新增：`cover: <url>, aspect: '3:4'|'1:1'|'4:3'`；`images` 等既有字段原样保留。
作用范围：`GET /posts`（列表）、`GET /posts/:id`、`POST /posts`、`PUT /posts/:id`、`/my/posts/*` —— 全部经由 `postView`，一处改动全覆盖。

**BE-03 recommend / for-you 同步补齐**

`server/src/routes/misc.js` 两个接口的 list 元素同样追加 `cover`（规则同 BE-02）与 `aspect`（`p.id % 3`），保证发现页瀑布流无需二次请求。

**BE-04 兼容性红线与测试**

1. 23 个测试（`server/test/api.test.js`）不改断言即全绿：`cd server && npm test`。
2. 新字段必须确定性（禁止 `Math.random()`/时间参与 `cover`/`aspect` 计算），保证前端 SWR 缓存与截图基线稳定。
3. 响应仍为 `{ok:true, data}` 包裹；错误文案与状态码不变。
4. 静态资源响应头（可选加分项）：`/img/*` 增加 `Cache-Control: public, max-age=604800`（文件名即版本，利于 PWA 与桌面端加载）。

**BE-05 前端兜底约定（跨端联调契约）**

FE 侧 `UI.coverOf / UI.aspectOf` 实现与 BE-02/03 完全相同的确定性规则作为兜底（应对旧缓存 JSON 或接口未上线），保证任何一端先上、另一端后上都不出图错乱：

```js
const ASPECTS = ['3:4', '1:1', '4:3'];
UI.coverOf  = (p) => p.cover || p.images?.[0] || `/img/covers/${p.category}${p.id % 2 ? '-2' : ''}.svg`;
UI.aspectOf = (p) => p.aspect || ASPECTS[p.id % 3];
```

---

## E. 验收清单（PM 逐项勾选）

### E.1 全局回归（每次验收先跑，对应 C2/C3）

- [ ] `cd server && npm test` → 23 passed（BE-04）
- [ ] 两设备登录互发消息实时到达；杀进程重连后消息不丢（WS 断线重连 + 角标）
- [ ] 聊天中发"加微信"被打码、首条消息出现安全提示
- [ ] 搭力值：真人认证 +50、完成搭局 +20、差评 -15、<300 发布被拒
- [ ] 仅限女生局男生申请被拒；SOS 提交成功；拉黑后无法互发
- [ ] admin 账号看板/举报处理（警告/封禁/下架/驳回）/用户封禁解封正常
- [ ] 旧帖子（改版前发布，含/不含配图）在列表与详情正常展示（C5）

### E.2 H5 端

- [ ] H5-01 页面色板符合"橙=品牌/CTA、红=互动"规则，无红橙同框
- [ ] H5-02/03 卡片、弹层、输入框圆角与字号符合 Token 表
- [ ] H5-04/05 TabBar 五图标为线性 SVG，选中态橙、角标数字正常
- [ ] H5-06 广场为双列瀑布流；快速滚动无图片跳变；筛选（城市/分类/关键词/热门）后列表正确刷新
- [ ] H5-07 卡片：封面比例三档（3:4/1:1/4:3）均有分布且同帖恒定；标题两行截断；作者行 + 点赞数展示
- [ ] H5-08 顶部搜索 + 横滑 chip 可用，视觉符合规范
- [ ] H5-09 发现页两区块均为瀑布流卡片，推荐理由 pill 可见
- [ ] H5-10 详情图片轮播可横滑、有 n/m 页码、无横向滚动条
- [ ] H5-11 底部操作栏：作者跳转主页、点赞变红计数变化、评论定位输入框、申请加入全状态文案正确；内容不被栏遮挡
- [ ] H5-12/13 我的页：头部渐变 + 大头像 + 三栏数据；「发布/参加」Tab + 3 列网格可切换
- [ ] H5-14~17 发布/消息/会话/登录/其余页视觉统一，功能与改版前一致
- [ ] iPhone Safari 与 Android Chrome 真机/模拟器各走查一遍（safe-area、键盘弹起）

### E.3 App 端

- [ ] APP-01 `/manifest.json` 可访问，Lighthouse PWA 检查 Installable 通过
- [ ] APP-02 二次访问命中 SW 缓存（DevTools Network from ServiceWorker）；断网可打开壳页并显示旧数据；聊天在离线时不受 SW 影响
- [ ] APP-03 Chrome 出现自定义安装引导；iOS 显示"添加到主屏幕"引导；standalone 模式不再打扰
- [ ] APP-04 iOS 添加到主屏幕后：图标 180px 正确、标题"搭搭"、无浏览器框
- [ ] APP-05 `node scripts/gen-icons.mjs` 产出 192/512/180/maskable 全套，无新原生依赖
- [ ] APP-06 仓库含 `capacitor.config.json`、`package.json` 依赖、android 平台目录（或文档化的添加步骤）
- [ ] APP-07 Android 工程内图标/启动屏资源就位（或 generate 脚本与源图就位）
- [ ] APP-08 README「App 打包指南」完整：按文档在装有 Android Studio 的机器可独立出 APK

### E.4 桌面网页端

- [ ] WEB-01 ≥768px 左侧 72px 图标栏；≥1080px 200px 带文字侧栏；`<768px` 与移动端完全一致
- [ ] WEB-02 广场/发现：≥768px 三列、≥1080px 四列、容器居中限宽
- [ ] WEB-03 会话页左列表右会话、可连续切换；列表页有空态占位；消息实时性不受影响
- [ ] WEB-04 详情居中 640px 卡片 + 悬浮操作栏
- [ ] WEB-05 发布/我的/后台/通知等页限宽居中，交互完整
- [ ] WEB-06 全部媒体查询集中在 desktop.css；`scripts/screenshot.mjs` 移动端截图与基线无意外 diff

### E.5 后端

- [ ] BE-01 28 张封面生成；`/img/covers/food.svg` 与 `food-2.svg` 均可访问且为 3:4
- [ ] BE-02 `GET /posts`、`GET /posts/:id` 返回 `cover`+`aspect`；同 id 多次请求值恒定
- [ ] BE-03 `/recommend`、`/for-you` 元素含 `cover`+`aspect`
- [ ] BE-04 测试全绿；diff 审查确认无既有字段删除/改名
- [ ] BE-05 前端在 mock 掉新字段的接口下瀑布流仍正常（兜底规则生效）

---

## 附：里程碑与并行建议

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| M1 | 设计 Token（H5-01~03）+ 图标库/TabBar（H5-04~05）+ BE-01/02/03 + FE 兜底（BE-05） | 无，BE 与 FE 可并行 |
| M2 | 广场/发现瀑布流（H5-06~09） | M1（BE-05 兜底使其不阻塞于 BE） |
| M3 | 详情页（H5-10~11）+ 我的页（H5-12~13）+ 其余页一致性（H5-14~17） | M1 |
| M4 | PWA（APP-01~05） | M1（图标） |
| M5 | 桌面端（WEB-01~06） | M2/M3 完成后做（避免返工） |
| M6 | Capacitor 工程（APP-06~08） | M4 |

> 文件归属与 FE-A/FE-B 分工见交付说明（app.css 归 FE-A；desktop.css/extensions.css、app.js、manifest/sw、conv/chat/me/publish/misc/login/admin 归 FE-B；square/post/discover/user/ui.js 归 FE-A），保证双人不同文件并行。

---

## F. v2.3 真实图片内容升级（PC-xx）

> 版本：v2.3 ｜ 日期：2026-10-12 ｜ 负责人：PM ｜ 需求来源：用户反馈 —— "app 展示页要比如活动里用实际图片或者类似小红书那样的帖子，现在都是表情包，可以上网找一些免费素材"。
> 技术前提（已验证）：`images.unsplash.com` / `images.pexels.com` 均可访问；Unsplash 支持 imgix 参数（`?w=800&q=70&fm=jpg`）直出指定尺寸压缩图。
> 里程碑：PC-01 → PC-03 为一条主线（脚本 → seed → cover 公式，约一个迭代日）；PC-04/PC-05 随后（PC-04 为可选档，PC-05 大部分由 PC-01/02/03 自动达成）。

**总原则（本章所有需求的公共约束）**

1. **素材本地化**：全部图片下载进仓库 `web/public/img/`，**禁止热链外网 URL** —— 保证单机部署、断网环境、APK 离线包全部可用（不违反 C4）。
2. **旧资产零删除**（C5）：`covers/*.svg`（28 张）、`avatars/u*.svg`（10 张）一律保留，全部降级为 onerror / 兜底链的最后一环。
3. **确定性红线**（BE-04 延续）：`cover` 计算禁用 `Math.random()`/时间；新帖图片分配同样确定性，保证 SWR 缓存与截图基线稳定。
4. **License 合规**：Unsplash License 允许免费商用、无需署名；仍以 `CREDITS.md` 致谢来源。禁止选用可识别人物肖像作商业宣传语境（演示头像仅作虚构用户头像使用，可接受）。

### F.1 照片清单表（PC-01 / PC-04 的唯一实现依据）

> 实现 agent **照单下载**，逐行对应 `scripts/fetch-photos.mjs` 的 PHOTOS/AVATARS 数组。以下全部 URL 已由 PM 于 2026-10-12 逐一验证 HTTP 200（封面参数实测单张 23-138KB）。
> 封面统一参数：`?w=800&q=70&fm=jpg`（可追加 `&fit=max` 防小图放大）；头像统一参数：`?w=200&h=200&fit=crop&crop=faces&q=70&fm=jpg`。
> 语义列 = 选图依据；若下载后发现与语义明显不符（如色情/-logo 水印/语义错位），按同分类备选 ID 替换并在 CREDITS.md 记录变更。

| # | 分类 | 目标文件（web/public/img/photos/） | Unsplash photo-id | 语义（与分类对应） |
|---|---|---|---|---|
| 1 | food | food-1.jpg | photo-1504674900247-0877df9cc836 | 聚餐桌菜俯拍（饭搭子局） |
| 2 | food | food-2.jpg | photo-1553621042-f6e147245754 | 寿司拼盘特写（日料） |
| 3 | food | food-3.jpg | photo-1414235077428-338989a2e8c0 | 餐厅精致主菜摆盘 |
| 4 | sports | sports-1.jpg | photo-1476480862126-209bfaa8edc8 | 清晨公路跑步者（晨跑） |
| 5 | sports | sports-2.jpg | photo-1571019613454-1cb2f99b2d8b | 户外体能训练 |
| 6 | sports | sports-3.jpg | photo-1517836357463-d25dfeac3438 | 健身房杠铃力量训练 |
| 7 | study | study-1.jpg | photo-1481627834876-b7833e8f5570 | 图书馆书架通道（自习/国图） |
| 8 | study | study-2.jpg | photo-1456513080510-7bf3a84b82f8 | 书桌摊开的书与笔记 |
| 9 | travel | travel-1.jpg | photo-1506905925346-21bda4d32df4 | 雪山山峰远景 |
| 10 | travel | travel-2.jpg | photo-1551632811-561732d1e306 | 背包客山径徒步 |
| 11 | travel | travel-3.jpg | photo-1501785888041-af3ef285b470 | 高山湖泊日落 |
| 12 | live | live-1.jpg | photo-1470229722913-7c0e2dbbafd3 | 音乐节人群举手 |
| 13 | live | live-2.jpg | photo-1493225457124-a3eb161ffa5f | 演唱会舞台灯光 |
| 14 | live | live-3.jpg | photo-1516450360452-9312f5e86fc7 | livehouse 紫色灯海 |
| 15 | game | game-1.jpg | photo-1542751371-adc38448a05e | 电竞馆暗光对战（开黑） |
| 16 | game | game-2.jpg | photo-1511512578047-dfb367046420 | 霓虹灯游戏手柄 |
| 17 | game | game-3.jpg | photo-1592840496694-26d035b52b48 | 白色游戏手柄特写 |
| 18 | movie | movie-1.jpg | photo-1489599849927-2ee91cede3ba | 影院红色座椅（观影） |
| 19 | movie | movie-2.jpg | photo-1536440136628-849c177e76a1 | 放映机胶片（影院氛围） |
| 20 | photo | photo-1.jpg | photo-1452587925148-ce544e77e70d | 双手持相机取景（扫街） |
| 21 | photo | photo-2.jpg | photo-1516035069371-29a1b244cc32 | 复古相机暗调静物 |
| 22 | pet | pet-1.jpg | photo-1543466835-00a7907e9de1 | 微笑坐姿小狗（遛狗） |
| 23 | pet | pet-2.jpg | photo-1552053831-71594a27632d | 金毛幼犬 |
| 24 | pet | pet-3.jpg | photo-1518717758536-85ae29035b6d | 棕色小狗特写 |
| 25 | coffee | coffee-1.jpg | photo-1509042239860-f550ce710b93 | 拿铁咖啡杯（探店） |
| 26 | coffee | coffee-2.jpg | photo-1521017432531-fbd92d768814 | 咖啡店内景与客人 |
| 27 | coffee | coffee-3.jpg | photo-1495474472287-4d71bcdd2085 | 桌面咖啡与咖啡豆 |
| 28 | shopping | shopping-1.jpg | photo-1441986300917-64674bd600d8 | 服装店衣架陈列（逛街） |
| 29 | shopping | shopping-2.jpg | photo-1483985988355-763728e1935b | 提购物袋逛街 |
| 30 | boardgame | boardgame-1.jpg | photo-1610889556528-9a770e32642f | 桌游棋子组件俯拍 |
| 31 | boardgame | boardgame-2.jpg | photo-1611996575749-79a3a250f948 | 桌游手牌局 |
| 32 | boardgame | boardgame-3.jpg | photo-1529699211952-734e80c4d42b | 棋盘对弈特写 |
| 33 | commute | commute-1.jpg | photo-1544620347-c4fd4a3d5957 | 公交/地铁车厢内（通勤） |
| 34 | commute | commute-2.jpg | photo-1502877338535-766e1452684a | 公路行驶车辆（拼车） |
| 35 | commute | commute-3.jpg | photo-1519501025264-65ba15a82390 | 城市夜景天际线 |
| 36 | other | other-1.jpg | photo-1477959858617-67f85cf4f1df | 城市天际线（citywalk/其他局） |
| 37 | other | other-2.jpg | photo-1449034446853-66c86144b0ad | 城市楼宇黄昏 |

> 合计 37 张：14 分类每类 ≥2（study/movie/photo/shopping/other 为 2 张，其余 3 张），满足"每分类 ≥2、共 ≥32"。

**头像清单（PC-04，web/public/img/avatars/，10 张）**：`photo-{i}.jpg` 与旧 `u{i}.svg` 一一对应（同序号同用户），性别与 seed 用户一致。

| 目标文件 | 对应旧头像 | Unsplash photo-id | 语义 |
|---|---|---|---|
| photo-1.jpg | u1.svg（美美/F） | photo-1494790108377-be9c29b29330 | 微笑女生人像 |
| photo-2.jpg | u2.svg（阿跑/M） | photo-1539571696357-5a69c17a67c6 | 年轻男生人像 |
| photo-3.jpg | u3.svg（Sherry/F） | photo-1544005313-94ddf0286df2 | 女生人像 |
| photo-4.jpg | u4.svg（momo/F） | photo-1534528741775-53994a69daeb | 女生人像 |
| photo-5.jpg | u5.svg（小鱼干/F） | photo-1517841905240-472988babdf9 | 微笑女生人像 |
| photo-6.jpg | u6.svg（小柯/M） | photo-1500648767791-00dcc994a43e | 年轻男生人像 |
| photo-7.jpg | u7.svg（老徐/M·摄影师） | photo-1506794778202-cad84cf45f1d | 胡须男生人像 |
| photo-8.jpg | u8.svg（王大爷/M） | photo-1507003211169-0a1dd7228f2d | 成熟男士人像 |
| photo-9.jpg | u9.svg（KiKi/F） | photo-1524504388940-b1c1722653e1 | 女生人像 |
| photo-10.jpg | u10.svg（官方小助手/F） | photo-1438761681033-6461ffad8d80 | 微笑女生人像 |

### PC-01 真实照片封面库（P0）

- **目录与命名**：`web/public/img/photos/{category}-{n}.jpg`（n 从 1 连续编号，与 F.1 清单严格一致）；头像见 PC-04。目录内不得出现清单外的文件。
- **规格**：JPEG，宽 800px、`q=70`，单张约 20-200KB；总增量与头像合计 **< 15MB**（预算见验收）。
- **脚本 `scripts/fetch-photos.mjs`**（开发期工具链，Node ≥18 全局 fetch，**零新依赖**，不进 server 运行时）：
  1. PHOTOS / AVATARS 数组**固化 F.1 全部清单**（file / photo-id / 语义备注三元组），URL 由参数模板拼出，脚本内不写死完整 URL。
  2. **可重复执行（幂等）**：目标文件已存在且大小 >10KB 时跳过；`--force` 强制重新下载覆盖。
  3. 下载校验：HTTP 200、`content-type` 为 image/jpeg、JPEG magic bytes（FF D8）、体积 ≥10KB；不满足即删除半成品、计入失败清单，脚本结尾汇总并以非零码退出。
  4. 生成 `web/public/img/photos/CREDITS.md`：每行 `文件 → https://images.unsplash.com/photo-{id}` + Unsplash License 说明（可商用、无需署名、本仓库致谢）。
- **验收**：
  - [ ] `node scripts/fetch-photos.mjs` 产出 37 张封面照 + 10 张头像，文件名与 F.1 清单完全一致
  - [ ] 重复执行第二次输出"全部跳过"，不重复下载（幂等）；`--force` 可强制重下
  - [ ] CREDITS.md 存在且覆盖全部 47 个文件；`git` 仓库资产增量 < 15MB（实测预估 ≈ 3-4MB）
  - [ ] **断网可用**：断开外网启动服务，广场/发现/详情/我的页所有图片正常显示，DevTools Network 无任何外网图片请求

### PC-02 seed 内容真实化（P0）

`server/src/seed.js` 调整（保持现有幂等模式：按 title 判存在，重跑不重复插入）：

**a) 存量 12 条帖子 images 全部替换为真实照片**（`DEMO_MULTI_IMAGES` 表重写为按帖子映射，删除 SVG 引用）：

| 存量帖（title 前缀） | 分类 | 新 images |
|---|---|---|
| 周六中午五道口吃日料放题 | food | food-1, food-2, food-3 |
| 奥森晨跑10km | sports | sports-1, sports-2 |
| 国图自习搭子 | study | study-1, study-2 |
| 鼓楼扫街 | photo | photo-1, photo-2 |
| MAO livehouse独立乐队 | live | live-1, live-2 |
| 元土城遛狗 | pet | pet-1, pet-3 |
| 塘朗山徒步 | sports | travel-2, travel-3（徒步语义，以帖文内容为准） |
| 剧本杀拼车 | boardgame | boardgame-1, boardgame-2 |
| 成都火锅搭子 | food | food-3, food-2 |
| 《沙丘3》IMAX | movie | movie-1, movie-2 |
| 咖啡探店 | coffee | coffee-1, coffee-2, coffee-3 |
| 国贸到望京通勤拼车 | commute | commute-1, commute-2 |

**b) 新增 ≥12 条新帖**（瀑布流内容量翻倍，24 条起），**内容必须像真实小红书帖子**：口语化标题、具体地点+时间、真实可执行的要求（拒绝"找个搭子"式空话）。实现按下表，文案可润色但地点/时间/性别要求/图片映射不得弱化：

| # | 作者 | 分类 | 城市 | 标题示例（口语化） | 地点 | 时间 | 性别要求 | images |
|---|---|---|---|---|---|---|---|---|
| 1 | sherry | travel | 深圳 | 梧桐山夜爬看日出，凌晨三点半好汉坡集合 | 梧桐山好汉坡 | 本周六 03:30 | any | travel-1, travel-3 |
| 2 | xiaoyu | travel | 杭州 | 五一西湖群山徒步组队，宝石山看日落收工 | 宝石山 | 5月1日 15:00 | any | travel-2, travel-1 |
| 3 | xiaoke | game | 北京 | 瓦罗兰特开黑五排，白金以上速来 | 五道口 网鱼网咖 | 周五 20:00 | male | game-1, game-3 |
| 4 | kiki | game | 上海 | 双人成行缺个 P2，通关了我请奶茶 | 网鱼网咖静安店 | 周日 14:00 | any | game-2, game-1 |
| 5 | meimei | shopping | 成都 | 太古里逛街淘小店，会砍价的优先 | 成都太古里 | 本周六 13:30 | female | shopping-1, shopping-2 |
| 6 | kiki | movie | 上海 | 大光明电影院二刷《沙丘3》，散场聊剧情 | 大光明电影院 | 本周五 19:30 | any | movie-2, movie-1 |
| 7 | sherry | coffee | 深圳 | 华侨城创意园咖啡巡礼，一天三家走断腿 | 华侨城创意园 | 本周日 10:30 | female | coffee-2, coffee-3 |
| 8 | runner | sports | 上海 | 世纪公园羽毛球 2 小时，缺 2 人 AA 场费 | 世纪公园 | 本周日 09:30 | any | sports-2, sports-3 |
| 9 | meimei | boardgame | 成都 | 玉林路剧本杀《年轮》还缺 1，哭点低勿入 | 玉林路 某某剧本杀 | 本周六 14:00 | any | boardgame-2, boardgame-1 |
| 10 | xiaoke | other | 北京 | 国博看展搭子，周日上午人少不挤 | 国家博物馆 | 本周日 09:00 | any | other-1, other-2 |
| 11 | xiaoke | commute | 北京 | 昌平线早高峰拼车，沙河→西二旗 | 沙河站 → 西二旗 | 工作日 07:40 | any | commute-2, commute-1 |
| 12 | momo | study | 北京 | 清华图书馆期末周占座搭子，互相监督打卡 | 清华图书馆 | 工作日 08:30 | female | study-1, study-2 |

> 城市覆盖：北京/上海/成都/深圳/杭州 全覆盖（帖子 2 为跨城旅行局，符合真实用法，其余帖作者城市与帖城市一致）。性别要求 mixed：any×8 / female×3 / male×1。content/requirements 字段按同风格补写（≥40 字、含具体要求）。
> 至此 14 个分类每个至少 1 帖（此前 travel/game/shopping/other 为 0 帖）。

**c) 旧 SVG 封面保留**：任何代码不得删除/改名 `covers/*.svg`；前端所有内容 `<img>` 增加 `onerror` 兜底（先切同分类旧 SVG，再切分类 emoji 渐变块），保证本地文件缺失/404 时无破图（C5）。

- **验收**：
  - [ ] 重新 seed 后 24 帖的 `images` 全部为 `/img/photos/*.jpg`（无 SVG 引用）；多图（≥2 张）帖 ≥6 条
  - [ ] 新增帖 ≥12 条；城市覆盖北上成深杭；性别要求含 any/female/male 三种
  - [ ] **随机抽 5 帖进详情页：照片与帖文/分类语义相符**（food=实拍菜品、pet=狗、live=演出现场…），无表情包插画残留
  - [ ] **瀑布流连续滚动 10 屏无重复感**：同屏不出现两张相同封面；同分类封面交替使用变体
  - [ ] 手动删掉某张 photo-*.jpg 模拟 404：前端兜底到同分类旧 SVG，无破图

### PC-03 封面兜底链调整（BE cover 公式 + FE 同步）

`server/src/routes/posts.js` 的 `coverFields()` 升级为三级兜底（`misc.js` 的 recommend/for-you 复用 `coverFields`，一处改动自动同步）：

```js
// 每分类照片数（与 F.1 清单一致，新增照片时同步此表）
const PHOTO_N = { food:3, sports:3, study:2, travel:3, live:3, game:3, movie:2,
                  photo:2, pet:3, coffee:3, shopping:2, boardgame:3, commute:3, other:2 };
export function coverFields(p) {
  const images = safeJSON(p.images, []);
  const n = PHOTO_N[p.category] || 0;
  const photo = n ? `/img/photos/${p.category}-${(p.id % n) + 1}.jpg` : null;   // 按 id 确定性取一张
  return {
    cover: images[0] || photo || `/img/covers/${p.category}${p.id % 2 ? '-2' : ''}.svg`,
    aspect: ASPECTS[p.id % 3],
  };
}
```

- 优先级：`images[0]`（用户配图/seed 真图）→ 分类实拍照（按 id 取模确定性选张）→ 旧 SVG（终兜底）。
- FE 侧 `UI.coverOf`（BE-05 契约）同步为同一三级规则；`UI.aspectOf` 不变。
- 兼容性：存量 DB 中 images 已是 SVG 的旧库不受影响（`images[0]` 命中仍显示 SVG）；只对**无配图**的帖子才落到照片层；23 个测试必须全绿（C3）。
- **验收**：
  - [ ] `GET /posts`、`/recommend`、`/for-you`：无配图帖 cover = `/img/photos/{category}-{n}.jpg`；同 id 多次请求值恒定（确定性）
  - [ ] 用户发布不带图的新帖，广场封面为对应分类实拍照（非表情包）
  - [ ] 存量库（images 为 SVG 的旧数据）展示不回归（C5）；`cd server && npm test` 23 passed
  - [ ] FE 在 mock 掉 cover 字段时兜底规则与 BE 一致（BE-05 契约复测）

### PC-04 头像升级为真人照片（P1 · 可选档）

- 按 F.1 头像清单下载 10 张至 `web/public/img/avatars/photo-{i}.jpg`（`?w=200&h=200&fit=crop&crop=faces`，方形人脸裁切，单张 <30KB）。
- `seed.js` 用户表 avatar 字段：`/img/avatars/u{n}.svg` → `/img/avatars/photo-{n}.jpg`（序号一一对应，性别匹配见清单）；仅影响新 seed，存量 DB 不强制迁移。
- FE `ui.js` 抽 `UI.avatarImg(src, fallbackSrc)` 帮助函数：`<img>` 携带 `onerror`（首败切 fallbackSrc 即对应 `u{n}.svg`，再败清 src 显示昵称首字），`avatarHTML()` 与 `pinCard()` 的头像统一走该函数；其余头像调用点（聊天、评论区）同批替换。
- **验收**：
  - [ ] 10 个演示用户在广场/详情/聊天/我的页头像均为真人照片
  - [ ] 手动将 photo-1.jpg 改名模拟 404：对应头像兜底为 u1.svg，无破图；恢复后正常
  - [ ] `u1-u10.svg` 文件保留在仓库（C5），未改名的存量用户头像不受影响

### PC-05 详情页与个人页实拍观感（P1）

依赖 PC-01/02/03 达成，本条为观感验收档 + 少量补齐：

- **多图帖 ≥4 条**：由 PC-02 表直接满足（存量 4 条 3 图/2 图以上 + 新帖 11 条双图）；详情页轮播（H5-10）每帖均显示 `n/m` 页码且可滑动翻页。
- **me 页网格实拍**：`UI.coverOf` 升级后，「发布/参加」3 列网格（H5-13）自动使用实拍封面；检查无 SVG 表情包封面残留。
- **轮播图 onerror 兜底**：详情页 gallery 每张 `<img>` 带 onerror → 同分类旧 SVG → 分类 emoji 渐变块（与 PC-02c 同一约定）。
- **验收**：
  - [ ] 随机点开 3 条多图帖：轮播 n/m 正确、滑动流畅、图片全部为实拍
  - [ ] me 页「发布/参加」网格全部为实拍封面（方形裁切不变形）
  - [ ] 桌面端（≥1080px 四列瀑布流）同步抽查，无表情包封面

### F.6 验收清单（v2.3 汇总，PM 逐项勾选）

- [ ] PC-01 脚本幂等可重跑，47 个文件（37 封面 + 10 头像）与 F.1 清单一致
- [ ] PC-01 仓库资产增量 < 15MB；CREDITS.md 覆盖全部文件
- [ ] PC-01 断网（无外网）启动：全站图片正常，零外链请求
- [ ] PC-02 24 帖 images 全实拍；新增 ≥12 帖；五城覆盖；性别要求 mixed
- [ ] PC-02 随机抽 5 帖：详情页照片与分类语义相符
- [ ] PC-02 瀑布流连续滚动 10 屏无重复感
- [ ] PC-03 cover 三级兜底生效且确定性；recommend/for-you 一致；23 测试全绿；旧数据不回归
- [ ] PC-04 头像真人化 + onerror 兜底无破图（可选档，未做则此项记"跳过"）
- [ ] PC-05 多图帖轮播 n/m 有内容；me 页网格实拍
- [ ] 全局回归：`covers/*.svg`、`avatars/u*.svg` 全部路径仍 200（C5）；移动端截图走查与 v2.2 基线无意外 diff

### F.7 Roadmap 建议（P2 · 供后续迭代排期，本版不做）

1. **P2-1 发布端图片体验**：发布页支持多图拖拽排序 + 前端 canvas 压缩（长边 1200/q75）再上传，省带宽并保证用户图与 seed 图观感一致；带图发布率进运营看板。
2. **P2-2 封面点击率数据闭环**：postView 曝光/点击埋点，admin 看板加「封面点击率 TOP10」，用数据反哺 F.1 清单的选图与替换节奏。
3. **P2-3 照片库季节化扩容**：每分类补至 4 张（冬滑雪/夏露营等季节变体），按月份确定性切换变体，保持瀑布流新鲜感而不破坏确定性红线。
4. **P2-4 双源容灾**：fetch-photos.mjs 增加 Pexels 备用 URL 列与失败自动切换，避免 Unsplash 单图下架造成素材缺口；CREDITS.md 记录双源。
5. **P2-5 UGC 图片安全审核**：用户上传图接入与敏感词同级的审核队列（先机审后人工），防止实拍化后图片成为新的安全风险面。

---

## G. v2.5 去emoji化·成熟度打磨（EM-xx）

> PM 负责。背景：用户反馈「emoji 用得太多，要对照小红书做成熟应用」。小红书的语言 = 线性图标 + 纯文本 + 真实照片，UI chrome 零 emoji。本章为唯一实现依据，工程师不得自由发挥。

### G.0 审计基线（2026-10-12 全量扫描）

扫描命令（验收同款）：

```bash
grep -rn -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}\x{2190}-\x{21FF}\x{2700}-\x{27BF}]' web/public server/src --include='*.js' --include='*.html' | grep -v node_modules
```

命中 **146 处 / 20 个文件**。分布 Top5：`misc.js` 19、`post.js` 18、`me.js` 16、`server/src/util.js` 14、`seed.js` 11；其余：conv.js 9、ui.js 8、user.js 7、publish.js 7、safety.js 7、chat.js 6、square.js 4、discover.js 4、admin.js 4、login.js 3、app.js 3、posts.js 3、legal.js 1、index.html 1、routes/chat.js 1。
注意：`→`(U+2192)、`♀♂`(U+2640/42)、`★☆`(U+2605/06)、`✕`(U+2715)、`✅`(U+2705) 均落在扫描区间内，**一并视为 emoji 清除对象**。

### G.1 替换原则（EM-00 总纲）

1. **UI chrome 全换线性图标或纯文本**：图标位（cell/通知/空状态/tip/分类）→ `UI.icon` 线性 SVG；按钮、navbar 标题、section-title、chip、角标、pill → 纯文本（允许「图标+文字」组合，禁止裸 emoji）。
2. **toast 与系统文案 → 纯文本**：删除一切装饰 emoji，小红书式克制短句（见 G.8）。
3. **白名单（仅此两处可残留 emoji）**：`server/src/seed.js` 的 UGC 正文——L12 小鱼干 bio 的「🐟」个性签名、L144 meimei 聊天消息的「🍣」。约束：每条 UGC ≤1 个 emoji；**标题、bio 结构字段、location、时间等一律无 emoji**。
4. seed 中的 `→`（如「国贸 → 望京」「老和山→北高峰」）**不属于白名单**：地点改「国贸 — 望京」、路线改「老和山—北高峰—美人峰—宝石山」（文案成熟度，非装饰）。
5. 服务端历史 DB 中已存的「⚠️ 安全提示」消息**不迁移**，仅改新写入文案；演示环境重跑 seed 即清零。

### G.2 EM-01 图标库扩充（ui.js ICON_PATHS）

现有 19 个基础图标（compass/star/plus-square/message-circle/user/search/heart/bell/share/chevron-left/more-horizontal/send/comment/location/clock/people/eye/shield/edit）。**新增以下 20 个通用图标**（Feather 风格 24×24 stroke，`fill="none" stroke="currentColor" stroke-width="1.8"`，此表为唯一实现依据）：

| name | 替换对象 | SVG path |
|---|---|---|
| `folder` | 🗂️ 我的搭局/空状态 | `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>` |
| `settings` | ⚙️ 设置 | `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>` |
| `smartphone` | 📱 账号 | `<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>` |
| `slash` | ⛔ 拉黑/黑名单/无权 | `<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>` |
| `flag` | 🚩 举报 | `<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>` |
| `alert-circle` | 🚨/😵/sos | `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>` |
| `alert-triangle` | ⚠️ 警告 | `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>` |
| `check` | ✅ 按钮/完成态 | `<polyline points="20 6 9 17 4 12"/>` |
| `check-circle` | ✅ 已通过/join_result | `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>` |
| `info` | 💡 发布 tip | `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>` |
| `camera` | 📷 添加图片/摄影分类 | `<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>` |
| `x` | ✕ 关闭/删除图 | `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>` |
| `phone-call` | 🚨 报警/sos 通知 | `<path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94m-1 7.98v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>` |
| `user-check` | 🪪 真人认证 | `<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>` |
| `graduation-cap` | 🎓 学生认证 | `<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>` |
| `bar-chart-2` | 📊 运营后台 | `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>` |
| `book-open` | 📖 安全须知/学习分类 | `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>` |
| `file-text` | 📋 申请管理/📜 公约 | `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>` |
| `zap` | ⚡ 搭力值通知 | `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>` |
| `user-plus` | 🙋 join_request | `<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>` |
| `trending-up` | 🌱 热门空状态 | `<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>` |

**新增 12 个分类图标**（book-open/camera 与通用表共用）：

| 分类 key | name | path |
|---|---|---|
| food | 美食干饭 | `<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>` |
| sports | 运动健身 | `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>` |
| travel | 旅行徒步 | `<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>` |
| live | 演出live | `<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>` |
| game | 游戏开黑 | `<line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>` |
| movie | 电影观影 | `<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>` |
| pet | 遛狗宠物 | `<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>` |
| coffee | 咖啡探店 | `<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>` |
| shopping | 逛街购物 | `<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>` |
| boardgame | 剧本桌游 | `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/><circle cx="12" cy="12" r="1"/>` |
| commute | 通勤拼车 | `<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>` |
| other | 其他搭子 | `<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/>` |

实现要点：① `ui.js` 内新增 `CAT_ICONS = { food:'utensils', sports:'activity', ... }`（key 同分类 key，导出为 `UI.catIcon`）；② `icon()` 支持第三参 `fill`（星评控件用：`star` 实心/描边切换，`fill="currentColor"`）；③ `UI.empty(icon, ...)` 第一参改为**图标名**，渲染为 44px 线性图标外包 72px `--primary-soft` 圆底，全站调用点同步改传图标名（见 G.4 登记表）。

### G.3 EM-02 分类体系去emoji（定稿方案，工程师不用猜）

1. **广场分类 chip（square.js L26/L43/L69/L72）→ 纯文本**：删除 `emoji: '🧭'`（"全部" chip）与 `${c.emoji} `，渲染 `${c.name}`。小红书话题 chip 就是纯文本胶囊，选中态用现有 primary 填充即可。
2. **发布页分类网格（publish.js L35）→ 分类实拍图钉（推荐案，定稿）**：`.cat-item` 改为「上：圆角方图（40×40，radius 10）+ 下：11px 文字」。图片取每分类第 1 张实拍 `/img/photos/{key}-1.jpg`（资产已齐：14 分类 37 张，见 F.1）；`onerror` 兜底 = `UI.icon(CAT_ICONS[key], 20)` 置于 `--primary-soft` 圆底。CSS：`.cat-item .ci` 由 emoji 容器改 `.cat-thumb` 图容器，选中态加 `2px var(--primary)` 描边。
3. **数据结构迁移（明确案）**：`server/src/util.js CATEGORIES` 的 `emoji` 字段**改名为 `icon`**，值为上表图标名（如 `{ key:'food', name:'美食干饭', icon:'utensils' }`）。
   - `server/src/routes/posts.js` L71、`misc.js` L58/L97：`category_emoji` 输出**更名 `category_icon`**（返回图标名，不再返回 emoji；posts.js 的 `|| '✨'` 兜底删除）。
   - FE 消费点同步：`ui.js` L217（pin 无图兜底 `pin-emoji` → `UI.icon(catIcon, 28)` 圆底）、`post.js` L42（detail-hero 无图兜底同上）、`misc.js` L127（`post-emoji` → 线性图标）、`me.js` L107（删除 emoji 前缀，仅留分类名文字）。
   - **测试同步**：`server/test/api.test.js` L582 断言 `c.emoji` 改为 `c.icon`（用例数不变，仍 40 全绿）。
4. 分类名后缀统一核查：「演出live」保留（品牌写法）。

### G.4 EM-03 全站 UI chrome 去emoji · 逐文件登记表（审计 146 条 → 替换规格）

**web/public/js/ui.js（8）**：L92/L93 `genderBadge` ♀/♂ → 文字「女」/「男」12px tag；L191 pin 角标「♀ 仅限女生」→ 纯文本「仅限女生」/「仅限男生」；L203 「已完成 ✅」→ `icon('check',12)+'已完成'`；L217 `pin-emoji` 兜底 → 分类线性图标（见 EM-02）。

**web/public/js/app.js（3）**：L72 `empty('😵',...)` → `empty('alert-circle',...)`；L135 PWA banner 「🤝」→ `UI.icon('logo',40)`；L141 关闭「✕」→ `icon('x',16)`。

**web/public/index.html（1）**：L12 favicon emoji data-URI → `<link rel="icon" href="/img/logo.svg">`（资产已有）。

**web/public/js/pages/chat.js（6）**：L17/L34 通知铃「🔔」→ `icon('bell',20)`；L23/L47 空状态 💬 → `'message-circle'`；L59 列表副标「⚠️ 安全提示」→ 纯文本「安全提示」（`color:var(--danger)`）；L68 😵 → `'alert-circle'`。

**web/public/js/pages/conv.js（9）**：L78 💬→`message-circle`；L89 ⚠️→纯文本「安全提示」；L99 😵→`alert-circle`；L120 「🎓」vbadge → 文字徽章「学生」；L121 👋→`message-circle`；L162 👤→`icon('user',14)`；L163 🚩→`icon('flag',14)`；L164 ⛔→`icon('slash',14)`；L190 toast → 纯文本「已收到举报，我们会尽快核实」。

**web/public/js/pages/square.js（4）**：L26/L69 「全部」chip 去 🧭；L43/L72 chip 去 emoji 前缀（EM-02）；L99 🔍→`'search'`；L107 😵→`'alert-circle'`。

**web/public/js/pages/discover.js（4）**：L19 「🎯 为你而设」→「为你而设」；L28 「🔥 本周热门搭局」→「本周热门搭局」；L31 🌱→`'trending-up'`；L33 页脚「🤝 轻社交…」→「轻社交 · 不婚恋 · 有边界」。section-title 一律纯文本左对齐粗体（小红书式，去图标前缀）。

**web/public/js/pages/post.js（18）**：L42 hero emoji 兜底 → 分类图标（EM-02）；L58 「♀/♂ 仅限xx」→ 纯文本；L71 「📋 申请管理」→「申请管理」；L74 按钮 → `icon('check',14)`+「搭局已完成（开启互评）」；L78 「⭐ 搭后互评」→ 纯文本；L82 「💬 评论区（n）」→「评论区（n）」；L140 → `icon('check-circle',14)`+「已通过，去聊天」；L186 toast→「互评已开启」；L212 toast→「已提交申请，等待组局者通过」；L251 😵→`alert-circle`；L270 🎓→「学生」文字徽章；L274 「✅ 已通过」→「已通过」；L286 toast→「已通过，对方会收到通知」；L319/L335/L347 星评 `★★★★★/☆` → `icon('star',22)` 5 连，选中 `fill="currentColor"`（新增 SVG 星评，替换文本星星）。

**web/public/js/pages/me.js（16）**：L34 「🎓 学生认证」chip →「学生认证」；L37 「📍 城市」→ `icon('location',12)`+城市名；L41 「★ 搭后评分」→ `icon('star',11)`+文字；L57 ⚠️ 提示条 → 纯文本 danger 条「搭力值不足 300，暂不能发布新搭局」；L70-74 五个 cell 图标 🗂️⭐🛡️📊⚙️ → `icon('folder'/'star'/'shield'/'bar-chart-2'/'settings',18)`；L106 删除 `|| '❤'` 兜底（ic() 必返 SVG）；L120 😵→`alert-circle`；L136 空状态 🗂️/🎒→`'folder'`；L160 真人认证 🪪→`icon('user-check',22)`；L165 学生认证 🎓→`icon('graduation-cap',22)`；L173 toast→「真人认证通过，搭力值 +50」；L189 toast→「学生认证通过，搭力值 +30」。

**web/public/js/pages/misc.js（19）**：L83 toast→「已保存」；L118 🗂️→`'folder'`；L136 📍→`icon('location',11)`；L137 🕐→`icon('clock',11)`；L164 ⭐→`'star'`；L175 星评文本 → SVG 星（同 post.js）；L194 通知图标 map → `{ like:'heart', comment:'comment', join_request:'user-plus', join_result:'check-circle', rating:'star', credit:'zap', warning:'alert-triangle', sos:'phone-call', report_result:'shield', post_done:'check' }`；L200 🔔→`'bell'`；L205 `.notif-icon` 渲染 `UI.icon(icons[n.type],16)`（danger 类型 sos/warning 加红点底）；L233 「🛡️ 安全中心」→「安全中心」；L239 SOS 大图标 🚨→`icon('phone-call',30)`+「紧急求助」按钮；L247/L254 📖/📜→纯文本标题；L262 sheet「🚨 紧急求助」→「紧急求助」；L266 ⚠️→纯文本 danger「如遇人身危险，请立即拨打 110」；L292/293/294 设置 cell 📱🛡️⛔→`icon('smartphone'/'shield'/'slash',18)`；L325 toast→「已退出登录」。

**web/public/js/pages/publish.js（7）**：L23 💡→`icon('info',16)`（`.pub-tip-emoji` 类改 `.pub-tip-ico`）；L86 「♀ 女生专属局…」→ 去符号纯文本；L93/L158 「📷 添加图片」→ `icon('camera',20)`+文字；L103 「🚀 发布搭局」→ 纯文本「发布搭局」；L156 删除图「✕」→ `icon('x',12)`；L192 toast→「发布成功，等搭子来找你」。

**web/public/js/pages/login.js（3）**：L9 logo onerror 兜底 🤝 → 文字「搭搭」；L37 「→」→ 文字链接「去注册」/「去登录」；L40 「先随便逛逛 👀」→「先随便逛逛」。

**web/public/js/pages/admin.js（4）**：L7 →「运营后台」；L46 ✅→`'check-circle'`；L63 「⚠️ 警告」→ `icon('alert-triangle',13)`+「警告」；L110 ⛔→`'slash'`。

**web/public/js/pages/user.js（7）**：L23 🎓→「学生」文字徽章；L31 ⭐ pill → `icon('star',11)`+「4.8（12条）」；L46/L52 🏷️/✅→纯文本标题；L59 ⛔→`icon('slash',13)`+「拉黑」；L60 🚩→`icon('flag',13)`+「举报」；L88 toast→纯文本。

**web/public/js/pages/legal.js（1）**：L88 「我的 → 编辑资料」→「我的 · 编辑资料」。

**server/src/util.js（14）**：L79-92 CATEGORIES `emoji` → `icon` 字段（EM-02 迁移表）。

**server/src/routes/posts.js（3）**：L18 注释无 emoji 不动；L71 `category_emoji`→`category_icon`（删 ✨ 兜底）；L299 notify 标题「申请已通过 🎉」→「申请已通过」。

**server/src/routes/misc.js（2 处 emoji 字段引用）**：L58/L97 `category_emoji`→`category_icon`。

**server/src/routes/safety.js（7）**：L11-16 tips 图标 🚨📍🏢💰🍷🤝 → 图标名 `phone-call`/`share`/`location`/`slash`/`eye`/`shield`（FE misc.js 渲染改 `UI.icon(t.icon,18)`）；L39 notify「🚨 紧急求助」→「紧急求助」。

**server/src/routes/chat.js（1）+ seed.js L158**：安全提示消息「⚠️ 安全提示：…」→「安全提示：请勿脱离平台交易或转账，谨防诈骗。首次见面建议选择人多的公共场所。」（仅新写入；旧库不迁移）。

**server/src/seed.js（11）**：L5/L162/L166 console.log emoji 清理；L46/L58/L62/L93 location/content 的 `→` →「—」；**L12 🐟、L144 🍣 白名单保留**（UGC 正文，各 1 个）；标题字段复核均无 emoji，通过。

### G.5 EM-04 空状态视觉规格（全站统一）

`UI.empty(iconName, title, sub)`：72px `--primary-soft` 圆底 + 44px 线性图标（`--primary-deep`）+ 主文案 15px/600 + 副文案 13px `--text-3`。文案口吻：主文案=状态陈述（≤10 字，如「还没有会话」「这里还没有搭局」），副文案=行动指引（如「申请搭局通过后就能聊天啦」）。错误态用 `alert-circle` + `--danger` 描边变体。禁止任何 emoji 与「空空如也」类卖萌用语（misc.js L118 主文案改「还没有内容」）。

### G.6 EM-05 通知中心规格

图标容器 36px 圆形 `--primary-soft`，内嵌 16px 线性图标；类型色映射：sos/warning 底 `#FEECEC` 图标 `--danger`，like/rating/join_result 底 `--primary-soft`，其余灰底 `--bg-2`。通知标题（服务端 notify 的 title 参数）一律纯文本：posts.js L299「申请已通过 🎉」→「申请已通过」，其余复核无 emoji。

### G.7 EM-06 安全中心规格

navbar 标题纯文本；顶部 SOS 主按钮：大号 `phone-call` 图标 + 「紧急求助」+ 副文案「人身安全受威胁时优先拨打 110」，按钮用 `--danger` 实底（小红书式功能钮无装饰）。安全须知 6 条 tip：18px 线性图标（G.4 safety.js 映射）+ 加粗小标题 + 13px 正文，左对齐列表，无图标底色渐变。

### G.8 EM-07 toast / 系统文案口吻

规则：≤14 字陈述句、零 emoji、零感叹号堆叠、不用「～」结尾。对照表（旧 → 新）：「已开启互评 🎉」→「互评已开启」；「已提交申请，等待组局者通过 🙌」→「已提交申请，等待组局者通过」；「已通过 ✅ 对方会收到通知」→「已通过，对方会收到通知」；「评价成功，感谢反馈 💛」→「评价成功，感谢反馈」；「发布成功，等搭子来找你 🎉」→ 保留文案去 emoji；「已保存 ✨」→「已保存」；「已退出，下次再来找搭子哦 👋」→「已退出登录」；「真人认证通过，+50 搭力值 🎉」→「真人认证通过，搭力值 +50」等，全量见 G.4 登记表。

### G.9 EM-08~11 PM 成熟度观察（对照小红书的其余打磨项）

- **EM-08 品牌资产去 emoji**：favicon（index.html L12）与 PWA banner logo 用 `img/logo.svg` / `UI.icon('logo')`，全站唯一品牌符号（握手抽象形），登录页 fallback 文字「搭搭」。
- **EM-09 页面标题一致性**：所有 navbar-title 纯文本、无图标前缀（📊 运营后台/🛡️ 安全中心已列）；标题字号统一走 `--fs-title`，不允许 inline `font-size:20px` 特例（square.js L24 改用 token）。
- **EM-10 性别符号文字化**：♀/♂ 全站替换为「仅限女生/仅限男生」「女/男」（pill/tag 样式），与小红书纯文字 tag 一致；`genderBadge` 输出同步。
- **EM-11 语气词统一**：正文/空状态不再混用「～」「！」；聊天消息文案保留口语但 seed 安全提示、toast、按钮全部陈述句；「先随便逛逛 👀」等处删符号留短句。
- **EM-12 星评控件 SVG 化**：3 处文本星星（post.js 2、misc.js 1）统一为可交互/只读两态 SVG 星组件，半星不支持（5 星整），色彩 `--warning`。

### G.10 验收标准（PM grep + 截图双验，不通过打回）

1. **grep 归零**：G.0 同款命令在 `web/public` 与 `server/src` 的**非白名单文件**命中数为 0；`seed.js` 仅允许 L12（🐟）与 L144（🍣）两行命中。
2. **截图走查**：广场/发现/详情/发布/消息/会话/聊天/通知/我的/安全中心/设置/管理后台/登录 13 页，桌面 + 移动双端截图，人工确认无 emoji 观感；星评、分类网格、空状态、通知图标逐页核对线性图标渲染。
3. **40 测试全绿**：`api.test.js` 用例数不变（L582 断言改 `c.icon`），`npm test` 通过。
4. **白名单清单（允许残留，仅此 2 处）**：`server/src/seed.js` L12 bio「🐟」、L144 聊天消息「🍣」——均为 UGC 正文、每条 1 个、非标题非结构字段。其余任何文件不得命中。
5. 回归红线不破坏：封面三级兜底、头像 onerror 链、TabBar 角标刷新、瀑布流确定性公式（`id%N`）均保持原行为。

## H. v2.9 匹配算法升级（MT-xx）

> 背景：现行 `/for-you`（misc.js L76-117）只做"历史参加分类过滤 + 标签重合数排序"，`/recommend`（L43-73）纯热度。v2.9 引入确定性多维评分模型：0-100、纯函数、可解释、同输入必同输出（与瀑布流 `id%N` 同款确定性红线）。

### H.0 评分总公式（MT-01 后端核心）

```
match_score = round( 100 × Σ(wᵢ × sᵢ) / Σ(wᵢ) )   // 只累加"可用维度"，clamp 0-100
```

| 维度 | 权重 w | 子分 sᵢ（0~1） | 空值判定（该维度剔除而非计0） |
|---|---|---|---|
| 兴趣标签 Jaccard | 30 | `|交集(my.tags, author.tags)| / |并集|`；双方都无标签→剔除 | my.tags 为空 **或** author.tags 为空 |
| MBTI 兼容性 | 15 | 4维度逐项25%，见 H.1 矩阵 | 任一方 mbti 为空串 |
| 同城 | 20 | 完全相等=1；同省=0.6；否则0 | me.city 或 p.city 为空 |
| 分类偏好 | 20 | 该帖 category 在我"参加+发布"历史分类总次数中的占比（无历史→剔除） | 历史分类计数为空 |
| 搭力值信用 | 10 | `clamp((author.credit-300)/500, 0, 1)` | —（credit 有默认值，恒可用） |
| 活跃度 | 5 | 作者7日内发过帖或评论=1，否则0（SQL EXISTS 判定） | —（恒可用） |

- **空值分摊**：被剔除维度的权重从分母消失，等价于按比例分摊给其余维度；用户全空（无标签无MBTI无历史无城市）→ 冷启动路径（MT-02），不出评分。
- 同省判定：城市串为"北京"样式（见 /cities 与 login f-city），取前 2 字相同视为同省；无法判定按 0。允许实现简化为"同城1否则0"，PM 验收以实际代码为准登记。
- 候选池：`status='open' AND author.status='active' AND p.user_id != me AND 拉黑过滤`，取池内全量评分后排序，**不做任何随机打乱**。

### H.1 MBTI 兼容矩阵（每维度命中=25%）

| 维度 | 组合 | 计分 | 规则 |
|---|---|---|---|
| ① E/I | E×I 或 I×E | 25% | 互补 |
| ① E/I | E×E 或 I×I | 15% | 同类（次优） |
| ② N/S | N×N 或 S×S | 25% | **同质** |
| ② N/S | N×S 或 S×N | 10% | 错配 |
| ③ T/F | T×F 或 F×T | 25% | 互补 |
| ③ T/F | T×T 或 F×F | 15% | 同类 |
| ④ J/P | J×P 或 P×J | 25% | 互补 |
| ④ J/P | J×J 或 P×P | 15% | 同类 |

实现为 16×16 常量表或 4 组 if 均可，但必须落成纯函数 `mbtiScore(a, b)`，供测试直接调用。

### MT-02 /for-you 接口升级（BE，misc.js）

1. 响应每帖新增：`match_score`（整数 0-100）、`match_reasons`（字符串数组，≤3条）；保留 `tag_overlap`/`reason` 旧字段兼容未升级卡片。
2. `match_reasons` 生成（确定性，按维度贡献分降序取前3，同分按 H.0 表序）：
   - 标签交集 n≥1 → `「${n}个共同兴趣」`；n≥3 时可加首标签名 `你们都爱「X」`（二选一，代码定死）
   - 同城 s=1 → `同城·${city}`；同省 → `同省·${省}`
   - MBTI 子分=100% → `MBTI互补`；≥50% → `MBTI相合`
   - 分类占比 ≥0.5 → `常参加${分类名}`
   - credit ≥800 → `高信用搭友`；活跃度=1 → `本周活跃`
3. 排序：`match_score` 降序，同分按 `id` 降序；返回条数维持 20。
4. 冷启动（my.tags空 && mbti空 && 无参加/发布历史 && city空）：返回 `{ cold_start:true, list:<热门20条（/recommend同款热度序）> }`，每条不带 match_score。
5. `rec_off` 行为不变（返回空列表+rec_off:true）。

### MT-03 发现页匹配可视化（FE，discover.js）

- 为你推荐卡片右上角匹配度徽章：≥80 橙色文案"高度匹配"、60-79 绿色、<60 灰色，均显示整数如 `92%`（徽章不遮封面兜底图第三级）。
- 卡片下方理由 chips：渲染 `match_reasons`，样式复用 `.pill` 灰底 11px，最多3枚。
- `cold_start:true` 时区块顶部提示条：`选择兴趣标签，解锁精准匹配` + 按钮「去设置」跳 `#/edit-profile`；列表照常展示热门。
- 样式落 `web/public/css/extensions.css`（.match-badge/.match-chips/.cold-tip 三组类），零 emoji（G 章红线延续）。

### MT-04 注册后引导（FE，login.js + discover.js；冷启动闭环）

1. 注册成功（login.js register 分支）写 `localStorage.dada_need_onboard = '1'`。
2. 登录态进入发现页且 `dada_need_onboard==='1'` 且 `dada_onboarded` 未设：弹一次性 sheet（UI.sheet）：
   - 标签网格复用 misc.js 编辑资料的 28 标签池，选 3-10 个（不足3禁用保存，>10 拒选）
   - 城市输入框（预填注册时城市）
   - 「保存」→ `PUT /users/me { tags, city }`（后端已支持 tags ≤10 条、每条 ≤12 字，见 users.js L78-83）→ 写 `dada_onboarded='1'` 清 `need_onboard` → toast「已保存，推荐已更新」并刷新发现页
   - 「跳过」→ 只写 `dada_onboarded='1'`，此后永不弹
3. 已注册老用户不弹（无 need_onboard 标记即静默）。

### MT-05 测试（test/api.test.js 追加）

1. 确定性：同一用户连调两次 `/for-you`，全量 `match_score`/`match_reasons` 逐帖相等。
2. 权重守恒：`src/match.js` 导出 `WEIGHTS`，断言 `Σ=100`（30+15+20+20+10+5）。
3. 冷启动：新注册无标签用户 → `cold_start===true` 且 list 首条=热门首条；补标签后 `cold_start` 消失。
4. reasons：构造 标签交集2 + 同城 + MBTI互补 用户，断言含「2个共同兴趣」「同城·X」「MBTI互补」且 ≤3 条。
5. 回归：`rec_off` 用例、`/recommend`、40 条旧测试全绿。

### H.2 新增/改动文件与分工

| 端 | 文件 | 内容 |
|---|---|---|
| BE 新增 | `server/src/match.js` | 纯函数：`matchScore(me, post, author, ctx)`、`mbtiScore(a,b)`、`WEIGHTS` 导出 |
| BE 改 | `server/src/routes/misc.js` | `/for-you` 接入评分、reasons、冷启动；`/recommend` 不动 |
| BE 改 | `server/test/api.test.js` | MT-05 五组用例 |
| FE 改 | `web/public/js/pages/discover.js` | 徽章+chips+冷启动提示条+MT-04 引导 sheet |
| FE 改 | `web/public/js/pages/login.js` | 注册成功写 `dada_need_onboard` |
| FE 改 | `web/public/css/extensions.css` | .match-badge / .match-chips / .cold-tip / .onboard-sheet 样式 |

### H.3 验收清单（PM 逐项勾选）

- [ ] `GET /for-you` 每帖含整数 `match_score`(0-100) 与 `match_reasons`(≤3条)
- [ ] 同用户两次请求评分逐帖一致（MT-05-1 绿）
- [ ] WEIGHTS 求和=100 断言存在且通过
- [ ] 用户无标签时其余维度分值上升（空值分摊生效，非全0）
- [ ] 冷启动用户返回 `cold_start:true` 且列表=热门序
- [ ] 冷启动提示条出现且「去设置」可达编辑资料页
- [ ] 徽章三档配色正确（≥80橙/60-79绿/<60灰），显示如 `92%`
- [ ] 理由 chips ≤3 枚、文案与后端完全一致
- [ ] 新注册触发一次引导 sheet；跳过后清缓存重进不再弹
- [ ] 引导保存后 tags/city 落库（GET /auth/me 可见），推荐刷新出个性化结果
- [ ] `rec_off` 用户行为不回退（空列表+提示条）
- [ ] MBTI 矩阵抽查：INTJ×ENFP=100%（四维全优）、INTJ×INTP=80%、INTJ×ISTJ=55%（N/S 错配）
- [ ] 全站无 emoji 回归 + `npm test` 全绿

---

## I. v3.0 多维洞察落地

> 版本：v3.0 ｜ 日期：2026-10-20 ｜ 输入：`docs/insights/` 六份报告（vc/market/social/soul/dy/xhs）
> 取舍原则：只选 **价值高 × 成本≤2人日 × 不动架构** 的项，合计 **≈10人日**；其余进 roadmap v3.1+。
> 延续硬约束 C1-C5：零构建、功能不回退、API 只增不改、零外部服务、兼容旧数据；G 章"零 emoji"红线继续生效。

### I.0 选型逻辑（一句话版）

VC 的判词是"不会死于烧钱，会死于数据盲区"——**VD-01 埋点是本轮第一件事**；Social 指出"搭完即止是合法终点，但产品没给关系容器"——**VD-02/03/04 组成搭后关系闭环**；Soul/dy/xhs 各取一个 ≤1.5 人日的转化与体验快赢（VD-05~08）。

---

### I.1 功能规格

#### VD-01 事件埋点 + 成搭漏斗看板（来源：vc §三/§四-1；成本 2 人日）

- **价值**：补上"一行埋点都没有"的第一技术债，六级成搭漏斗（浏览→申请→通过→done→互评→复约）成为后续一切运营与融资叙事的地基；每过一天不埋就永久销毁一天数据。
- **实现要点**：
  - BE `server/src/db.js`：幂等 `CREATE TABLE IF NOT EXISTS events(id, kind, user_id, post_id, meta, ts)` + `idx(kind, ts)`；游客 user_id 为 NULL。
  - BE `server/src/util.js`：新增 `trackEvent(kind, userId, postId, meta)` helper。
  - BE 埋点位置（全部现有路由内加一行，不改响应）：`posts.js` 帖子详情 GET→`view`；POST /join→`apply`；审批→`approve/reject`；标 done→`complete`；互评提交（posts.js:366）→`rate`（meta 含 stars）；`chat.js` 首条私信→`first_msg`、done 后再发消息→`reactivate_chat`；`safety.js` 拉黑/SOS/举报→`guardrail`（女性护栏指标数据源）。
  - BE `admin.js /stats`：新增 `funnel` 字段（六级别 SQL）+ WPU（周成搭用户数）、互评率、供给新鲜度（近 7 天 open 帖占比）、搭后复约率（同一 user 对出现于 ≥2 个 post_id 的 ratings 对数）；存量 count 字段保留不删（C3）。
  - FE `web/public/js/pages/admin.js`：看板新增"成搭漏斗"区块，横条图 + 六级转化率 + 三个比率卡。
- **验收标准**：①浏览/申请/通过/done/互评/举报各触发一次后 events 表有对应 kind 行；②admin 看板显示六级漏斗且各级人数单调不增（复约除外单列）；③WPU/互评率/新鲜度三个数字可见；④`npm test` 全绿，既有接口响应结构不变。

#### VD-02 搭局自动过期 + 搭后提醒定时任务（来源：vc §四-2/3 + social §四-3；成本 1.5 人日）

- **价值**：schema 里 `expired` 状态从不被设置，僵尸 open 帖让供给新鲜度失真；复约提醒直接抬北极星（WPU）与复约率，"场景重现时的可想起性"是搭子复购的决定性瞬间。
- **实现要点**：
  - BE 新增 `server/src/jobs.js`（`setInterval` 每小时，复用 index.js:136 的 `.unref()` 模式，不动架构）：
    1. `meet_time < now-48h` 且 `status='open'` → 置 `expired` + `notify()` 组局者"标记完成或关闭"；
    2. 局 `done` 后 72h 仍有参与者未互评 → `notify()` 提醒互评（互评是信用飞轮入口）；
    3. 老搭子定向推送：ratings 中同 user 对历史互评 ≥4 星的一方发新 open 帖 → `notify()` 另一方"你的搭子又组局了：{title}"。频率上限：每接收者每日 ≤2 条，防打扰。
  - 涉及文件：`server/src/jobs.js`（新增）、`server/src/index.js`（import + 启动一行）。
- **验收标准**：①造一条 meet_time 超 48h 的 open 帖，跑一轮 job 后 status 变 `expired` 且组局者收到通知；②done+72h 未互评用户收到评价提醒且不重复发（幂等：kv 表记已提醒标记）；③老搭子新局触发定向推送、非老搭子不触发、每日上限生效；④job 单轮执行 <1s，失败不 crash 主进程。

#### VD-03 搭后关系走向三选一 + 搭友列表（来源：social §四-1 + soul §三；成本 1.5 人日）

- **价值**：填补生命周期最大空白——互评后关系悬空；"到此为止"把搭完即止合法化（静默归档），"存为搭友"成为微信好友的轻量站内替身，直接反微信黑洞。
- **实现要点**：
  - BE `db.js`：新表 `partners(user_id, partner_id, first_post_id, times, created_at, UNIQUE(user_id, partner_id))`。
  - BE `posts.js`：互评提交成功响应新增 `relationship_prompt: true`；新增 `POST /posts/:id/relationship {choice}`：`end`→仅记录不通知（静默）；`save`→双向 upsert partners（times+1）；`again`→返回原帖 title/content/category/city 骨架 JSON。
  - FE `post.js`/`conv.js`（互评提交处）：弹一次性三选一 sheet（UI.sheet，文案：再约一次 / 存为搭友 / 到此为止；"到此为止"副注"对方不会收到通知"）。
  - FE `publish.js`：进入时读 `localStorage.dada_repost_payload`（三选一"再约"写入）预填表单，保存/清除一次即焚。
  - FE `me.js` + `user.js`：新增"搭友"Tab（BE `users.js` 新增 `GET /users/:id/partners`，含 nickname/avatar/times/最近共同搭局）。
- **验收标准**：①互评后必弹三选一，选后同局不再弹；②"存为搭友"后双方搭友列表互见且 times 正确累加；③"再约"跳发布页字段预填、提交成功后 payload 清除；④"到此为止"对方 notifications 无任何新增；⑤拉黑用户不出现在搭友列表。

#### VD-04 老搭子匹配加权（来源：soul §四-2；成本 1 人日）

- **价值**：把"搭过"这一线下真实见过面的强信任信号回流到匹配——老搭子推荐成功率远高于冷匹配，站内有人等你即天然对抗微信黑洞。
- **实现要点**：
  - BE `misc.js /for-you`：matchScore 输出**后置加分** `score = min(100, score + 10 × min(times, 3))`（times 来自 partners 表），reasons 首位前插「老搭子×N」；响应新增 `partner_times` 字段。**严禁改 `match.js` 的 WEIGHTS**——保住 MT-05-2 的 Σ=100 确定性契约（六维评分纯函数不动，加分在路由层做）。
  - FE `discover.js`：作者行渲染「老搭子×N」角标（复用 .pill 样式，N≤3）。
- **验收标准**：①`match.js` 零改动，WEIGHTS Σ=100 断言仍绿；②有 partners 记录（times=2）的用户 /for-you 该作者帖 score 恰好 +20（未 clamp 时）且 reasons 含「老搭子×2」；③无搭友用户行为与 v2.9 完全一致（回归）；④加分封顶 100 不越界。

#### VD-05 破冰话题卡 + 申请留言建议（来源：soul §一/§四-1 + social §三；成本 1 人日）

- **价值**：搭搭私信门槛高（先同局才可聊），每一句开场都珍贵——直击"首条消息不知道说啥"，预期申请通过率与首日消息率双升；i 人破冰刚需。
- **实现要点**：
  - FE 新增 `web/public/js/topics.js`：按 14 分类 × 通用场景的话题模板常量（30 条起步），规则 = 双方 tags 交集 × 会话关联 post 分类。
  - FE `conv.js`：会话消息 ≤2 条时在输入框上方渲染 2-3 张话题卡，点击填入输入框；发出第 3 条消息后话题卡沉底不再展示。
  - FE `post.js`：申请框上方给 3 条一句话留言模板（按 title/category 规则生成，如"也想去这条路线，我周末都空"），点击填入。
  - BE `chat.js` conv 详情：`other` 补 `tags` 字段、响应补关联 post 的 `category`（只增字段，C3 兼容）。
- **验收标准**：①空会话见 2-3 张与该局分类匹配的话题卡，点击即填入；②消息 ≥3 条后话题卡消失；③申请面板 3 条模板与帖子分类对应；④topics.js 为纯常量文件，零后端逻辑依赖，零 emoji。

#### VD-06 消息级快捷举报（来源：soul §四-4；成本 0.5 人日）

- **价值**：现有举报藏在"···"菜单第 3 层且不带消息证据，人工核实只能翻库；快捷举报让骚扰话术 30 秒内完成取证——女性安全场景的体感关键。
- **实现要点**：
  - FE `conv.js`：气泡长按（移动端）/hover（桌面）浮出"举报此条"操作，直达现有 `POST /users/:id/report`，detail 携带 `conv_id + message_id + 消息内容快照`。
  - BE `users.js`：report 接口已支持 detail 字段（L176-186），仅透传，无 schema 改动；`admin.js` 举报队列详情弹层展示 detail 证据（FE `admin.js`）。
- **验收标准**：①长按/hover 气泡出现举报入口，点击 3 秒内提交成功；②举报落库 detail 含 conv_id/message_id/内容快照三要素；③admin 举报队列可直接看到证据无需查库；④举报自己消息被拒绝；⑤既有"···"菜单举报入口不回退。

#### VD-07 消息已读回执（来源：dy §二/§四-1；成本 1 人日）

- **价值**：找搭子是强时效撮合，"对方看了没回"是核心焦虑——`messages.read_at` 列与写入逻辑（chat.js:80）均已就绪，只差回传与展示，半天后端零 schema 变更。
- **实现要点**：
  - BE `chat.js`：`GET /chat/conv/:id/messages` 每条回传 `read_at`；对方打开会话（触发 L80 批量置读）时经 WS 广播 `peer_read {conv_id, up_to_msg_id}` 给发送方。
  - FE `conv.js`：仅自己发送的最后一条气泡下方渲染 10px 灰字"已读/送达"，收到 peer_read 事件原地更新，不重绘整个列表。
- **验收标准**：①发送方在对方未读时见"送达"，对方进入会话后 2 秒内变"已读"（WS 实时，无需刷新）；②历史消息 read_at 正确回传；③断线重连后状态不错乱（以接口 read_at 为准兜底）；④`messages` 表零 schema 变更，23 个既有测试全绿。

#### VD-08 附近搭局 tab（城市粒度）（来源：dy §一/§四-2；成本 1.5 人日）

- **价值**：距离是搭子第一决策因子（饭搭/运动搭半径常 <5km）；`GET /posts` 的 `city` 参数与 `idx_posts_city` 索引均现成，补上最大的一块板且零后端改造。
- **实现要点**：
  - FE `square.js`：顶部新增"推荐 / 附近"tab；附近 = `GET /posts?city={city}&sort=hot`，卡片角标展示 `location_name`（"朝阳大悦城"比"3.2km"更具体）。
  - FE 城市切换器：登录态默认 profile city、可手切，存 `localStorage.dada_city`（7 天）；游客默认"北京"可切。分类 chips 与附近 tab 可叠加（category+city 双过滤）。
  - 本期**不做**精确定位/坐标/haversine（P2/P3 进 roadmap，待数据验证用户真在意距离）。
- **验收标准**：①切到附近后列表所有帖 city 与所选城市一致（抽 20 条）；②城市选择持久化，重进保持；③游客可用、无需登录；④推荐/附近切换不丢分类与搜索状态；⑤空城市显示空态文案"这座城市还没有搭局，发一个试试"。

---

### I.2 排期表（FE-A / FE-B / BE 并行，合计 ≈10 人日）

| # | BE 任务 | 工作量 | 依赖 | # | FE 任务 | 工作量 | 依赖 |
|---|---|---|---|---|---|---|---|
| BE-1 | events 表 + trackEvent + 7 处埋点 + /stats 漏斗与比率 | 1.5d | 无 | FE-1 | admin.js 成搭漏斗看板区块 | 0.5d | BE-1 |
| BE-2 | jobs.js：过期 / 72h 互评提醒 / 老搭子定向推送 | 1d | 无 | FE-2 | conv.js 话题卡 + post.js 留言模板 + topics.js | 1d | BE-6 |
| BE-3 | partners 表 + relationship 接口 + /users/:id/partners | 0.5d | 无 | FE-3 | 三选一 sheet + publish 再约预填 + 搭友 Tab | 1d | BE-3 |
| BE-4 | /for-you 老搭子后置加分 + partner_times | 0.5d | BE-3 | FE-4 | discover.js 老搭子角标 | 0.25d | BE-4 |
| BE-5 | messages 回传 read_at + WS peer_read | 0.5d | 无 | FE-5 | conv.js 气泡快捷举报 + admin 证据展示 | 0.75d | 无（detail 已透传） |
| BE-6 | chat.js conv 详情补 other.tags / post.category | 0.25d | 无 | FE-6 | conv.js 已读/送达渲染 + peer_read 监听 | 0.5d | BE-5 |
| — | — | — | — | FE-7 | square.js 附近 tab + 城市切换器 | 1.5d | 无（city 参数现成） |

> 关键路径：BE-3 → BE-4 → FE-4（老搭子链最长，先启动）；FE-5/FE-7 与 BE-1 无依赖，可立即并行。测试：`test/api.test.js` 追加 VD-01（埋点落库）/VD-03（relationship 三分支）/VD-04（加分 clamp 与 Σ=100 回归）/VD-07（read_at 回传）四组用例。

### I.3 明确排除项（→ roadmap v3.1+，一句话理由）

| 项 | 排除理由 |
|---|---|
| 话题 tag 系统（xhs-2） | 动 schema+seed+全链路测试 2-3 天，超单项成本线 → v3.1（搜索与分类偏好的公共地基，届时优先） |
| 详情页相关搭局推荐（xhs-1） | 价值认可但预算封顶 → v3.1 候补第 1 位（1 天纯前端） |
| 发布场景模板（xhs-3） | 0.5 天高性价比 → v3.1 候补第 2 位随手带上 |
| 搜索历史+热搜（xhs-4） | 依赖话题 tag 地基更划算 → v3.1 |
| 收藏信号+热度权重修正（xhs-5） | 新表+改热度公式影响推荐链路 → v3.1 |
| 行为风控：申请频控/秒发联系方式/设备指纹（soul-3） | 2 天接近单项上限且需独立回归 → v3.1（开城放量前置条件） |
| i 人模式 ≤3 人小局（social-2） | 价值高成本低的候补第 3 位 → v3.1 |
| 女性安全全流程徽章/报平安/位置共享（social-5） | 位置共享需 LBS 外部依赖 → v3.1 分两期（先徽章+报平安） |
| Web Push 离线推送（dy） | 强制 HTTPS + iOS 到达率打折 → v3.1 |
| 气泡表情回应（dy） | 锦上添花 → v3.2（与群聊一起） |
| 高校认证（market-1） | 人工审核运营流程重于代码 → v3.1 随校园冷启动 |
| 城市运营位/开城开关（market-2） | 需运营流程配套 → v3.1 开城时一并 |
| 搭局群聊（market-3） | 需群会话模型，动消息架构 → v3.2 |
| 搭子履历分享卡（market-5） | 长图渲染需独立设计 → v3.1 获客期 |
| 被拒后可重新申请（vc-5） | 改 joins UNIQUE 约束属 schema 语义变更，"不动架构"红线内不做 → v3.1 |
| 会员搭搭Plus（vc §二） | 变现节奏等 VD-01 漏斗数据出来再定 → v3.1 |
| 全屏上滑沉浸流（dy §三） | 抖音专家已判定不适合高决策搭局场景 → 永久排除 |
