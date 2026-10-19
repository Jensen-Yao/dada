# UX批评R1：18项（8项P1硬伤 / 10项P2打磨）

> 实测环境：DADA_PORT=3961（seed 数据），Playwright chromium-1247，移动 390×844（含 iPhone UA 模拟）+ 桌面 1366×900 + 横屏 844×390 + CDP 弱网（latency 400ms）。
> 全部截图在 `/tmp/ux-*.png`（33 张）。对比度按 WCAG 2.1 相对亮度公式计算。
> 范围排除：emoji 清理、404 深链、破图兜底、toast 防叠（已修项未重复计入）。

---

## P1 硬伤（真实阻碍任务完成 或 违反 WCAG AA/A）

### [U1] 次要文字对比度全面不达标：#A5ABB2 on #F6F7F9 = 2.16:1（要求 4.5:1）
- **复现**：广场任意卡片的城市/时间/「还缺N人」行（computed style 实测 `color: rgb(165,171,178); font-size: 11px`）。
- **证据**：`/tmp/ux-square-mobile.png`；实测值：`--text-3 #A5ABB2` on `#F6F7F9`=**2.16**、on 白卡=**2.32**（`--text-2 #6B7178` on bg=4.60 刚过线）。
- **影响**：WCAG 1.4.3 (AA) 违反。`--text-3` 被用于 pin-meta、post-stats、conv-last（13px 会话摘要）、conv-time、empty 副文案、me-stat 标签——全站元信息对低视力/强光户外用户近乎不可读，且叠加 11px 小字号（见 U11）放大伤害。
- **修复**：`web/public/css/app.css:16` 改 token：`--text-3: #6B7178;`（on #F6F7F9=4.60 / on 白=4.93，双场景过线；与 --text-2 同色即可，或 `#656C73`）。一处 token 改动全站生效，无需逐组件改。

### [U2] 主 CTA 按钮白字对比不足：渐变浅端 #FF9A62 上白字 = 2.09:1
- **复现**：登录页「登录」按钮、发布页「发布搭局」、详情页「申请加入」——`.btn.primary`（`linear-gradient(135deg, #FF7A45, #FF9A62)` + `color:#fff`，15.5px 加粗）。
- **证据**：`/tmp/ux-login-mobile.png`、`/tmp/ux-publish-mobile.png`；实测：white on #FF7A45=2.59、on #FF9A62=**2.09**、on #F05A24=3.39（均 < 4.5）。
- **影响**：WCAG 1.4.3 (AA) 违反。核心转化按钮（登录/发布/申请）文字对比不足，弱视用户辨认吃力；`.input:focus` 边框 #FF7A45（2.59）也低于控件 3:1 要求（1.4.11）。
- **修复**：加深渐变右端：`--grad-primary: linear-gradient(135deg, #E8541F, #F05A24)`（white on #E8541F=3.67、on #F05A24=3.39——15.5px 加粗仍差一线）。最稳做法：CTA 文字升到 16px 并加 `text-shadow: 0 1px 2px rgba(0,0,0,.18)`，或直接采用实底 `#D14514`（4.59 过线）作 CTA 底色、渐变只留给装饰性场景。`:focus` 边框同步改 `#E8541F`。

### [U3] 键盘完全无法进入任何搭局卡片（广场核心任务不可完成）
- **复现**：390 与 1366 任意视口，广场页只按 Tab：焦点链为 城市按钮→通知→搜索框→分类 pill×N→TabBar，30 次 Tab 内 `document.activeElement.closest('.pin-card')` 永远 false；Tab 再 25 次亦不可达。
- **证据**：`/tmp/ux-focus-tab.png`；DOM 实测 `.pin-card` = `<div>` 无 `tabindex` 无 `role`（square.js:110 只绑 `onclick`）；点赞 `.pin-like` 是 23×19px `<span>` 同样不可聚焦。
- **影响**：WCAG 2.1.1 (A) 违反。键盘用户「浏览→进详情」这一主路径 0% 可完成（移动+桌面均确认）；读屏用户听到的是一堆不可点的文字。
- **修复**：ui.js `pinCard()` 把整卡包进 `<a class="pin-card" href="#/post/${p.id}">`（保留 div 结构亦可：`role="button" tabindex="0"` + square.js `bindCards` 里加 `keydown` Enter/Space 分支）；`.pin-like` 改 `<button aria-label="点赞，N人">`（顺带解决 U9 一角）。

### [U4] 底部弹层：Esc 关不掉、无对话框语义、打开不移焦、申请/评分 sheet 无取消出口
- **复现**：广场点「全部城市」→ 按 Esc → sheet 仍在；详情点「申请加入」→ 按 Esc → 仍在，且整张 sheet 只有「提交申请」一个动作按钮（城市 sheet 只有选城市，评分 sheet 只有提交）。
- **证据**：`/tmp/ux-sheet-city.png`、`/tmp/ux-sheet-join.png`；实测 `Esc 后仍存在: true`（两种 sheet 均复现）；`role/aria-modal/aria-label` 全为 null（ui.js `sheet()` 只挂了 mask 点击关闭）。
- **影响**：键盘用户打开申请 sheet 后唯一退出方式是提交申请——「看了想反悔」这条路不存在；读屏用户不知身处模态（1.3.1/4.1.2 A 级违反）；焦点仍留在被遮罩的背景页，Tab 顺序错乱。
- **修复**：ui.js `sheet()` 内补三件事：① `mask.tabIndex=-1; mask.setAttribute('role','dialog'); mask.setAttribute('aria-modal','true'); mask.setAttribute('aria-label', title)`；② `document.addEventListener('keydown', e => { if(e.key==='Escape' && !opts.locked) close(); }, {once 处理})`；③ appendChild 后 `mask.querySelector('button')?.focus()` 并记录 `previouslyFocused` 关闭时归还；④ 申请/评分/城市 sheet 顶部加 `.sheet-close` 取消按钮（`aria-label="关闭"`）。

### [U5] 弱网首屏约 2 秒整页空白，骨架屏只在末尾闪现 300ms（闪跳）
- **复现**：CDP `Network.emulateNetworkConditions` latency=400ms 打开广场：+921ms/+1411ms/+1940ms 采样均 `hasNavbar:false, hasSkeleton:false, pageHTMLLen:0`（页面容器全空），+2261ms 直接 cards=10——骨架屏从未在采样中可见，或只在 ~1.9s→2.2s 间一闪而过。
- **证据**：`/tmp/ux-blank-900ms.png`（灰白空屏）vs `/tmp/ux-skeleton-1400ms.png`（仍空）vs `/tmp/ux-slownet-square.png`（成品）。
- **影响**：弱网/电梯/地铁场景用户面对 2 秒纯灰屏，第一反应是「崩了」直接离开。根因：square.js 先 `await App.meta()`（一次网络往返）**之后**才 `render()` 写入骨架屏——骨架屏形同虚设，还造成「无指示→突然出内容」的跳变。
- **修复**：square.js 把骨架渲染提到 meta 之前：`el.innerHTML = renderHeader骨架版() + UI.wfSkeleton(6)` 先同步 paint，`meta` 改为 `metaPromise = App.meta()` 与列表请求并行、或失败时用本地 CATEGORIES 兜底（meta 只是分类/费用枚举，可 localStorage 缓存）。同类问题存在于所有先 await 再 render 的页面（discover/post/publish 均先 `App.meta()`）。

### [U6] 表单 label 全部未关联输入框；登录/注册输入框连视觉 label 都没有
- **复现**：发布页 11 个 `<label>` 无一有 `for`（实测 `associated:false` × 11，publish.js:32-103）；登录/注册页所有 input 仅靠 placeholder（`#f-user`/`#f-pass`/`#f-phone`/`#f-code`… 无 label、无 aria-label、无 wrapping label；`#f-gender` select 完全无名）。
- **证据**：`/tmp/ux-publish-mobile.png`、`/tmp/ux-login-mobile.png`；DOM 扫描输出 `hasLabelFor:false` 全列。
- **影响**：WCAG 3.3.2/1.3.1/4.1.2 (A) 违反。读屏用户在登录页听到 5 个无名编辑框；placeholder 输入即消失，认知负担转嫁（适老化负面）；点击 label 不聚焦 input（移动端小屏误触无救济）。
- **修复**：publish.js 每个 `<label>` 加 `for="f-title"` 等（id 已存在，纯模板字符串改动）；login.js 各 input 加 `aria-label="手机号或用户名"` 等，或包 `<label>`；`#f-gender` 加 `aria-label="性别"`。半小时可全改完。

### [U7] viewport 禁用缩放：`user-scalable=no, maximum-scale=1.0`
- **复现**：`web/public/index.html:5`：`<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">`。
- **证据**：源码即证据；Capacitor Android WebView（android/ 打包目标）与 Firefox Android 会尊重该标记，双指缩放被禁用。
- **影响**：WCAG 1.4.4 (AA) 违反。低视力/老花用户无法放大 11px 小字（见 U11），在打包 App 内是确定性阻断；移动 Chrome/Safari 虽忽略该标记，但 H5 在第三方 WebView（微信内打开等）同样被禁。
- **修复**：改为 `content="width=device-width, initial-scale=1.0, viewport-fit=cover"`；Capacitor 壳内缩放体验如需控制，用 `android/app/src/main` 的 `WebSettings.setDisplayZoomControls(true)` 替代禁缩放。

### [U8] 图标按钮无障碍名缺失：返回/通知/分享/删图按钮读屏念「按钮」
- **复现**：广场顶栏通知按钮（34×34，仅 SVG）、详情页返回/分享按钮、发布页删图 × 按钮——textContent 为空、aria-label 为 null（实测 nameless 清单 + 详情栏 ariaLabel 全 null）。
- **证据**：`/tmp/ux-focus-tab.png`（焦点链第 2 项 text:""）；审计输出 `nameless:[{id:"btn-notif"}]`、详情操作栏 `ariaLabel:null` × 6。
- **影响**：WCAG 4.1.2 (A) 违反。读屏用户在每张卡片/每个详情页都会遇到 2-3 个无名按钮，导航只能靠猜。
- **修复**：模板里补 `aria-label`：post.js 返回 `aria-label="返回"`、分享 `aria-label="分享"`；square.js `#btn-notif` `aria-label="通知"`；publish.js 删图 `aria-label="删除图片"`；点赞按钮 `aria-label="点赞，N 人"`（N 动态更新时同步改 aria-label）。

---

## P2 打磨

### [U9] 内容图片 alt 全空：广场 10/10 卡、详情轮播均 alt=""
- **复现**：广场前 10 卡实拍图 `alt=""` × 10；详情轮播 `alt:"" × N`（ui.js:92/299、post.js:41 统一输出 `alt=""`）。
- **证据**：审计输出 `emptyAlt:10, missingAlt:0`；`/tmp/ux-detail.png`。
- **影响**：小红书式产品里封面图即内容（美食实拍/场地照），空 alt 让读屏用户丢失主要信息维度；有争议（卡内有标题文字）故列 P2，但轮播大图（详情页主体内容）必须给 alt。
- **修复**：`pinCard()` 中 `alt="${esc(p.title)}"`；轮播 `alt="${esc(p.title)} 第${i+1}张"`；头像 `alt="${esc(nickname)}的头像"`。

### [U10] 点击目标大面积小于 44px：广场 18 个、发布页 9 个、详情操作栏全列
- **复现**：分类 pill 高 29px×14 个、顶栏按钮 34×34、发布页分段按钮高 35px、人数 ± 按钮宽 40px、详情底栏点赞/评论 28×34、主按钮 36px 高。
- **证据**：审计输出（smallCount:18 + publish 9 + detail 栏尺寸）；`/tmp/ux-detail.png`。
- **影响**：WCAG 2.5.5 (AAA) 参考 / 移动可用性红线（Apple 44pt/Android 48dp）。拇指误触率高，尤其详情底栏是高频操作区。
- **修复**：CSS 三处：`.pill`（navbar-sub 内）`padding:8px 13px`（29→40px）；`.da-act { min-width:44px; min-height:44px; }` 并把 `.detail-actionbar` 高度加到 56+；`.seg button { padding:12px 0 }`；`.navbar-btn { width:44px; height:44px; }`。

### [U11] 适老化：11px 字号大面积使用（广场首屏 71 处 <12px，我的页 26 处，发布页 16 处）
- **复现**：TreeWalker 实测 `<12px` 文本节点：广场首屏 71 处（pin-meta 城市/时间/还缺N人、招募中/仅限女生 flag 均 11px）、我的页 26 处（10-11px：搭搭号、复制、认证徽章、兴趣标签）、发布页 16 处（分类名 11px）。token 层面 `--fs-xs: 11px`、tab-label 10px、msg-time 10.5px、da-credit 10px。
- **证据**：`/tmp/ux-me-mobile.png`（fullPage）；审计计数输出。
- **影响**：45 岁以上用户（找搭子主力人群之一）阅读吃力；叠加 U1 低对比双重伤害。
- **修复**：`--fs-xs: 11px → 12px`、`.tab .tab-label: 10px → 11px`，pin-meta/flag 从 var(--fs-xs) 自动跟随；`.pin-meta { letter-spacing:.2px }` 提升辨识。建议再提供「大字模式」body 类（`body.big { --fs-md:16px; --fs-base:17px }`）挂在设置页。

### [U12] 筛选/分类切换后滚动位置不归零
- **复现**：广场滚动到 scrollTop=1073（已加载 20 卡）→ 点「美食干饭」→ 实测 scrollTop=156、仅 2 卡。新列表渲染后停留在旧位置附近而非顶部；若新结果较长则用户直接落在列表中段，漏看头部内容。
- **证据**：`/tmp/ux-filter-scroll.png`；审计输出 `before:{1073,20} after:{156,2}`。
- **影响**：切换筛选的用户预期从第一项看起；当前行为像「随机跳到某处」。
- **修复**：square.js `refreshList()` 成功分支加 `el.querySelector('.page')?.scrollTo(0,0)`（或 `el.scrollTop = 0`，page 元素是滚动容器）。

### [U13] 空状态全线无行动按钮（含指引文案却无出口）
- **复现**：搜不存在关键词 → 「这里还没有搭局/换个城市或分类看看，或者自己发一个」但无「发布搭局」按钮；新用户通知页「没有通知」无按钮；会话页「还没有会话」无「去广场找搭子」按钮；我的帖子空态同样无按钮。
- **证据**：`/tmp/ux-empty-square.png`、`/tmp/ux-empty-notif.png`、`/tmp/ux-empty-chat.png`；实测 `hasButton:false` × 4 处。
- **影响**：空态是转化的黄金位，当前只有「说教」没有「指路」；文案自己都在说「自己发一个」却不给按钮。
- **修复**：`UI.empty()` 加第 4 参 `actionHTML`：广场空态 `<button class="btn primary" onclick="location.hash='#/publish'">发布搭局</button>`；会话空态「去广场逛逛」；通知空态可不放（低频）。

### [U14] 聊天输入栏在 iOS 键盘下有被遮挡风险（无 visualViewport 处理）
- **复现**（代码级+结构证据，Chromium 无法模拟软键盘，如实标注）：`.chat-input-bar` 是 `#app{height:100dvh}` 内 flex 末尾的普通流元素（conv.js:135），dvh 不响应 iOS 虚拟键盘（无 `interactive-widget` meta、无 `visualViewport` resize 监听，全局 grep 为 0）。iPhone UA 模拟下聚焦发布页 textarea 正常（textarea 在滚动流内，Safari 会滚动可见）。
- **证据**：`/tmp/ux-keyboard-publish.png`；conv.js:134-136 + app.css:60/243-247。
- **影响**：iOS Safari 键盘弹起时布局视口不缩，输入栏钉在 844px 底部 = 键盘背后，聊天（核心闭环）在真机上有较高概率打字看不见。
- **修复**：index.html viewport 加 `interactive-widget=resizes-content`（Android Chrome 立即生效）；iOS 端 conv.js 加 `visualViewport.addEventListener('resize', () => document.querySelector('.chat-input-bar').style.transform = \`translateY(\${window.visualViewport.height - window.innerHeight}px)\`)` 或聊天容器改 `height: window.visualViewport.height` 动态布局。需真机回归验证。

### [U15] 被拉黑点赞的报错文案「无法与该用户互动」不知所云
- **复现**：momo 拉黑 xiaoyu → xiaoyu 打开 momo 的帖子详情（直链可达，按钮正常可点、无任何「已拉黑」标识，因 blockedFlag 只显示「我拉黑别人」方向）→ 点赞 → toast「无法与该用户互动」。
- **证据**：`/tmp/ux-blocked-detail.png`、`/tmp/ux-err-blocked-like.png`。
- **影响**：对照测试：密码错「用户名或密码错误」、验证码错「验证码错误或已过期」都是人话；唯独这条用户完全无法理解发生了什么、该做什么（也不知道是自己的问题还是对方的问题）。且详情页在该方向拉黑下没有任何预防性提示，用户点哪个错哪个。
- **修复**：后端 posts.js:228 三处 403 文案改「你与该用户无法互动（可能存在拉黑关系），如有疑问可在安全中心反馈」；前端 post.js 详情加载时若 `blocked_by_me !== true` 可加一个 `author_blocked_me` 字段显示「对方暂不接受你的互动」提示条，禁用点赞/评论/申请并说明原因。

### [U16] 登录页 Enter 不提交（仅密码框例外）；整个应用没有 `<form>`
- **复现**：登录页焦点在「手机号/用户名」框按 Enter → 无任何反应（实测焦点仍停在 #f-user）；只有 #f-pass 挂了 Enter→click 处理。注册页 #f-phone/#f-code 同样无 Enter 提交。
- **证据**：审计输出 `在 #f-user 按 Enter 后焦点: f-user`。
- **影响**：桌面/外接键盘用户（PWA 宣传场景）的肌肉记忆失效，注册流程 6 个字段逐个点按钮。
- **修复**：login.js 把 `.login-form2` 改 `<form id="login-form">` + `onsubmit=preventDefault;提交`，input Enter 自然冒泡提交；或给所有输入框统一挂 keydown Enter → $('btn-go').click()。

### [U17] 横屏 844×390 可用内容区仅约 200px 高（navbar 占 134px）
- **复现**：横屏打开广场：navbar（标题+搜索+分类条）实测 134px + TabBar 56px = 190px chrome，首卡 top=142、bottom=472 > 视口 390（整卡不可见）；3 列瀑布正常、无横向溢出（不算散架）。
- **证据**：`/tmp/ux-landscape-square.png`。
- **影响**：横屏刷广场一屏只能看到半张卡，体验降级但不算破坏。
- **修复**：`@media (orientation: landscape) and (max-height: 500px)` 下压缩 navbar：搜索框与分类条合并一行（`.navbar-sub { position: 相关 flex 行内 }`）或隐藏 slogan 行；至少 `.navbar-inner { height: 42px }`、搜索 padding 减半。

### [U18] 成年确认自定义 checkbox 键盘焦点不可见
- **复现**：注册页 Tab 到年龄确认 checkbox：真实 input 是 `position:absolute; opacity:0; width:0; height:0`（extensions.css:508），可聚焦但不可见；`.adult-box` 自定义外观没有 `input:focus + .adult-box` 样式——键盘用户不知道焦点在哪。
- **证据**：代码定位（extensions.css:508，无相邻 focus 规则）；同页其他按钮有浏览器默认 outline（本次实测按钮焦点环默认可见，未全局清除，是过关项）。
- **影响**：键盘/读屏用户在合规必勾项上「盲签」。
- **修复**：extensions.css 加 `.adult-check input:focus-visible + .adult-box { outline: 2px solid var(--primary-deep); outline-offset: 2px; }`。

---

## 过关项

| 项 | 实测结论 |
|---|---|
| TabBar 按钮可访问名 | 5 个 tab 均有可见文字标签（「广场」等），accessible name 存在；TabBar 用 `<button>` 实现，可 Tab 可 Enter（建议顺带把未读数并入 aria-label，如 `aria-label="消息，3条未读"`，属锦上添花） |
| 按钮焦点环 | 按钮未全局清除 outline，Tab 时浏览器默认 focus ring 可见（8 连 Tab 焦点链全程可辨，`/tmp/ux-focus-tab.png`）；仅输入框清了 outline（靠 1.5px 边框变色，配合 U2 修色即可） |
| 详情页键盘操作栏 | `#btn-like`/`#btn-comment-jump` 是真 `<button>`：可 Tab、Enter 点赞成功（计数 8→9，`/tmp/ux-focus-like.png`），返回按钮也可 Tab |
| 弱网首屏布局稳定性 | 数据到达后无跳动：卡片 y=142→143、h=360 稳定，columns 布局无重排闪跳（问题只在白屏期，见 U5） |
| 桌面 1366 布局 | 4 列瀑布流 + 左侧 72px 常驻侧栏（TabBar 转侧栏）正常，无横向滚动条；聊天分栏结构存在（desktop.css WEB-03） |
| 横屏不散架 | 3 列自适应、`overflowX:false`，仅空间局促（U17） |
| 错误文案（2/3 条人话） | 「用户名或密码错误」「验证码错误或已过期」明确可懂；演示验证码 toast 6s 长驻可读 |
| 拉黑状态主路径防御 | 「我拉黑对方」方向：详情页按钮禁用 + 「已拉黑」pill（H5-09 已实现，本次实测通过的是反方向缺口 U15） |
| 点赞局部更新 | 点赞只改心形+计数，不整页重渲染（轮播不复位、评论草稿不丢，H4 验证有效） |
| 触底加载/失败重试 | 触底预载 200px + 哨兵可点击重试 + 翻页竞态丢弃（fetchSeq），弱网下未观察到重复卡或丢失 |

---

## 最值得修的 3 条（投入产出比）

1. **[U1] `--text-3` 一行 token 改色**（2.16→4.60）——全站元信息可读性瞬间达标，1 行 CSS。
2. **[U3] pin-card 换 `<a>` 或补 role/tabindex**——键盘与读屏用户的主路径从 0% 到 100%，改 ui.js 一处模板全站生效。
3. **[U4] UI.sheet 补 Esc + role=dialog + 移焦 + 取消按钮**——一处组件修改同时修掉 4 个弹层的可用性/语义问题。
