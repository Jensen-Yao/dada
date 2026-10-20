# R4 兼容性批评：10 项（P0×3 硬白屏 / P1×3 功能坏 / P2×4 体验）

> 评审视角：浏览器兼容 / 低端设备 / 极限环境（R4 新视角）。
> 方法：静态扫描（15 个前端脚本逐文件 grep）+ Playwright(Chromium 1247) 实测留证。
> 截图证据：`/tmp/compat-*.png`（17 张）；测试数据 fixture：用户 `compat_x`(uid 34, 64 字昵称/10 tags)、post 58(40 字标题)、post 57(6 图)、conv 8(500 条消息)。
> 服务环境备注：评审中发现 :3000 长驻进程曾持有**已删除的 dada.sqlite 旧 inode**（DB 文件被删除重建而服务器未重启，新旧进程各写各的库）——已重启对齐。这本身是一个运维兼容性隐患，建议 `start.sh`/部署脚本在删除 DB 后强制重启，或禁止运行中删库。

## R4兼容性批评：10项（P0硬白屏/P1功能坏/P2体验）

### P0 —— 硬白屏（老环境整站不可用）

**[K1] ES2020+ 语法全量裸奔，旧内核解析即崩 | 实测+静态** | 影响：iOS Safari ≤13.0、微信老 X5 内核（Chromium <80）、Android System WebView <80 用户**全部白屏**，且无任何提示。
- 前端为 15 个 classic `<script src>`（无 `type=module`、无 babel/esbuild），但 **15/15 个文件**共使用 `?.` 可选链 **69 处**、`??` 空值合并 **9 处**（api.js/ui.js/ws.js/app.js 及全部 12 个页面脚本，如 `api.js:27 json?.error`、`ui.js:105 s ?? ''`）。
- 可选链需 Safari 13.1+ / Chromium 80+。旧内核在**解析阶段**直接 SyntaxError，每个 `<script>` 文件整体作废：`API`/`UI`/`App` 全部未定义 → 首个依赖它们的脚本抛 ReferenceError → `#app` 永远空白。这不是"功能降级"而是"整站死亡"。
- 次级 API（在此类内核上同样缺失，但被 K1 掩盖）：`IntersectionObserver`（square.js:106 无守卫，Safari 12.2 才有）、`scrollIntoView({behavior:'smooth'})` options（旧 Safari 静默忽略，无害）。
- **babel-free 降级方案（三选一）**：
  - A（零成本，接受范围声明）：按文末声明收窄支持范围，同时加一个 20 行的**体检脚本**放在最前（`<script>` 内联，ES5 语法）：`try{new Function('({a}={})=>a?.b??1')}catch(e){document.body.innerHTML='当前浏览器过旧，请升级后使用'}`——至少白屏变白话。
  - B（推荐，约半天）：机械改写 `?.`/`??` 共 78 处（`a?.b` → `a && a.b` 模式，`??` → `!==null&&!==undefined||` 三元），优先 api/ui/app/ws/login 五个壳文件，保证旧内核可启动并弹升级提示；配合 K2 修复，可把底线拉到 Safari 13.1 / Chromium 80 / 主流 X5。
  - C（长期）：接入 esbuild/swc 构建（`target: es2018`），一次配置永久解决，代价是引入构建步骤。
- 修复验证点：`grep -cE '\?\.' web/public/js/**/*.js` 归零或构建管线落地。

**[K2] `#app{height:100dvh}` 无 vh 回退，旧内核内容区塌陷为 0 | app.css:62** | 影响：**Safari <15.4（含全部 iOS 14/13，2022年3月前的 iPhone）**、Chromium <108、微信 XWeb 107 及更早 —— 内容区高度塌陷。
- `#app { height: 100dvh; ... }` 单一声明，无 `100vh` 先行回退；`#page-container` 为 `flex:1 + overflow:hidden`，父级高度失效后 flex 子项塌为 0。
- 实测（Chromium 中注入 `#app{height:auto!important}` 模拟不识别 dvh 的内核）：`containerH` 788px → 塌陷，`.page` 高度仅 68px；截图 `/tmp/compat-dvh-collapsed.png` 显示**整页只剩 TabBar，内容区全白**——与旧真机表现一致。
- 修复（一行）：`#app { height: 100vh; } #app { height: 100dvh; }`（旧内核取 vh，新内核取 dvh）。

**[K3] localStorage 被禁（严格隐私模式/禁所有 Cookie）→ 整站白屏 | api.js:6、app.js:141-142** | 影响：iOS Safari 严格防跟踪、Chrome"阻止所有 Cookie"用户——直接不可用，**连登录页都不渲染**。
- `api.js:6` `function token() { return localStorage.getItem(TOKEN_KEY) || ''; }` **无 try/catch**；`app.js:141` `localStorage.getItem('dada_need_onboard')` 直接调用。存储被禁时访问 `window.localStorage` 属性即抛 `SecurityError`，`render()` 内未捕获 → boot 死亡。
- 实测（defineProperty 模拟属性级 SecurityError）：页面文本为空、0 卡片、无 TabBar，1 条 `PAGEERROR: Failed to read the 'localStorage' property from 'Window': Access is denied`（截图 `/tmp/compat-storage-blocked-guest.png`）。登录路径 `API.setSession`（api.js:52-55 setItem 无守卫）同样会炸。
- 对照实验：**只读内存型**存储（getItem 正常、setItem 抛 QuotaExceededError——类旧 iOS 私密模式）实测全站正常浏览（20 卡片/我页/500 条会话渲染，0 JS 错误）——说明真正致命的是"读就炸"的属性级拦截；但此时**新登录必失败**（login.js:180 setSession 抛错被外层 catch 吃掉，仅 toast 报错原文，用户看不懂），且 `misc.js:417` 大字开关、`discover.js:198/209` 引导标记的 setItem 均无守卫，点击即抛。
- 修复：10 行 `safeStorage` 包装（get/set/remove 全 try/catch + 内存 Map 兜底），替换 api.js/app.js/misc.js/discover.js/post.js 中 8 处裸调用。login.js:84-97 的草稿读写已有完整 try/catch，是现成的正面教材。

### P1 —— 功能坏

**[K4] 中文输入法组合期 Enter 误发（经典 bug，两处）| conv.js:306、post.js:206** | 影响：iOS 全系 + 微信内置浏览器的高频误发——**拼音原样发给搭友**。
- `input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });` 不检查 `e.isComposing`/`keyCode===229`。Safari 上按 Enter 确认候选词时 keydown 的 `key==='Enter'` 且 `isComposing===true`。
- 实测（合成 CompositionEvent + `keydown{key:'Enter',isComposing:true,keyCode:229}`）：**WS chat 帧实际发出 `{"type":"chat","content":"ni hao"}`**（拦截 WebSocket.send 取证）；post 页评论区同样触发：输入框被清空且评论未发出（**用户输入丢失**）。
- 修复（每处一行）：`if (e.isComposing || e.keyCode === 229) return;`

**[K5] `matchMedia().addEventListener` 无兼容，iOS 13.4~13.x 聊天页报错 | conv.js:11** | 影响：Safari <14（MediaQueryList 未继承 EventTarget）——能过 K1 语法关的 iOS 13.4~13.7 用户，打开消息页即"页面出错了"。
- `matchMedia('(min-width:768px)').addEventListener('change', () => location.reload())` 在 MQL 无 `addEventListener` 的内核上抛 TypeError，位于 `App.register` 回调同步段 → 页面级错误态。
- 修复：`(mq.addEventListener || mq.addListener).call(mq, 'change', fn)`。
- 同源小项：`sw.js` 用 `Promise.allSettled`（Safari 13+，与 K1 底线一致，可接受）；`navigator.clipboard`（post.js:177）Safari 13.1+ 且需安全上下文，见 K10。

**[K6] 768 断点跨越触发整页 `location.reload()`，折叠屏用户输入稿必丢 | conv.js:11-13** | 影响：折叠屏展开/收起、桌面拖拽窗口、横竖屏旋转——正在打字的内容清零。
- 实测：780→767、767→780 双向均发生整页 reload（页面级 `window.__marker` 丢失），**`#f-msg` 中已输入的"跨断点草稿"被清空**；780px 侧分栏结构（左 320px 列表 + 右聊天）本身渲染正常（截图 `/tmp/compat-fold-780-recross.png`、`/tmp/compat-vp780-conv.png`）。
- 评价：断点跨越"整页刷新保证结构一致"是可接受的工程取舍，但**reload 前不保草稿**不可接受。修复：`beforeunload` 时把 `#f-msg` 值写 sessionStorage（login.js 草稿模式照抄），reload 后回填；或改为按断点分别重建页面而非 reload。

### P2 —— 体验/边界

**[K7] 系统深色模式零适配，夜间大片刺眼白 | 全局** | 影响：深色系统用户夜间使用观感差。
- 实测（`colorScheme:'dark'`）：`body` 背景 `rgb(246,247,249)`、无 `color-scheme` meta、三份 CSS 中 **0 条** `prefers-color-scheme` 规则（截图 `/tmp/compat-dark-square.png`、`/tmp/compat-dark-post.png`——整屏浅色大卡）。
- 修复建议：最小成本方案是加 `meta name=color-scheme content="light"` 显式声明"仅浅色"，避免 WebView 强制暗化把 navbar 的 `rgba(255,255,255,.92)` 和橙色主题搅成脏色；完整方案需定义 `--bg/--card/--text` 暗色 Token 层（约 40 个变量，工程量中等，可排期到 R5+）。

**[K8] 极端视口与大字模式叠加 | 240/320px、大字+150%** | 影响：超窄机型/大字用户聊天不可输入。
- **320px（iPhone SE 1代）**：✅ 全部正常——瀑布流两列、卡片标题 2 行钳制、TabBar 五项无溢出，页面级 `scrollWidth==320`（截图 `/tmp/compat-vp320-*.png`）。分类 pill 横滚条内元素超出视口属容器内滚动，非破版。
- **240px 超窄**：❌ 会话页输入区被裁——`input#f-msg` 宽 231px、`#btn-send` 右缘 300px，**发送按钮完全在视口外不可点**（截图 `/tmp/compat-vp240-conv.png`）。修复：输入行 `flex` 最小宽 + `input{min-width:0}`，或 260px 以下隐藏 emoji 类附加钮保发送钮。
- **大字模式 + 150% 字体缩放**：大字开关本身工作正常（`data-bigfont=1`，body 16.5px）；但叠加 150%（以 body zoom 1.5 近似 Android WebView textZoom）时，320px 下**聊天输入栏与 TabBar 整体被推出视口外**（截图 `/tmp/compat-font150-conv.png` 底部无输入区），无法发消息。修复：输入区高度用 `min()` 钳制/允许 `#app` 内滚动，并真机验证 iOS"更大字体"档位。
- **2560px 超宽**：✅ 正常，瀑布流 `max-width:1024px` 居中，无拉伸破版（截图 `/tmp/compat-vp2560-*.png`）。
- 附：`conv.js` 视口判定已按红线走 matchMedia ✓；但 desktop.css 只有 768/1080 两档，780~1079px 区间布局功能正常仅留白多，可接受。

**[K9] 会话消息全量渲染：500 条一次进 DOM，无分页/虚拟化 | 服务端 chat.js + conv.js:256-277** | 影响：长会话在低端机必然卡顿，且是随时间恶化的结构性隐患。
- `GET /chat/conv/:id/messages` **无 LIMIT/游标**，一次返回全部；前端 `msgsEl.innerHTML = messages.map(msgHTML).join('')` 一次性注入。
- 实测（桌面 Chromium，2023 级机器）：500 条 → 加载 446ms、DOM 1001 节点、innerHTML 185KB、60 步往返滚动 498ms、`scrollHeight` 62028px。桌面尚可，**千元机 WebView 按 3-5 倍放大预计首开 2s+、滚动掉帧**；若会话到 5000 条则直接不可用。
- 修复：服务端游标分页（`before_id` + LIMIT 50，向上滚动取历史），前端保留"进入定位最新一条"。这是性能项但由兼容边界触发，建议 R5 排期。

**[K10] 分享/复制在低配环境静默失败 | post.js:176-179** | 影响：HTTP 局域网部署、老 WebView 上点分享无任何反应。
- `if (navigator.share) ... else { await navigator.clipboard.writeText(url) }`——`clipboard` 仅安全上下文可用（`http://192.168.x.x` 局域网 IP 直接 undefined），异常又被 `catch { /* 用户取消 */ }` 吞掉，用户点了没反应且被误标为"取消"。
- 对照组：`createImageBitmap` 压缩（publish.js:186-210）有完整 try/catch 回退原图 ✅——同一代码库两种标准。
- 修复：clipboard 失败回退 `document.execCommand('copy')`（textarea 选区法），仍失败则 toast 展示链接原文。

## 兼容合格项

- **IntersectionObserver 触底分页**（square.js:106）：Safari 12.2+/Chromium 51+ 全绿，`rootMargin 200px` 预载 + onCleanup 断开，失败态可点击重试。
- **createImageBitmap 压缩链路**（publish.js:186-210）：API 缺失/解码失败/压完更大，三路回退原图且不阻塞发布，是本代码库兼容处理的标杆。
- **SW 离线架构**（sw.js）：预缓存 20 个壳资源 + API Network-First 回退 + 导航回退 SPA 壳。实测预缓存完成后，**飞行模式 5 轮进出循环全部优雅存活**：离线 reload 壳正常、广场 20 卡片与会话 500 条消息离线可读、离线发送有明确 toast（"连接已断开，正在重连…"）且**输入不丢字**、恢复在线后 WS 立即重连（`online` 事件重置退避计数）且重发成功。
- **WebSocket 重连**（ws.js）：指数退避上限 8 次 + 4001 认证失败不空转 + online 立即重连，5 轮离线循环未耗尽重试额度。
- **极端数据渲染全绿**：64 字昵称在广场卡片/详情页作者行正确省略号截断；我页/TA 主页 7 行换行不破版不遮挡（丑但可用，建议加 `-webkit-line-clamp:2`）；40 字标题卡片 2 行钳制 + 详情页完整换行（截图 `/tmp/compat-data-post40.png`）；10 个 tags 在 TA 主页全部渲染换行正常（我页 `slice(0,4)` 为设计取舍）；**6 图轮播** "1/6" 指示器 + 首屏外图片懒解码（6 节点仅 3 张解码，截图 `/tmp/compat-data-6img.png`）。
- **视口健壮性**：240/320/390/780/2560px 五档页面级零水平溢出（`scrollWidth==clientWidth` 全部成立）。
- **500 条消息滚动**：桌面级硬件上无病态卡顿（446ms 加载 / 498ms 滚动 60 步），问题在低端机外推与增长曲线（见 K9）。
- **输入长度防线**：消息 maxlength=2000、标题 maxlength=40、签名 maxlength=200 与服务端上限逐项对齐（misc.js/post.js/conv.js）。
- **首帧防闪**：index.html 大字模式读取有 try/catch，登录页草稿 get/set 双向 try/catch（login.js:84-97 正面教材，K3 修复照此办理）。
- **已知数据口径差（非浏览器兼容，备忘）**：昵称注册上限 20（auth.js:116）、资料编辑服务端截到 60（users.js:79）而前端输入框 maxlength=20（misc.js:20）——64 字昵称只能由历史数据/接口直调产生，前端渲染不崩但三处口径建议统一。

## 最低支持环境声明建议（写给 README）

> 以下建议按"是否执行 K1-K5 修复"分两档。

**修复前（当前代码的真实底线）**

```markdown
## 浏览器支持范围

搭搭 Web 需要较新的浏览器内核，以下环境**官方支持**：

- iOS Safari ≥ 15.4（iPhone：iOS 15.4 / 2022年3月以后的系统更新）
- Android Chrome / System WebView ≥ 108
- 微信：iOS 15.4+ / Android 微信 XWeb 内核 ≥ 108（建议将微信更新至最新）
- 桌面 Chrome / Edge ≥ 108，Safari ≥ 15.4，Firefox ≥ 100

**不支持**：iOS 15.4 以下、Android 7 以下旧 WebView、未更新 XWeb 的老版本微信、
浏览器开启"阻止所有 Cookie/网站数据"（App 依赖本地存储保存登录态）。
不满足时 App 可能白屏或无法登录，不会有额外提示。

说明：PWA 离线能力（断网可浏览已加载内容）仅限 https 或 localhost 访问。
```

**执行 K1 方案B + K2 + K3 + K5 修复后（建议的争取目标）**

```markdown
- iOS Safari ≥ 13.1 / iOS 14+（需同步落地 K5 的 addListener 兼容与 K4 的输入法修复）
- Android Chrome / WebView ≥ 80（需 K2 的 100vh 回退落地）
- 微信 X5 / XWeb 近三年内核版本
- 「阻止 Cookie」模式下可浏览，登录与设置类写操作将提示"当前浏览器隐私模式限制了本地存储"
```

**给开发的三行优先级**：K2（一行 CSS 救回所有 iOS 14）→ K4（一行 JS 救回所有 iOS 输入法用户）→ K3（十行 safeStorage 救回隐私模式用户）。K1 修复成本最高，若短期不做，请务必加上方案 A 的"体检提示脚本"，让白屏至少变成一句人话。

---
*评审证据索引：静态扫描（15 文件 69×`?.`、9×`??`）；截图 /tmp/compat-{vp320,vp240,vp780,vp2560}-*.png、compat-dvh-collapsed.png、compat-data-*.png、compat-dark-*.png、compat-font150-*.png、compat-storage-*.png、compat-off2-*.png、compat-ime-conv.png、compat-fold-780-recross.png；日志 /tmp/compat-part1.log、/tmp/compat-part2.log、/tmp/compat-offline2.log。*
