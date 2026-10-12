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
