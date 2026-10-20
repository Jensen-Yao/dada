# R5 无障碍深审（读屏用户全流程）

- 审查人：搭搭无障碍深审批评家（R5，接 R1 广度审查后的纵深专项）
- 方法：Playwright（chromium-1247，390×844 移动视口 + 1280×800 桌面视口）模拟读屏语义审计——逐元素采集 computed role / accessible name / landmark / 焦点位置 / AX 树播报通道；双浏览器上下文实测 WebSocket 新消息到达；`reducedMotion:'reduce'` 仿真实测动画偏好。未使用真实读屏软件，结论基于可计算的无障碍语义。
- 范围：登录/注册、广场、详情、发布、发现、消息列表、会话、通知、我的、设置、管理后台。
- 全部结论均有实测数据（源码行号仅作佐证）。

## R5无障碍深审：17项（P1读屏流程断裂 5 / P2语义与偏好 12）

### P1 —— 读屏流程断裂

**[W1] 聊天新消息到达零播报，全站零 aria-live 区域** | 会话页 /#/conv、消息列表 /#/chat、全站 toast | 实测：双浏览器上下文（读屏测试员 ↔ admin）同一会话，对方发送消息后接收方 DOM 气泡 0→1 成功插入，但 `document.querySelectorAll('[aria-live],[role="log"],[role="status"],[role="alert"]').length === 0`；接收方焦点为 BODY，无任何可播报节点。消息列表页同样 0 个 live region（未读数从 2→3 仅 `.dot-unread` 文本变化，无播报）。ui.js `toast()` 容器与 toast 元素 role/aria-live 均为 null（实测），而全站所有表单错误/操作结果都走 toast | WCAG 4.1.3 状态信息 (AA) | 修复：① ui.js `#toast-wrap` 创建时加 `wrap.setAttribute('role','status'); wrap.setAttribute('aria-live','polite')`——一行代码，全站 toast 变可播报；② conv.js `chatPaneHTML` 的 `<div class="chat-scroll" id="msgs">` 加 `role="log" aria-live="polite"`（历史消息首渲时先置 `aria-live="off"` 防整段复读，`loadConv()` 完成后再切 polite）；③ chat.js 列表页加隐藏播报节点 `<div class="visually-hidden" aria-live="polite" id="chat-live">`，`onMsg` 里写 `${对方昵称}发来新消息`。

**[W2] 路由切换后焦点丢失到 body，无页面变更播报，详情→返回焦点不还原** | 全站（SPA hash 路由） | 实测：广场卡片上 Enter 进详情后 `activeElement === BODY`；详情点返回按钮回广场后 `activeElement === BODY(lost)`，来源卡片未还原焦点（`focusedCardRestored: false`）；tabbar 切"发现"后同样 BODY；`document.title` 在所有页面恒为"搭搭 · 找到你的搭子"不随路由变。app.js `render()` 只做 `container.innerHTML=''` + append，从不管理焦点。读屏用户每次跳转都失去位置——听不到"这是详情页"，返回后也不知道回到了列表哪一张卡 | WCAG 2.4.3 焦点顺序 (A)、4.1.3 | 修复：① 各页 `.navbar-title` 改 `<h1 tabindex="-1">`，app.js `render()` 末尾（`await routes[page]` 之后）执行 `el.querySelector('h1')?.focus({ preventScroll: true })`；② 维护一个路由级焦点栈：卡片点击跳转前记 `App._lastFocus = document.activeElement`，`history.back()` 类导航返回时 `App._lastFocus?.focus()`（ui.js sheet 已有同款 prevFocus 机制可复用）；③ `document.title = 页面名 + ' · 搭搭'` 随 render 更新，供读屏的窗口标题/页面列表使用。

**[W3] Sheet（模态）无焦点圈闭：Tab 可走出 dialog 到被遮罩的背景** | 全站 sheet/confirm（城市选择、申请加入、编辑搭局、评分、注销、举报、找回密码…） | 实测：`#btn-city` 打开城市 sheet（role=dialog、aria-modal=true、aria-label=选择城市 均正确，焦点正确进入 sheet 内首元素），将焦点置于 sheet 内最后一个可聚焦元素后模拟 Tab 前进，焦点 `ESCAPED to BUTTON#btn-city`（背景页元素）。ui.js `sheet()` 只拦了 Esc，未拦 Tab。aria-modal=true 会让多数读屏的虚拟光标止步于模态，但 Tab 键物理导航依然穿透——用户"走出"模态后操作的是被半透明遮罩盖住的死元素 | WCAG 2.4.3 焦点顺序 (A)（aria-modal 与实际焦点域自相矛盾亦违反 4.1.2 预期） | 修复：ui.js `onKey` 里补 Tab 分支：`const f = [...mask.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(e=>!e.disabled&&e.offsetParent!==null)`，`if(e.key==='Tab'){ e.preventDefault(); const i=f.indexOf(document.activeElement); (e.shiftKey? f[(i-1+f.length)%f.length] : f[(i+1)%f.length]).focus(); }`。

**[W4] 表单/操作错误只走静默 toast：无 aria-describedby、无 inline error、焦点不管理** | 登录、注册、发布、编辑资料、找回密码（全站提交类表单） | 实测：登录页空账号提交出现 toast "请输入正确的 11 位手机号"，该元素 `role:null, aria-live:null`；提交按钮焦点原地不动；全站 grep `aria-describedby` 命中 0 处、`aria-invalid` 0 处。读屏用户提交失败后听不到任何反馈（toast 2.2s 后消失且从未进入播报队列），也不知道该改哪个输入框 | WCAG 3.3.1 错误识别 (A)、4.1.3 | 修复：① 先落 W1 的 toast role=status（兜底可播报）；② 关键表单（登录/注册/发布）错误改 inline：校验失败时在对应 input 旁插 `<div class="f-err" id="err-f-phone" role="alert">请输入正确的 11 位手机号</div>`，input 加 `aria-invalid="true" aria-describedby="err-f-phone"` 并 `input.focus()`，重新输入时移除两属性。发布页 5 个必填项逐项校验（publish.js:234-238 的 toast 分支）均按此改。

**[W5] 聊天输入框与详情评论框无可访问名** | 会话页 `#f-msg`、详情页 `#f-comment`、城市 sheet 自定义输入、引导 sheet 城市 | 实测：`#f-msg`（聊天主输入框）`ariaLabel:null, labelledby:null, hasLabelFor:false`，仅有 placeholder"友善聊天，禁止导流与违规内容…"；`#f-comment` 同样裸奔；square.js 城市选择"手动输入其他城市"、discover.js 引导 sheet"常驻城市"（有 `<label>` 无 `for`）同病。读屏在聊天页 Tab 到输入框只听到"编辑文本 空白"——产品最核心的输入控件无名可用。R1[U4] 修了登录/发布，这两处漏网 | WCAG 4.1.2 姓名角色值 (A)、3.3.2 标签或说明 (A) | 修复：`#f-msg` 加 `aria-label="聊天消息"`；`#f-comment` 加 `aria-label="写评论"`；城市自定义输入 `aria-label="手动输入城市名"`；引导 sheet `<label for="ob-city">常驻城市</label>` 补 `for`。

### P2 —— 语义与偏好

**[W6] prefers-reduced-motion 完全未实现：reduce 下进场/骨架屏/弹层动画照跑** | 全站 CSS（app.css/extensions.css） | 实测：`reducedMotion:'reduce'` 上下文中 `matchMedia('(prefers-reduced-motion: reduce)').matches === true`，但 `.page` 计算样式 `animationName:"pageIn", duration:"0.22s"` 仍生效；骨架屏 `.skeleton` 的无限 shimmer `sk` 动画 `getAnimations().length === 1`（全页 6 个同时运行）；sheet 遮罩 `fadeIn`、面板 `sheetUp` 同样照常。3 个 CSS 文件 grep `prefers-reduced-motion` 命中 0。前庭障碍用户（晕动症）打开广场即被 6 块无限滚动的 shimmer 包围 | WCAG 2.2.2 暂停/停止/隐藏 (A，无限动画)、2.3.3 交互动画 (AAA) | 修复：app.css 末尾统一追加 `@media (prefers-reduced-motion: reduce){ *,*::before,*::after{ animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; scroll-behavior:auto !important; } }`（覆盖 pageIn/sk/sheetUp/toastIn/fadeIn/pwaUp 与 .tab-icon、卡片缩放 transition）。

**[W7] 详情底栏点赞/评论按钮的可访问名是裸数字，点赞状态不暴露** | 详情页 #/post 操作栏 | 实测：`#btn-like` accessible name = `"0"`（aria-label null），`#btn-comment-jump` = `"0"`；`aria-pressed:null`——点赞后仅 `.liked` class 变红心，读屏完全不知已赞。读屏听到的是"按钮 0"。ui.js `pinCard` 卡内点赞 `<span class="pin-like">` 同样是裸数字 | WCAG 4.1.2 (A) | 修复：post.js 渲染与 `btn-like` 局部更新处（post.js:194-198）都写 `aria-label="${liked?'取消点赞':'点赞'}，${likes_count} 人"` + `aria-pressed="${liked}"`；评论跳转 `aria-label="评论，${n} 条"`；pinCard 点赞 span 加 `aria-hidden="true"`（标题 aria-label 已并入该信息，见 W8）。

**[W8] 广场卡片朗读内容割裂：aria-label 只有标题，浏览模式念出分隔符与无意义碎片** | 广场/发现瀑布流 | 实测卡片（TreeWalker 按 DOM 顺序）朗读序列为：`"招募中"` `"R5聊天审查局"` `"杭州"` `"·"` `"还缺 1 人"` `"A"` `"API审查A"` `"0"` ——其中 `"·"` 是纯装饰分隔符（ui.js pinCard meta 的 `<span style="opacity:.55">·</span>`）、`"A"` 是头像首字母兜底 div、结尾 `"0"` 是无上下文点赞数。而卡片 `role="link"` 的 aria-label 仅 `"R5聊天审查局"`——按链接快速扫卡片的读屏用户听不到城市/时间/缺口/作者 | WCAG 1.3.1 信息与关系 (A) | 修复：① pinCard aria-label 组合完整语义：`aria-label="${title}，${city}，${meet_time}，还缺${lack}人，${author.nick}"`（满员时"已满员"）；② 装饰分隔符 span 加 `aria-hidden="true"`；③ 头像字母 div/`pin-avatar` 加 `aria-hidden="true"`；④ `pin-like` 计数按 W7 处理。

**[W9] 全站无 main/header landmark、页面无标题层级（h1）、title 不更新** | 全站 | 实测：登录/广场/详情页 landmark 均只有 `nav:1`（tabbar；且子页 display:none 后 AX 树里连它也没有），`main/header/footer/role=main` 全部 0；广场、详情、消息、管理后台 `h1~h6` 数量均为 0（`.navbar-title` 是 div；仅登录页与法务页有 h1）。读屏用户无法"跳到主内容/按标题浏览"，长页（详情页含申请管理+互评+评论区）只能线性硬听 | WCAG 1.3.1 (A)、2.4.1 跳过块 (A)、2.4.6 标题与标签 (AA) | 修复：index.html `#page-container` 改 `<main id="page-container">`；ui.js/app.js 各页模板 `.navbar` 外层改 `<header>`（desktop.css 同步）；每页 `.navbar-title` 改 `<h1>`（样式追加 `.navbar-title{font:inherit;margin:0}` 防跳字）；评论区/申请管理区块标题改 `<h2>`；tabbar `<nav aria-label="主导航">`。

**[W10] 全站"选中态"只靠颜色：tab、分类、排序、费用、性别、标签均无状态属性** | tabbar、广场分类条、发布页、编辑资料、管理后台 seg | 实测：5 个 tab 的 `aria-current` 全为 null（active 仅 class）；发布页费用方式/性别 seg 与分类宫格按钮无 `aria-pressed/aria-checked`（publish.js 仅 classList.toggle('selected')）；广场"热门"排序、分类 pill、发现页城市 chip、标签 `tag` 同。读屏用户发布搭局时选完"AA"后无法确认选中，性别要求选了"仅限女生"也听不出来 | WCAG 4.1.2 (A)、1.4.1 不只用颜色 (A) | 修复：① tabbar active 加 `aria-current="page"`（app.js setActiveTab 处同步增删）；② 单选组语义化：`#fee-seg/#gender-seg/cat-grid` 容器已有 role=group + aria-labelledby，按钮改 `role="radio"` + 容器 `role="radiogroup"`，选中时 `aria-checked="true"`（最小改法：全部加 `aria-pressed` 并随 selected 增删，二选一）；③ 排序/分类 pill、城市 chip、`tag`、`tpl-chip`、`star` 同加 aria-pressed。

**[W11] 加载中/加载完成无播报：骨架屏对读屏是一段空白** | 广场、发现、消息、详情评论区、我的 | 实测：`UI.wfSkeleton()` 生成 6 个无文本 div（读屏听到 0 个字），列表数据到达后整容器 innerHTML 替换，无 aria-busy/live 通道（grep aria-busy=0）；`UI.loading()` 的"加载中..."是普通 div，被内容替换时无播报。读屏用户进广场后不知道"正在加载、加载完了没有、加载了几条" | WCAG 4.1.3 (AA) | 修复：ui.js `loading()` 返回 `<div class="loading" role="status">加载中...</div>`；`wfSkeleton()` 容器加 `role="status" aria-label="正在加载搭局"`；square.js/discover.js 列表容器在 `refreshList()/loadHot()` 前 `listEl.setAttribute('aria-busy','true')`，渲染完成后移除（完成后可顺带往隐藏 live 区写"已加载 N 个搭局"）。

**[W12] 详情大图轮播：图片全部空 alt、页码指示不播报、键盘完全不可操作** | 详情页 #/post 轮播 | 实测：含 2 图的搭局 `#carousel` 两张 img alt 均为 `""`；指示器 `1/2` 滚动更新但 `aria-live:null`；轮播容器内 0 个可聚焦元素（`keyboardOperable:false`），纯 scroll-snap——键盘用户只能看第 1 张，读屏用户一无所知。封面图是这类产品的核心信息载体（R1[U9] 已指出，未改） | WCAG 1.1.1 非文本内容 (A)、2.1.1 键盘 (A) | 修复：第 1 张 `alt="${esc(p.title)}配图1"`，其余 `alt="配图${i+1}"`；指示器加 `aria-live="polite"`（或 role=img 组合 + aria-label）；最小键盘方案：轮播两侧加‹›按钮（`aria-label="上一张/下一张"`，点击 `car.scrollBy({left:±car.clientWidth})`）。

**[W13] 管理后台无任何表格/列表语义；且后台 UI 对 admin 账号本身也不可达** | 管理后台 #/admin | 实测：admin/123456 登录后访问 /#/admin 渲染的是"无权访问"空态——`/auth/me` 返回字段中无 `is_admin`（实测 keys 列表确认），me.js/admin.js 判 `me.is_admin` 恒 falsy（功能缺陷，`/api/admin/stats` API 本身 200）；即便可达，看板为 `div.stat-card>(b+span)`（admin.js:63）、举报/用户队列为 div 卡片，实测 `table,th,td,[role=table]` 均为 0、h1~h6 为 0。运营数据"总用户 20 搭局 31"读出来是裸数字流 | WCAG 1.3.1 (A)（可达性缺陷叠加功能性回归） | 修复：① server `/auth/me` 补 `is_admin`（放行 admin UI，这是看板能被审计的前提）；② stat-grid 容器 `role="list"`，卡片 `role="listitem"`，数值与标签合并为一个可读单元 `<span><b>20</b> 总用户</span>`；举报队列每卡加 `role="listitem"` + 头部 `aria-label="人身安全，搭局#12，处理中"`；seg 按 W10 处理。

**[W14] 通知项 role=link 时 aria-label 覆盖了正文与未读态** | 通知中心 #/notifications | 实测：通知项 accessible name 仅 `"申请已通过，查看详情"`（misc.js:221 拼的是 n.title）；n.body 正文与未读红点（空 span，仅视觉）都不在 name 里也无其他播报通道——未读与已读只差 `opacity:0.6`。读屏用户分不清哪些没读过、通知正文要逐项进详情才知道 | WCAG 1.3.1/4.1.2 (A)、1.4.1 | 修复：name 组合 `aria-label="${title}，${body}${n.read?'':'，未读'}，查看详情"`；未读红点改带文本的 `<span class="visually-hidden">未读</span>` 或直接并入上述 name；"全部已读"按钮同理补 aria-label="全部标为已读"。

**[W15] 无标题的 confirm/菜单 dialog 无可访问名** | 全站确认框、会话页"更多"菜单 | 实测：ui.js `confirm()` 走 `sheet('', …)`，`sheet()` 仅在 title 非空时设 aria-label（ui.js:39）→ 确认框 role=dialog 但 name 为空，读屏只说"对话框"；conv.js `#btn-more` 菜单 sheet 同样 `sheet('')`。拉黑确认这类危险操作弹窗，读屏用户不知道弹的是什么 | WCAG 4.1.2 (A) | 修复：`sheet()` 兜底 `if(!title) mask.setAttribute('aria-label','对话框')`；confirm 改传语义标题（"确认操作"）；conv 更多菜单改 `sheet('会话操作', …)`。

**[W16] 桌面分栏会话页的左栏会话列表键盘不可达（chat.js 已修、conv.js 漏改）** | /#/conv 桌面端（≥768px）左栏 | 实测（源码比对 + 1280×800 视口）：conv.js `loadConvList()` 生成的 `.conv-item` 是纯 div+onclick（conv.js:233-245），无 role/tabindex/aria-label——同站 chat.js 列表页同款元素却是 `role="link" tabindex="0" aria-label="与X的会话，N条未读"`（实测桌面 #/chat 项 keyboardReachable:true）。桌面用户在会话内无法用键盘切换会话 | WCAG 2.1.1 键盘 (A) | 修复：把 chat.js:51 的 conv-item 模板（role/tabindex/aria-label/onkeydown）复制到 conv.js loadConvList，两处本就该共用一个渲染函数。

**[W17] 短信验证码倒计时：禁用无原因、秒数变化不播报** | 注册页/找回密码 sheet | 实测（源码 + 登录页走查）：`#btn-sms` 发送后 `disabled=true`，textContent 每秒变"59s后重发"（login.js:110-126）但无 aria-live，按钮名冻结在点击瞬间的值；读屏听到的是无解释的"已变灰按钮"。找回密码 sheet 内倒计时同 | WCAG 4.1.2/4.1.3 | 修复：倒计时 tick 里同步 `btn.setAttribute('aria-label', '验证码已发送，'+left+'秒后可重新获取')`，结束时恢复 `aria-label="获取验证码"`；或按钮外包 `role="status"` 的提示文本。

## 合格项（含相对 R1 的进步）

| # | 项 | 实测证据 |
|---|---|---|
| G1 | **表单控件可访问名基本补齐（R1[U4] 主体修复）** | 登录页 8 个焦点元素全部有名（手机号或用户名/密码/忘记密码/登录/协议链接/切换/先随便逛逛）；注册模式 13 个控件（手机号/验证码/密码/昵称/性别/城市/成年确认/提交…）全部有名且顺序合理，注册流可独立完成；发布页 7 个 label 均有 for；编辑资料、SOS、反馈、注销输入框均有 aria-label |
| G2 | **Sheet 模态语义与焦点归还（R1[U3] 主体修复，唯 trap 缺 → W3）** | 实测 role=dialog、aria-modal=true、aria-label=选择城市、打开自动聚焦 sheet 内首元素、Esc 关闭、关闭后焦点精确还原到触发元素 `restoredToTrigger:true`；多层 sheet Esc 只关最顶层 |
| G3 | **列表项可激活语义（R1[U2] 修复）** | 广场/发现 pinCard、我的搭局、通知项、搭友行、会话列表均为 `role="link" tabindex="0"` + Enter 激活 + aria-label；键盘可完成"浏览→进详情"主路径 |
| G4 | **图标按钮无名问题清零（R1[U8] 修复）** | 实测广场与详情页全部焦点元素 accessible name 无一为空（返回/分享/通知/选择城市/发送/更多/删除图片/加减人数均有 aria-label；SVG 图标全量 aria-hidden 不念路径） |
| G5 | **缩放与基础文档语义** | viewport 放开缩放 maximum-scale=5（R1[U7] 修复）；`<html lang="zh-CN">`；tabbar 为真 `<nav>` 且 5 个 tab 均有可见文字标签 |
| G6 | **设置页开关用了正确的 switch 语义** | 个性化推荐/大字模式均为 `role="switch"` + 动态维护的 `aria-checked`（实测源码与渲染一致）；大字模式（html[data-bigfont]）利好低视力与老年读屏用户 |
| G7 | **性别符号文字化** | 女/男为文本 tag 而非 ♀♂ 符号（EM-10），读屏直接可读 |
| G8 | **禁用主按钮的文案即原因（多数场景）** | 作者视角"这是我发布的搭局"、已停止招募"该搭局已停止招募"、满员"已满员，看看其他搭局"——disabled 时读屏仍能从 name 得知原因（仅"已拉黑"场景是例外，按钮名仍是"申请加入"） |
| G9 | **会话列表 aria-label 含未读数** | 实测 `"与搭搭小助手的会话，3 条未读"`，列表快速扫听时可感知未读（到达瞬间播报仍缺，见 W1） |

### 修复优先级建议
1. **一小时包**：W1①（toast role=status 一行）+ W5（两处 aria-label）+ W6（CSS 一段）+ W15（sheet 兜底名）——四项全是单点改动，覆盖面最大。
2. **半天包**：W2（h1 + render 聚焦 + title）、W3（Tab 圈闭）、W7/W8/W14（name 组合与 aria-hidden 清理）、W10（aria-pressed/aria-current）。
3. **排期项**：W4（inline error 体系）、W9（landmark/header 重构）、W11（aria-busy 播报）、W12（轮播键盘+alt）、W13（is_admin 修复 + 后台语义）、W16/W17。

> 实测遗留说明：为做双端聊天播报实测，向演示库写入了 1 个测试账号（读屏测试员/13900001111）、1 个搭局（"R5读屏会话实测局"）与 1 条会话消息；与此前各轮审查遗留数据（API审查A 等）同性质，可在下轮演示数据重置时一并清理。
