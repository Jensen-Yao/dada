# 刁钻评审 R1：发现 19 个问题

> 评审方式：源码通读 + Playwright 实机操作（1366×768 桌面 / 390×844 移动）+ curl/node:sqlite 直查 API 与数据库。
> 演示数据基于 `server/` 重新 seed（10 用户 / 24 帖）。全部问题均有截图（/tmp/harsh-*.png）或命令行输出留证，无凭空猜测。
> 评审视角：挑剔的资深产品评审 + 重度用户，只报当前实现的缺陷与打磨，不报新需求。

---

### P0（功能坏 / XSS / 数据错乱）

**[H1] 会话页 WS 事件处理器泄漏：错误 toast 随访问次数无上限叠加，旧页面死 handler 永不卸载**
- 复现：登录 xiaoyu → 访问 `#/conv/abc`（conv_id 为 NaN）→ 输入任意文字点发送 → 记录 toast 数量（首次 1 个）；再走 `#/conv/1` → `#/conv/abc` → 发送 → toast 变 **3 个**（实测输出 `toast count first visit: 1 | after re-entering conv page: 3`）。每进一次会话页就多一个，只增不减，只能刷新整页摆脱。
- 根因：`conv.js` / `chat.js` 用 `el.addEventListener('DOMNodeRemoved', ...)` 卸载 `WS.on('chat'/'chat_error')` 回调，但 Chrome 对 `innerHTML` 替换不派发 Mutation Events（已实测证实），回调永不移除；`chat.js` 的死 handler 还会对每条收到的 WS 消息执行一次已脱离 DOM 的会话列表 `load()`（无谓 API 请求按访问次数翻倍）。
- 证据：/tmp/harsh-18-convabc-send.png（同屏两个"会话不存在"toast）、S4 脚本输出（1→3）。
- 指派：FE
- 建议修法：去掉 DOMNodeRemoved 方案，路由渲染前统一调用卸载（App.render 清空容器时先执行上页注册的 cleanup），或用 `AbortController` / 按 `page-container` 子元素是否存在判断后再处理消息。

---

### P1（体验硬伤）

**[H2] 拉黑形同虚设：被拉黑者的帖子/评论照常可见，拉黑者点赞对方还照常推送通知**
- 复现：xiaoyu 拉黑 momo（POST /api/users/4/block 成功）→ ①广场搜索"国图自习"仍返回 momo 的帖子（登录与游客视角均如此，`GET /api/posts` 的 where 条件不含任何 block 过滤）；②momo 在 xiaoyu 帖子下发的评论照常展示（评论列表实测含 `momo:拉黑测试评论`）；③xiaoyu 给 momo 帖子点赞，momo 正常收到"小鱼干 赞了你的搭局"通知（查 notifications 表实证）。`anyBlocked` 只拦了私信。
- 证据：/tmp/harsh-28-square-blocked-author.png（拉黑后 momo 卡片仍在广场）；T25/T26/T29 命令行输出。
- 指派：BE（FE 顺带在作者行加已拉黑标识）
- 建议修法：`GET /posts`、`GET /posts/:id/comments`、`/recommend`、`/for-you` 关联 blocks 表过滤；点赞/评论前校验 `anyBlocked` 双向拦截。产品口径：拉黑后双方内容互不可见（对标主流社区做法）。

**[H3] 私信门槛与文案自相矛盾：申请未通过（pending）即可私信组局者，同帖两个 pending 陌生人可直接互开私聊**
- 复现：新用户 probe 申请 runner 的帖子（status=pending，未通过）→ `POST /api/chat/conv {user_id:作者, post_id}` 直接建会话成功；再让 sherry 也 pending 同一帖 → sherry 与 probe 两个素不相识的陌生人同样建会话成功。而前端聊天空态写的是"申请搭局**通过后**就能聊天"，自相矛盾。任何人申请任意一帖即可私信作者及全部同帖申请者，门槛形同虚设，是骚扰向量。
- 证据：T23b/T24b curl 输出（均返回 ok 并建立 conv id=2/3）；conv.js/chat.js 空态文案截图 /tmp/harsh-32-newuser-chat.png。
- 指派：BE + FE
- 建议修法：二选一并前后端对齐——要么 pending 不可聊（related 查询去掉 pending 分支，等审批通过建会话），要么文案改为"申请后即可沟通"。同帖申请者之间的会话建议收紧为 approved 才放行。

**[H4] 详情页点一次赞 = 整页重渲染：轮播复位到第 1 张、未发送的评论文本被清空**
- 复现：`#/post/1` 把轮播滑到第 2 张（指示 2/3）→ 在评论框输入"草稿"不发送 → 点一下点赞 → 页面整体重建：轮播指示回到 1/3，评论框草稿消失（实测 `indBefore 2/3 -> 1/3`，`draft: ""`）。点赞是高频无意识动作，每次都丢用户输入不可接受。
- 证据：/tmp/harsh-16-like-rerender.png；S3 脚本输出。
- 指派：FE
- 建议修法：点赞只做按钮局部状态更新（图标 + 计数 + class），不要 `render()` 全量重建。

**[H5] 编辑资料静默截断：签名输入 100 字保存成功，重开只剩 60 字，无任何提示**
- 复现：`#/edit-profile` 签名框（maxlength=200）输入 100 字 → 保存提示"已保存" → 重新打开只剩 60 字（实测 `输入100字 -> 保存后重开变成60字`）。FE 上限 200、BE `PUT /users/me` slice(0,60)，用户被无感吞掉近半内容。职业字段同理（无 maxlength，超 60 静默截断）。
- 证据：/tmp/harsh-36-editbio-truncated.png；S7 脚本输出。
- 指派：FE + BE（对齐同一处即可）
- 建议修法：FE maxlength 改 60 并显示字数，或 BE 放宽到与 FE 一致；至少在截断发生时 toast 提示。

**[H6] 图片链断裂零兜底：详情页轮播与瀑布流封面直接呈现破图/空白**
- 复现：将帖子 25 的 images 改为不存在的 `/uploads/nonexistent_*.jpg` → 详情页轮播两帧均为浏览器默认破图（`naturalWidth=0` 实测为 true），仅左上角小碎图标 + 灰底，页码"1/2"照常显示；瀑布流封面同样无 onerror（/tmp/harsh-21/22 中该卡为整块空白灰区）。对比：头像有三级降级（photo→svg→字母），封面/轮播完全没有。
- 证据：/tmp/harsh-20-post25-brokenimg-mobile.png、/tmp/harsh-22-square-blocked-full.png（中列空白卡）。
- 指派：FE（上传文件被清理/迁移是常态场景）
- 建议修法：轮播与 pinCard 封面 img 补 onerror 降级链（images[i] 404 → 分类实拍照 → 分类图标块），与头像同标准。

**[H7] 满员帖转化路径误导：底栏禁用主按钮仍是亮橙色"该搭局已停止招募"，卡片还写着"还缺 0 人"**
- 复现：找满员帖（种子+真实审批流制造 post 3）→ 广场卡片角标"已满员"，但 meta 行显示"**还缺 0 人**"（pinCard 的 `还缺 ${Math.max(0,...)}` 未处理满员态）；卡片视觉与招募中完全一致（同尺寸同彩图，仅左上小角标不同），弱化不足。详情页主按钮 disabled 但样式仍是实心橙色（/tmp/harsh-23），文案对满员场景说"停止招募"（像被组局者关闭），点击无任何反馈。
- 证据：/tmp/harsh-35-fullpost-card.png（已满员 + 还缺 0 人）、/tmp/harsh-23-fullpost-detail.png。
- 指派：FE
- 建议修法：满员卡隐藏"还缺 N 人"、封面加灰度/降透明度处理；详情满员态按钮改灰底文案"已满员，看看其他搭局"并给广场跳转；文案区分 full/closed。

**[H8] 深链 404 全部呈现为"页面出错了"死胡同：无导航、无返回、连顶栏都消失**
- 复现：登录态直接访问 `#/post/99999`、`#/user/99999`、`#/conv/999`（或他人会话）→ 整个页面容器只剩红色"页面出错了 / 搭局不存在（用户不存在/会话不存在）"，navbar 一并被清掉（app.js 的 catch 用 UI.empty 覆写整个 el），移动端没有任何返回/去广场按钮，用户只能靠浏览器后退。分享链接过期是社交产品的常态场景，这个落地页等于劝退。桌面端 `#/conv/999` 左栏会话列表也被整页错误吞掉。
- 证据：/tmp/harsh-03-post99999.png、/tmp/harsh-05-conv999.png、/tmp/harsh-04-user99999.png。
- 指派：FE
- 建议修法：404 类错误（后端明确"不存在/无权"）单独渲染：保留顶栏 + "内容不存在或已结束"+「回广场」/「回消息」主按钮；`#/conv/:id` 桌面端失败时至少保留左栏列表。

**[H9] `#/conv/abc` 半残态：标题"..."、空消息区，但输入框可打字可发送，发送失败还清空用户输入**
- 复现：登录态访问 `#/conv/abc`（parseInt 得 NaN）→ loadConv 直接 return，页面渲染成"可用"聊天室：右栏标题"..."、无消息、输入框可输入；输入文字点发送 → WS 回 `chat_error 会话不存在`，toast 报错且**输入框已被清空**，长文直接丢失（实测 `input kept: ""`）。正常路径（send 先清 input 再等服务器确认）在一切发送失败场景都会丢字。
- 证据：/tmp/harsh-18-convabc-send.png；S3 脚本输出。
- 指派：FE
- 建议修法：convId 非法时重定向 `#/chat`；发送改为确认成功后再清输入（或失败时还原文本）。

---

### P2（打磨）

**[H10] 非用户请求的 404 复用"页面出错了"错误样式**：与 H8 同源但程度轻——后端明确返回"搭局不存在"属正常业务态，不该用 danger 红色"页面出错了"制造 app 有 bug 的观感。指派 FE。证据：/tmp/harsh-03。

**[H11] `#/legal/xxx` 任意未知子页静默显示《隐私政策》**：`legal.js` 只有 terms/其他 两分支，`#/legal/foo` 直接渲染隐私政策全文，导航栏标题却是访问的子路径场景，易造成"协议内容不对"的困惑。指派 FE。证据：/tmp/harsh-07（navbar title=隐私政策）。

**[H12] 非管理员直访 `#/admin` 渲染完整后台骨架**：三个 tab 全部可点、逐个 403 toast，页面不重定向也不隐藏 tab（ME 页入口有隐藏，但直链体验糙）。指派 FE。证据：/tmp/harsh-08-admin-nonadmin.png。

**[H13] 桌面侧边栏选中态混乱**：非 tab 页（详情/发布等）不清除 `.tab.active`——会话内从广场点进帖子，侧栏"广场"保持高亮（截图实证）；而直接载入 `#/publish` 时无任何高亮（`active: []`）。同一类页面两种状态。指派 FE。证据：/tmp/harsh-02-post1-desktop.png、S2 输出。

**[H14] 申请弹层连点提交：数据没脏但弹错误提示**：三连点"提交申请"→ 1 条申请（服务端幂等 ✔），但第 2、3 次点击各弹一个"已申请过该搭局"，用户明明第一次操作成功却看到两条报错。按钮未做提交中禁用。指派 FE。证据：S2b 输出（toasts: 已提交申请 + 已申请过该搭局 ×2）、/tmp/harsh-13。

**[H15] 发评论后"评论区（N）"与底栏计数不刷新**：发评论成功后仅重拉评论列表，header 计数与 actionbar 计数仍是旧值（实测 1→1），刷新页面才更新。指派 FE。证据：S2b 输出。

**[H16] 发布接口无幂等护栏**：同一 token 并发两个相同 POST /api/posts → 2 帖全部入库（实测同名帖 c=2）。FE 已靠 disabled 防住双击，但多 tab/网络重试场景会重复。指派 BE。证据：T36 输出。

**[H17] 注册接口 city 无长度限制**：`POST /auth/register` 的 city 不做 slice（PUT /users/me 同字段却 slice 60），实测 1000 字城市名原样入库。指派 BE。证据：T31/S7 node 输出（DB LENGTH(city)=1000）。

**[H18] "我参加的"列表渲染空灰色 pill**：joined 视图里 `<span class="pill gray">${type==='published' ? ... : ''}</span>` 输出空标签，卡片时间旁挂一个无字小灰块（截图可见）。指派 FE。证据：/tmp/harsh-29-myposts-joined.png（"工作日 09:00-17:00"后的空 pill）。

**[H19] 发布页双击防护与成功路径耦合脆弱**：`btn.disabled=true` 依赖"校验通过后才置位"，若未来校验逻辑变为异步（如查敏感词接口），双击窗口即打开；且成功后按钮永久停留在 disabled（返回编辑无感知）。当前实测无重复发帖（两轮各 1 帖 ✔），记录为防御性打磨。指派 FE。证据：S2b（posts created = 1）。

---

## 复核通过项（查了，没问题，防止重复劳动）

| # | 项 | 结论与证据 |
|---|---|---|
| 1 | 注册用户名特殊字符/emoji/超长 | 服务端正则拦截：`<script>alert(1)</script>`、emoji、60 字均 400（T1-T3）；前端提交后 toast 正确展示错误（S5） |
| 2 | XSS 全链路（昵称/帖子标题/正文/评论/bio/通知/搜索词/头像字母兜底） | 注册昵称 `<svg onload=aler`、标题/正文/评论注入 `onerror` 探针，广场卡、详情、他人主页、通知中心、搜索框全部字面渲染，`window.__xss*` 全部未触发（S2b/S4 输出 + /tmp/harsh-22/24/25/26） |
| 3 | 发布表单边界 | 全空提交逐项 toast 引导；标题粘贴 45 字被 maxlength 截到 40（与后端 40 一致）；正文粘贴 1200 字截到 1000；need_count `+` 连点 25 次停在 20（S2 输出） |
| 4 | 后端字段边界 | 标题 41 字 400、正文 1001 字 400、评论 301 字 400、空评论 400、need_count 0/-5/999/abc 全部收敛到 1~20（T10-T14、T30） |
| 5 | 发布按钮双击 | disabled 同步置位，双击/三连点只发 1 帖（S2b：两轮各 1 帖；API 并发是 H16 另案） |
| 6 | 申请加入服务端幂等 | 并发两次 POST /posts/3/join → 仅 1 条 join 记录，第二条 400"已申请过该搭局"（T28） |
| 7 | 点赞连点一致性 | 30ms 间隔 10 连点，UI 计数/liked 态与服务端 likes_count 最终一致（S2b：server 1→1，UI 1，unliked 自洽） |
| 8 | 自己给自己发消息 | `POST /chat/conv {user_id:自己}` → 400"不能和自己聊天"（T20b） |
| 9 | 越权访问他人会话/不存在会话 | 非成员 GET /chat/conv/1/messages → 403；conv/999 → 404（T21b/T21c）；FE 不渲染任何消息内容（整页错误态，见 H8 的体验问题但无越权） |
| 10 | WS 异常输入健壮性 | `{type:'chat', conv_id:null}` → 回 chat_error"会话不存在"，服务进程存活（T35） |
| 11 | 刷新与深链保持 | `#/post/1` F5 后正常重载（hash 路由 + SPA fallback）（harsh-09） |
| 12 | 1366→390 缩窗 | conv 页 matchMedia change 触发 reload，单栏结构恢复、当前会话由 hash 还原、可继续发消息（S3：split true→false，发送成功） |
| 13 | 游客权限引导 | 游客详情页 CTA"登录后申请加入"→ 点击跳 `#/login`；privatePages 未登录访问均 toast+重定向（S4/S1） |
| 14 | 新账号空态文案 | 我的/消息/通知/我的搭局（发布/参加）/发现 均有图标+标题+行动指引文案，无空白区（harsh-30~34） |
| 15 | 桌面发布页宽度 | 1366 下表单 640px 居中限宽，分类栅格 4 列，无过窄问题（实测 width=640，harsh-10） |
| 16 | 敏感词过滤 | 标题含"加微信"被 400 拦截并给替代指引文案（T32） |
| 17 | 已读与角标 | 通知页打开即全部已读并刷新角标；聊天角标随 WS 事件刷新（S1 截图中 badge 数值随操作变化） |
| 18 | 头像降级链 | avatarHTML 有 photo→svg→字母三级 onerror 兜底，代码审阅 + 注册无头像新用户字母头像正常（harsh-30） |

---

### 附：证据文件索引（/tmp/harsh-01 ~ 36.png）与测试脚本（/tmp/harsh/*.js）

本轮测试对数据的副作用：post 3 经真实审批流变为满员（用于 H7 验证）；新增若干测试账号（xssnick1/emptyacc01/probe001/citylong*）与测试帖（id 26-35）。重新执行 `node src/seed.js` 即可全部还原（post 25 的 images 已手动恢复）。
