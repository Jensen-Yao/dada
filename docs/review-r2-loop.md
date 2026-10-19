# 批评循环 R2（复审批评家）

- 复验时间：2026-10-12（第二轮）
- 环境：共享实例 `:3000`（新代码 + 新 seed + 新 `.jwt-secret`），curl / node ws 客户端 / Playwright chromium-1247（390×844 移动 + 1366×900 桌面）
- 方法：12 项复验全部按 R1 攻击步骤原样重放；另以新视角做 10 项回归/新攻击探测。测试后 DB 已还原到测试前快照（24 帖 / 0 举报 / laoxu 607），服务已重启恢复（xiaoyu / admin 登录 200）。
- 截图：`/tmp/r2-*.png`（15 张）；API 级证据在各条目内引用实测响应。

## R2复验：12项中 ✓11 / ✗1（U2 部分达标）

| # | 项 | 结论 | 证据 |
|---|---|---|---|
| 1 | S1 旧默认密钥伪造 admin token | **✓** | 用 `'dada-dev-secret-change-me'` 与 docker 占位串 `please-change-me-to-a-long-random-string'` 各签 `{uid:1}`/`{uid:2}` token → `/api/admin/stats`、`/api/auth/me` 全部 `401 请先登录`；真实 admin 密码登录 token → 200。`server/data/.jwt-secret` 存在、权限 600、64 hex 随机（xxd 抽查非默认串）。 |
| 2 | S2 同人连举报 2 次 | **✓** | xiaoyu 举报 laoxu(5)：第1次 200，第2次 `409 已举报，请等待处理`，第3次换 reason 仍 409；credit 607→587 只扣一次。换 runner 当日再举报 → 200 但不再扣分（"当日首次才扣"规则生效）。管理后台 pending=3 与实际举报数一致。 |
| 3 | S3/A2 注销后幽灵 WS + 垃圾 token 4001 | **✓** | 新注册号与 momo 建会话 → WS auth_ok、发消息正常入库 → HTTP 注销（200）→ 同一条 WS 连接再发 `"注销后幽灵消息SHOULD-BE-BLOCKED"` → 收到 `{"type":"chat_error","error":"账号状态异常"}`，momo 侧拉历史确认**未入库**；HTTP `/auth/me` → `401 账号已注销`。垃圾 token 发 auth 帧 → 收到 `{"type":"auth_fail"}` 且连接被服务端 `close(4001,"认证失败")`（客户端实测 code=4001）。 |
| 4 | 注册 gender：手机号注册选女生 → 女生局申请成功 | **✓** | 手机号注册 gender=female/city=北京 → API 返回 `gender=female city=北京`（入库不再丢弃）；申请女生局 #24（清华图书馆）→ `200 {joined:true,status:pending}`，作者通过后 approved。对照：男生注册申请同局 → `403 该搭局仅限女生参加`（性别门槛未被误伤）。 |
| 5 | 满员婉拒（need_count=1） | **✓** | 女生局 #24 need_count=1：F1、F2 两人 pending → 作者通过 F1 → 帖子 `status=full`，**F2 自动 `rejected`** 并收到通知「申请未通过：该搭局已满员，未能通过你的申请，别灰心…」。（边界缺口见新发现 N4） |
| 6 | 登录限流 21 次 → 429 | **✓** | 重启清零后连续 21 次错误密码：第 1–20 次全 401，**第 21 次 `429 尝试过于频繁`**；限流窗口内正确密码也被 429（防爆破有效）；期间 `/api/meta` 200（不影响其他端点）；`X-Forwarded-For: 9.9.9.9` 伪造无法换桶绕过。附带复验 S4：同 IP 12 个不同手机号 sms/send → 前 10 个 200、第 11 个起 429。 |
| 7 | U1/U2 对比度实测 | **U1 ✓ / U2 ✗** | U1：`--text-3` 已改 `#6B7178`，pin-meta 实测 `rgb(107,113,120)` on 白卡=**4.93**、on 页面底 `#F6F7F9`=**4.60**，双场景过 AA。U2：`.btn.primary` 渐变已加深为 `#E8541F→#F05A24`（旧 `#FF7A45→#FF9A62`），但白字对比度=**3.67 / 3.39**，仍低于 AA 4.5（15.5px/700 非大字号，不适用 3:1 档）——详见新发现 N1。 |
| 8 | U3 键盘 Tab+Enter 进详情 | **✓** | 广场页 20 次 Tab 后焦点落在 `.pin-card`（`role="link" tabindex="0" aria-label="清华图书馆…"`），按 Enter → `#/post/24` 详情页（截图 `/tmp/r2-u3-keyboard-detail.png`）。键盘主路径 0%→可达。 |
| 9 | U4 城市 sheet Esc/取消 | **✓** | 打开城市 sheet：`role=dialog`、`aria-modal=true`、**底部有「取消」按钮**、焦点自动移入 sheet（实测落在取消按钮）；按 Esc → sheet 关闭且焦点归还触发元素 `#btn-city`。申请/评分/注销/举报/黑名单 sheet 均 `{cancel:true}`（post.js:238/437、misc.js:284/384/413、conv.js openReport）。 |
| 10 | 通知深链 + me 页铃铛 | **✓** | runner 点赞 xiaoyu 帖子后，me 页头部铃铛存在（`aria-label="通知，3 条未读"` + 未读红点），点击 → `#/notifications`；列表 3 条全部带深链（`data-post`），点击「收到新点赞」→ `#/post/14` 详情。（但"进页即全读"仍存在，见 N3） |
| 11 | 大字模式 | **✓** | 设置页开关即时生效：`cell-sub` 11.5→13px、`pin-meta` 11→12.5px、`tab-label` 10→11.5px、`html` 16→17px、`bubble` 15→16.5px；桌面 1366 + 大字模式无横向溢出（scrollW=1366=clientW），布局不破（截图 `/tmp/r2-bigfont-*.png`）。 |
| 12 | for-you 性能 | **✓** | 24 open 帖：登录用户 5 次采样 3.7–10.0ms（**远低于 100ms**，A3 的 LIMIT 200 候选池生效）；注入 250 帖到 273 open 帖时 14.6–18.4ms，时延上限可控。 |

**复验附加通过项**（非清单但顺手重放）：S5 WS chat 限流——1 秒连发 10 帧：前 5 帧入库推送、第 6 帧起 `close(4003,"发送过快")`；S6 重复 auth 窃听——socket 先 auth=xiaoyu 再 auth=admin，第三方在 conv1 发消息，切换后 socket 收到 **0** 帧（旧身份集合已清理），对照真 xiaoyu socket 正常收到 1 帧，功能无回归；`.jwt-secret` Web 不可达——`/uploads/../.jwt-secret`、`/uploads/%2e%2e/.jwt-secret`、`/.jwt-secret`、`/data/.jwt-secret` 等 8 种路径全部落到 SPA index.html（200 text/html）或 404，`/uploads/` 目录无列表；小林#1 注册引导兜底——带 `dada_need_onboard=1` 落地广场 5 秒后自动跳 `#/discover` 且「让搭搭更懂你」sheet 弹出。

## R2新发现：10项（P1×2 / P2×8）

### N1 [P1] U2 主 CTA 对比度仍未达 AA：白字 on #E8541F=3.67 / on #F05A24=3.39
- 复现：登录页「登录」按钮 computed style `linear-gradient(135deg, rgb(232,84,31), rgb(240,90,36))` + `color:#fff; font:15.5px/700`（`/tmp/r2-u2-login-btn.png`）。
- 分析：修复采用了 R1 建议里的"过渡方案"（渐变加深），R1 原文自己标注该方案"15.5px 加粗仍差一线"；达标方案是实底 `#D14514`（4.59）或加大字号。当前 3.39–3.67 只满足大字号/控件 3:1 档，15.5px 正文级按钮文字仍违 WCAG 1.4.3 AA。app.css:189 注释写"白字双端 ≥3:1"——修的标杆定低了。
- 建议：CTA（登录/发布/申请）改实底 `#D14514` 或文字 ≥18.66px bold；`:focus` 边框同步。

### N2 [P1] 声称"用户P1全修"，但 3 项 P1 未修（修复清单与实际不符）
1. **小林#3 我的搭局默认 tab**：`misc.js:112` 仍硬编码 `let type='published'`，无"有参加记录默认落我参加的"逻辑——刚提交申请的用户依旧先看空态。
2. **Amy#3 长按消息举报无理由选择**：`conv.js:111` 仍硬编码 `reason:'骚扰'`，诈骗话术（借钱）举报仍被错分类；与会话级举报（`openReport()` 有 5 选项理由 sheet）两条路径依旧不一致。
3. **Amy#2 注册页协议链接返回后表单清空**：`login.js:57` 《用户协议/隐私政策》仍是 `href="#/legal/terms"` hash 跳转，返回后注册表单整体重建、字段全空。
- 三处均为 R1 用户报告 P1 原文所指、修复声明范围内的遗漏（代码定位即证据，未逐条 UI 重放——代码路径无歧义）。

### N3 [P2] 通知"进页即全部已读"未修（搭子王#2 只修了一半）
- 复现：`misc.js:239` notifications 页 `load()` 后无条件 `POST /notifications/read`（空 body = 全部已读）。深链已修好，但用户点进来看一条，其余未读标记全部丢失，无法留待处理。

### N4 [P2] 满员婉拒只覆盖"通过即满"路径，author 直接标记 done 时 pending 仍悬置
- 复现（实测）：xiaoyu 发 need_count=2 局 → runner 申请（pending）→ 作者直接 `PUT {status:'done'}` → runner join **仍 pending**、相关通知 **0 条**。搭子王#3 的"完成时婉拒剩余"分支未实现（posts.js `completePost` 只给 approved 成员加分发通知）。

### N5 [P2] sheet 无焦点圈：aria-modal=true 但 Tab 可自由进入被遮罩背景
- 复现（桌面 1366 实测）：城市 sheet 打开焦点在取消按钮，连按 15 次 Tab **15/15 全部逃出到背景**（轨迹 BODY→`#btn-city`→`#btn-notif`→`#f-kw`→分类 pill…），`/tmp/r2-sheet-focus-desktop.png`。移焦/归还/ESC 都做了，独缺 focus trap；读屏按 aria-modal 会以为背景不可达。WCAG 2.4.3。

### N6 [P2] ws.js 未处理 4001：重连永不退避（~2s 恒定周期），auth_fail 用户零感知
- 代码确认：`ws.js` 无 close code 处理；`onclose` 里 `retry++` 退避，但 `onopen` 里 `retry=0` —— 每次重连 TCP 建立即清零 → auth_fail→close→2s→再连，**恒定 ~2 秒无限循环**（不会退避到 30s）。
- 实测边界：常规路径下页面任何 render 都会触发 `/auth/me`，401 后 api.js 清 token 跳登录，循环被截断（两次实测页面最终都落到 `#/login`、token 清除，未观察到死循环外溢）。残留风险：用户静置在无请求页面（如已打开的详情页）+ token 中途失效（封禁/密钥轮换）时，无 HTTP 请求触发清场，WS 将无限空转且用户无任何提示；`sendChat` 失败有 toast，但 `auth_fail` 帧本身前端零处理。
- 建议：onclose 收 `e.code===4001` 时 `API.clearSession()` + 跳登录，不再重连；`onopen` 不重置 retry（或 auth_ok 才重置）。
- 顺带确认（非本轮声明范围、R1 已有项）：A11 仍在——`disconnect()` 依旧 `handlers.clear()`，登出→不刷新重登录后实时角标回调丢失。

### N7 [P2] 限流键策略：伪造 XFF 无效（安全面✓），但反代部署会全站共桶
- 实测：伪造 `X-Forwarded-For: 9.9.9.9` 在限流期内登录仍 429 —— express 未设 `trust proxy`，`req.ip`=socket 地址，头不可伪造，无法分桶绕过（安全正确）。
- 但同一原因：按 `deploy/nginx.conf.example` 反代部署后**所有用户共享 proxy IP 一个桶**（登录 20 次/15 分钟、短信 10 条/小时全站共享），正常多用户会互相锁死。上线清单必须二选一：`app.set('trust proxy', 1)`（配合 nginx 固定 `X-Forwarded-For` 覆写，防客户端注入伪造）或改用 nginx `limit_req`。

### N8 [P2] 举报 24h 窗口不区分处理状态；扣分时机未采纳 R1 建议
- 代码+实测：dup 检查只看时间窗（users.js:215-219）——admin 把举报 resolve 甚至驳回后，举报者当日再举报仍 409，对"驳回后应可重报"场景是死路；`-20` 扣分仍在举报即时发生（仅改为"每 target 每日一次"，多举报者合并），R1 建议的"resolve 时扣分"未采纳——被恶意举报者当天先掉 20 分、事后驳回也不返还。409 信息泄露评估：409 只反映"我自己 24h 内举报过"，无法探测他人举报状态，无跨用户泄露。

### N9 [P2] for-you LIMIT 200：>200 open 帖后老帖在"为你推荐"永无曝光（评估：可接受，需知悉）
- 实测：注入 250 帖（273 open）后 kiki 视角 for-you 返回 20 条**全部来自最新 250 条，老帖 0 条**；老帖仍可从广场分页第 14 页到达，且 14 天过期任务会回收。评估结论：A3 性能修复的合理取舍，广场是主浏览面；但若运营指望 for-you 分发长尾内容，老帖会沉默过期——建议在候选池 SQL 里混入少量"同城老帖"配额或运营侧知悉。

### N10 [P2] approve 接口返回值语义漂移：返回的是审批前计数
- 实测：need_count=1 的帖子通过第 1 个申请后响应 `{"ok":true,"data":{"approved":0}}`（posts.js:337 在 UPDATE 之前取的 `approved` 计数）。当前前端不消费该字段无实际故障，属接口契约瑕疵，未来接入即误判。

## 结论：需再修（一轮小修后可发布）

- 安全面：R1 的 S1（P0）及顺手复验的 S4/S5/S6 均真实修复且实测通过；本轮未发现新增安全 P0。
- 阻塞发布的是**修复声明与实际不符**：N2 三项 P1 声称已修实则未动，N1 的 U2 修了但未达标——批评循环的信任基础是"说修了就是修了"，这比 P2 清单更优先。
- 建议下一轮工作量（预计 ≤1 天）：N1 换实底 CTA 色（1 行 CSS）+ N2 三处小改（myposts 默认 tab 判断 / conv.js 举报复用 openReport 理由 sheet / 协议链接改弹层或暂存表单）+ N6 的 4001 处理（ws.js 5 行）。N3–N5、N7–N10 可入 P2 池排期（N7 上线前必须做部署决策）。

---
### 附：环境还原记录
- DB 已还原至测试前快照（posts=24 / users=10 / reports=0 / joins=0 / laoxu credit=607），`data/.jwt-secret` 未变动（600）；服务已用原文件密钥重启，xiaoyu/admin 登录 200；测试中曾两次重启服务并短暂注入 `DADA_JWT_SECRET`（WS 循环实验），已全部恢复为文件密钥。
