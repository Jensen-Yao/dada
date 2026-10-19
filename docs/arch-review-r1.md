# 架构批评 R1：20 项（P0×4 / P1×7 / P2×9）

> 审查方式：只读代码 + 隔离实例压测验证（独立端口 + 数据库副本，未触碰 3000 端口生产实例与真实数据）。
> 已知勿重复项（DOMNodeRemoved→onCleanup、SQLite 单写者、uploads 路径）未列入。
> 所有"实测"均在 Node v24.15.0 / 本机复现，方法附在各条目内，可复跑。

## 总览

| 级别 | 数量 | 一句话 |
|---|---|---|
| P0 | 4 | JWT 默认密钥可伪造任意账号；WS 认证失败后消息静默丢失；/for-you 全量同步评分阻塞全站秒级；bcrypt 同步 + 全栈零限流 = 50 rps 打挂 |
| P1 | 7 | WS 无上限/无服务端心跳/无 jitter；封禁不踢在线连接；events/smsCodes 无界增长；迁移失败悬挂事务；登出清空全局 WS 回调 |
| P2 | 9 | multer 500 化、N+1、事务缺失分析、views 可刷、token 无过期预检、render 无并发护栏、孤儿上传文件等 |

---

## P0（特定条件必出事：崩溃 / 数据错乱 / 挂起 / 接管）

### [A1] JWT 密钥默认值与公开占位符 → 任意账号伪造（含 admin）| P0

- **代码证据**：
  - `server/src/util.js:4`：`const JWT_SECRET = process.env.DADA_JWT_SECRET || 'dada-dev-secret-change-me';`
  - `start.sh`（一键启动脚本）：`exec env DADA_PORT="$PORT" node src/index.js` —— **未设置 DADA_JWT_SECRET**，走默认值。
  - `deploy/systemd-example.service:41`：`# Environment=DADA_JWT_SECRET=...` —— 注释掉，同样回落默认值。
  - `docker-compose.yml:32`：`DADA_JWT_SECRET=please-change-me-to-a-long-random-string` —— 写死在公开仓库里的占位串，等效于公开密钥。
  - `server/src/util.js:25`：`getAuthUser` 只信 `payload.uid`，不校验签发者；`admin.js` 的 admin 判定基于库内 `is_admin` 字段 → 伪造 uid=1 即 admin。
- **复现**：测试实例（未设 secret）上，用 `jwt.sign({uid:1,username:'admin'}, 'dada-dev-secret-change-me')` 伪造 token 请求 `/api/admin/stats` → **200 + 全站统计返回**。同理可伪造任意 uid 冒充任何用户（发帖、私信、改资料、注销他人账号）。
- **影响**：全量账号接管 + 管理员接口（封禁用户、下架帖子、看举报含聊天内容快照）。密钥同时是"改密码也无法踢掉攻击者"的持久后门（30d TTL）。
- **修复方案**：启动时若 `DADA_JWT_SECRET` 未设置或长度 < 32，**拒绝启动**（fail-fast）而非回落默认值；docker-compose 用 `${DADA_JWT_SECRET:?err}` 强制注入；已有密钥轮换时同时给 token 加 `jti`+服务端失效表，或至少改短 TTL。

### [A2] WS auth_fail 后 socket 保持连接，消息静默丢失 | P0

- **代码证据**：
  - `server/src/index.js:99-101`：auth 失败只回 `{type:'auth_fail'}`，**不 close 连接**；之后 `index.js:104` `if (!user) return;` 静默丢弃一切 chat 消息。
  - `web/public/js/ws.js` 全文：**没有注册 `auth_fail` 处理**（grep `auth_fail` 前端零命中），onclose 也不触发；`ws.js:63` `sendChat` 只看 `readyState===1` 就返回 true。
  - `web/public/js/pages/conv.js:286`：`if (!WS.sendChat(...))` 才提示"连接已断开"——auth_fail 时走不到这个分支。
  - `web/public/js/api.js:20-26`：HTTP 401 会清 token 跳登录，但**不调 `WS.disconnect()`**，WS 与 HTTP 登录态脱钩。
- **复现**：实测 ws 客户端用垃圾 token auth → 收到 `auth_fail` → 发 `{type:'chat', conv_id:1, content:'这条消息会消失'}` → 3 秒内无任何回包、无 chat_error。对应用户真实场景：30d token 过期后打开聊天页、账号被封禁/注销但页面未刷新——**打字发送，UI 无回显无报错，消息蒸发**（前端不本地渲染，依赖服务端 WS echo）。
- **影响**：特定条件（token 过期/封禁/注销+长开页面）必现的用户数据丢失，且用户零感知。
- **修复方案**：服务端 auth_fail 后 `ws.close(4001,'auth_fail')`；客户端 `onclose` 收 4001 时清除会话跳登录；`sendChat` 失败与无 echo 超时（如 3s）都给 toast 并保留输入框内容。

### [A3] /for-you 全量候选池同步评分：50k 帖实测单请求 8.7 秒，期间全站冻结 | P0

- **代码证据**：`server/src/routes/misc.js:97-101` 候选查询 **无 LIMIT**（`WHERE p.status='open' AND u.status='active' ...` 全量拉取）；`misc.js:135-169` 对每行做 `getAuthor.get()`（136 行）+ `partners` 查询（155 行）+ matchScore + 排序——全部同步执行在事件循环里。
- **复现**（隔离实例，登录用户非冷启动路径，已预热）：
  | open 帖数 | /for-you 单请求均值 | /api/posts(20条) | sort=hot | /recommend |
  |---|---|---|---|---|
  | 24（种子） | — | 1.7ms | — | — |
  | 5,022 | **235ms**（max 304ms） | 2.4ms | 3.2ms | 2.7ms |
  | 50,022 | **8,655ms**（max 9,153ms；另一次独立测 8,196ms） | 3.5ms | 12.4ms | 16.3ms |
  10 倍数据 → 37 倍耗时（超线性：全量排序 + 每行 2 次点查 + 对象分配 GC）。单进程全同步架构下，这 8.7s 内**所有 HTTP 请求、WS 消息、心跳全部排队**（同 A4 的机制）。
- **影响**：数据涨到几万帖后，任何一个登录用户点开"为你推荐"= 全站 8 秒+ 停摆；多用户并发点 = 排队累加。这是"上线后必踩"的悬崖，不是理论值。
- **修复方案**：候选池先 `LIMIT`（如热度/最近 500 条）再评分；partners/getAuthor 改一次性 `IN` 查询或 JOIN；评分 SQL 化或加缓存（结果对同一用户短时间内确定——代码注释自己说"确定性规则"）；兜底：该路由加并发闸（同一时刻只允许 1 个在算）。

### [A4] bcrypt compareSync 同步阻塞 + 全栈零限流：50 并发登录冻结全站 4.6 秒 | P0

- **代码证据**：`server/src/routes/auth.js:131` `bcrypt.compareSync(...)`（cost 10，纯 JS 同步，单次 ~90ms）；`auth.js:83/109` `bcrypt.hashSync` 同理。全仓库（server + nginx 示例）**无任何限流中间件**（nginx.conf.example 无 limit_req；express 无 rate-limit 包）。
- **复现**：50 并发 `POST /api/auth/login`（错误密码，compareSync 跑满成本）+ 每 50ms 探测 `/api/meta`（最静态的端点）：
  - 50 请求 wall = **4,601ms**（单请求均值 2,358ms，纯排队）
  - 风暴期间 `/api/meta` 探针 91 次：**P50=2,312ms，P99=4,561ms**（基线 <2ms）
- **影响**：攻击成本 ≈ 一台笔记本 50 rps，即可让所有用户（含 WS 聊天、管理后台）卡死数秒，循环发即持续 DoS。注册接口 hashSync 同理。
- **修复方案**：换 `bcrypt.compare` 异步版（bcryptjs 原生支持回调/Promise）；登录/注册/短信接口加每 IP + 每账号限流（express-rate-limit 或 nginx limit_req）；登录失败加递增延迟。

---

## P1（技术债：条件满足时出事 / 持续劣化）

### [A5] WS 无连接上限、无未认证超时、无服务端心跳 | P1

- **代码证据**：`server/src/index.js:69` `new WebSocketServer({ server, path: '/ws' })`——无 `maxClients`/per-IP/per-user 上限；未认证连接永不过期（`index.js:104` 仅 `if (!user) return`，不踢）；`index.js:137-141` 的 30s"心跳清理"只删 `readyState===3`（CLOSED）——而 CLOSED 本来就会触发 `close` 事件走 `index.js:128` 清理，**该 interval 对活连接的存活性零探测**；服务端从不发 WebSocket ping 帧。
- **复现**：
  1. 同一用户 50 连接全部 auth_ok（50/50），再开 100 个未认证连接，150/150 存活，无任何拦截；
  2. 被动挂机 65s 的客户端收到**服务端 ping 帧 = 0**（客户端应用层 ping 每 25s 一次是唯一活性来源，客户端进程消失/NAT 超时后服务端无从得知）。
- **影响**：fd/内存可被无成本耗尽；移动网络切换产生的半开连接在 `onlineSockets` 里永久留死条目（用户"幽灵在线"，`sendToUser` 向死 socket 缓冲写入）。
- **修复方案**：`wss` 加连接数上限 + 单用户连接上限（如 5）；未 auth 连接 10s 踢；服务端周期 `ws.ping()`，两次无 pong 判死并 `terminate()`——现有 30s interval 改造成这个。

### [A6] 客户端重连无 jitter：服务重启即雷鸣群 | P1

- **代码证据**：`web/public/js/ws.js:38-40` `delay = Math.min(30000, 1000 * 2 ** Math.min(retry, 5))`——公式本身正确（首次重连在 close 后 ~2s，5 次后封顶 30s），但**无随机抖动**，所有客户端同相位。
- **复现**：20 个已 auth 客户端 + 复刻前端公式的重连逻辑 → 杀服务器 → 2s 后重启。重连成功时刻（相对首个成功）：第一波 20 个全部挤在 **0-21ms** 内，第二波 20 个挤在 **8014-8032ms**（18ms 窗口）——完全同步的两波冲击。
- **影响**：重启/发布瞬间全部在线客户端同毫秒窗口回涌，叠加 A3/A4 的同步阻塞，重启后第一波 `/auth`+列表请求就可能把刚起来的进程再次压死，形成抖动环。
- **修复方案**：`delay * (0.5 + Math.random())` 或 `delay + Math.random()*1000`；服务端重启后对 auth 消息做小排队。

### [A7] 封禁/注销不踢已建立的 WS 连接 | P1

- **代码证据**：`server/src/index.js:87-97` `user` 对象在 auth 时快照一次；`chat.js:109-134` `handleChatMessage` 校验会话成员/拉黑，**从不复查 `user.status`**。HTTP 侧每次请求都过 `getAuthUser`（`util.js:25` 要求 `status='active'`），WS 侧无此机制。
- **复现/推断依据**：代码路径推演（无 status 复查点）；被封禁用户只要不断线，`{type:'chat'}` 一直走 `handleChatMessage` 正常入库并广播。
- **影响**：管理员封禁违规用户后，该用户的实时聊天通道继续工作（继续骚扰/诈骗），"封禁"只对刷新页面的人生效——对一个人身安全定位的产品（safety.js 整页安全中心）这是治理漏洞。
- **修复方案**：`handleChatMessage` 开头查一次 `status`（点查很便宜）；封禁/注销时主动遍历 `onlineSockets.get(uid)` 逐个 `close(4003)`。

### [A8] events 表无限增长 + admin /funnel 全量加载：1M 行实测 2.2s / RSS +476MB | P1

- **代码证据**：`server/src/util.js:90-95` `trackEvent` 每次浏览插一行（`post_view` 含游客）；全仓库无 events 清理/TTL/归档任务。`server/src/routes/admin.js:43` `SELECT user_id, created_at FROM events WHERE created_at >= ?` **无 LIMIT 全量拉进内存**再逐行 `new Date().toISOString()` 分桶。
- **复现**：测试库灌 100 万 events 行（每行 ~100B，对应真实场景约几十万次浏览，量产后数周可达）→ 伪造 admin token（见 A1）请求 `/api/admin/funnel?days=90`：**耗时 2,197ms，服务进程 RSS 84.8MB → 560.8MB**（单请求 +476MB，同步阻塞 2.2s）。另：1000 次帖子详情请求 = events +1000 行 + WAL 涨到 4MB（每次浏览 2 次写：views_count UPDATE + events INSERT）。
- **影响**：埋点表按浏览量线性膨胀（无上限写入还放大写负载）；管理员每开一次看板，全站卡 2s+、内存尖峰数百 MB——events 到千万行时是 20s+/OOM。
- **修复方案**：events 加保留期任务（如 90 天，jobs.js 顺手做）；/funnel 改 SQL `GROUP BY` 聚合（日活用 `COUNT(DISTINCT user_id)` 按日分桶），不拉原始行；post_view 采样或按 session 去重。

### [A9] smsCodes Map 只增不减 + /sms/send 无 IP 限流 | P1

- **代码证据**：`server/src/routes/auth.js:11` `const smsCodes = new Map()`；唯一删除点是注册成功 `auth.js:89`；`verifySmsCode`（38-41 行）检查过期但**不删过期条目**；限流仅按手机号 60s 一条（27-30 行），无按 IP 限制。
- **复现**：20,000 个不同手机号打 `/auth/sms/send`，**1.7s 全部 200**，2 万条 `{code,expires,sentAt}` 永久驻留 Map（每条 ~200B，百万号段 ≈ 200MB+）。同时该接口每次做一次 users 全表 phone 扫描（见 A15 无索引）。
- **影响**：无成本内存膨胀 + 为接真实短信 SDK 后的计费轰炸（打满运营商通道）预留了通道；重启前不清除（注释说"重启失效"是唯一释放途径）。
- **修复方案**：`verifySmsCode` 过期即 `delete`；写 `setInterval` 惰性清扫（或改 LRU）；加每 IP 每小时 N 条的全局限流；接真实短信前必须上图形验证码。

### [A10] db.js 迁移失败无 ROLLBACK：悬挂事务吞掉后续全部写入 | P1

- **代码证据**：`server/src/db.js:57-73`：`BEGIN` → 建新表 → 拷数据 → `DROP` → 改名 → `COMMIT` 包在 try/catch 里，**catch 只 console.error，无 ROLLBACK、无 process.exit**。此后连接停留在打开的事务里。
- **复现/推断依据**：推演（构造列不兼容的旧库即触发）：迁移半途失败 → `BEGIN` 未回滚 → 后续所有 `.run()` 写入（发帖、聊天、登录时间戳…）都并入这个未提交事务，**进程重启时全部回滚消失**——服务"看起来正常"，数据悄悄蒸发。另：失败后 `users_new` 残留、外键 PRAGMA 状态不确定。
- **影响**：低概率（需旧库结构异常）但爆炸半径是全量写入丢失；且日志只有一行 error，难排查。
- **修复方案**：catch 里 `try { db.exec('ROLLBACK'); } catch {}` 后 `process.exit(1)`（迁移失败宁可拒启）；或迁移前用 `db.transaction()` 包装。

### [A11] 登出/注销清空 WS 全局 handlers：重登录后实时角标永久失效 | P1

- **代码证据**：`web/public/js/ws.js:46-50` `disconnect()` 执行 `handlers.clear()`——清的是**所有**回调，包括 `app.js:184-186` 模块加载时注册的全局角标回调 `WS.on('chat', () => refreshBadges())`；`misc.js:394`（登出）与 `misc.js:363`（注销）都调 `WS.disconnect()`；`login.js:155` 重登录只调 `WS.connect()`，无人重新注册全局回调。
- **复现/推断依据**：代码路径推演：登出→登录（不刷新页面）→ `handlers` Map 为空 → 收到新消息只有当前页面级回调（若在聊天页）生效，tab 角标/消息页红点不再实时更新，直到用户手动刷新。
- **影响**：每次"登出再登录"会话内，实时通知能力静默降级。
- **修复方案**：`disconnect()` 只 `sock.close()` 不清 handlers（handlers 属于 App 生命周期，连接属于会话）；或 `connect()` 时由 App 重新注册全局回调。

---

## P2（改进项）

### [A12] multer 错误一律 500"服务器开小差了"，污染错误监控 | P2

- **证据/复现**：`index.js:63-66` error handler 用 `err.status` 判断，而 `MulterError` 无 `status` 字段 → 实测：9MB 图（限 8MB）→ **500** `{"error":"服务器开小差了，请稍后再试"}`；非图片 mimetype → **500**。用户可修正的输入错误变成 5xx，报警里真假故障混流。另：非法 JSON body → 400 但透出英文解析器内部消息（`Expected property name or '}' in JSON at position 1...`）。
- **修复**：error handler 里 `if (err.name === 'MulterError') return res.status(400).json({ error: err.message })`；body-parse 错误统一中文文案。

### [A13] N+1 查询矩阵 | P2

- **证据**：`posts.js:61-101` `postView` 每帖 4 查（作者/liked/myJoin/approved 计数）→ 登录视角 20 条/页 = 2+80 = **82 查询/请求**；`chat.js:25-38` `convView` 每会话 3 查 × 上限 100 = 300；`users.js:156-177` /me/partners 每搭友 1 次 6 参数 EXISTS 大查；`misc.js:135+` 见 A3。
- **实测**：SQLite 本地点查极快——5k 帖时 `/api/posts` 仍只有 2.4ms，**当前不是性能问题**，列为债：迁移 PG/分库时首先爆炸；`sort=hot` 的计算列排序无覆盖索引，50k 帖 12.4ms 全表扫排序，随量线性涨。
- **修复**：列表页作者改 `IN` 批查或冗余 nickname/avatar 到 posts；liked/myJoin 用 `user_id IN (...) AND post_id IN (...)` 一次取回；approved 计数用 `GROUP BY post_id` 一次取回。

### [A14] 多步写无事务——同步执行下"事实原子"，仅崩溃残留 drift | P2

- **证据/分析**：approve（`posts.js:334-340`：UPDATE joins → getOrCreateConv → notify → UPDATE posts status）、点赞（231-236 两语句）、评论计数（270-271）均为多语句无事务。**关键结论**：全部路由同步执行（grep 验证 0 个 async handler）+ 单进程单连接 → 请求间无 interleaving，并发竞态不存在；唯一不一致窗口是进程在两条语句间崩溃（WAL 已提交部分保留），如 likes_count 与 likes 行数漂移。jobs.js 与请求同样串行，无冲突。
- **修复**：包 `db.transaction()`（node:sqlite 支持）或加启动对账（计数列 vs COUNT(*)）；若未来任何路由引入 `await`，此保护即失效——建议现在就包，作为防回归护栏。

### [A15] 其余数据层/接口细节 | P2

- `users.phone` 无索引（db.js 建表仅 username UNIQUE）：手机号登录（auth.js:125）与 /sms/send 查重（auth.js:23）每次全表扫；`auth.js:115` 用户名注册 `birth_year` 无 1900 下限/成年校验，且用户名注册模式整体绕过 `adult_confirmed`（合规口径漏洞，auth.js:96-119）。
- `users.js:63` PUT /me 的 birth_year 下限是"当前年-12"→ 允许 13 岁，与手机注册的 18 岁确认矛盾。
- **修复**：`CREATE INDEX idx_users_phone`；统一成年校验到两种注册模式。

### [A16] views_count 游客可无限刷 | P2

- **证据/复现**：`posts.js:181` 每次详情 GET 无条件 +1（无登录/去重/限流）——实测 post 1 的 views_count 到 1121（约 1000 次压测请求）。热度排序（`posts.js:123`）吃这个字段 → 可廉价刷热度。
- **修复**：按 user/session 每帖 24h 一次，或至少移出热度公式权重。

### [A17] 前端 token 无过期预检，localStorage 明文存 token | P2

- **证据**：`api.js:6` `localStorage.getItem(TOKEN_KEY)` 无过期判断；30d JWT 过期后**首个请求才知道**（401 → 清空跳登录，用户填了一半的表单丢失）；token 长期驻 localStorage，任何 XSS 即窃取（配合 A1 的 30d TTL 危害放大）。`api.js:20` 401 跳转对"过期"与"未登录"同文案，无法区分。
- **修复**：登录时存 `exp`（解码 JWT payload 即可），启动时过期主动清理；Safari/原生壳可考虑 httpOnly cookie 方案。

### [A18] render() 无并发护栏 + 未知路由空白页 | P2

- **证据**：`app.js:128-169` render 是 async 且无重入保护：页面函数 `await` 期间发生 hash 切换时，新页面先渲染、旧页面 continuation 之后继续向**已 detach 的 el** 写 DOM；旧页面在 await 之后注册的 `App.onCleanup`（如 `conv.js:403-406` 的 WS.on 注册在 `await loadConv` 之后）会晚一拍才被清理——空窗期内 stale 回调向死 DOM 写入（实测逻辑推演，无崩溃但浪费请求）。`app.js:161` `routes[page]?.()`：未知 hash（如 #/xyz）渲染**纯空白页**，无 404 兜底。
- **修复**：render 加序号（同 square.js fetchSeq 模式）丢弃晚到渲染；`routes[page] || notFound` 兜底。

### [A19] 上传孤儿文件与迁移残留 | P2

- **证据**：`posts.js:54-57` 图片合并 `slice(0, 6)`——超出的文件已落盘但不出现在任何帖子（无清理任务）；注销用户（`users.js:96-110`）头像文件保留；A10 迁移失败的 `users_new` 残留同类。磁盘只涨不降。
- **修复**：jobs 加每日孤儿清扫（比对 uploads 目录与 posts.images/users.avatar 引用）。

### [A20] notifyWS 循环依赖与心跳兜底 | P2

- **证据**：`chat.js:6` `import { notifyWS } from '../index.js'` ↔ index.js 导入 chatRouter——注释已声明靠 ESM 活绑定+函数提升成立，当前可用，但任何一方改为常量导出/初始化时即用即坏，属脆弱耦合。`ws.js:19` 客户端 ping 每 25s 而服务端 ws 库默认 `WebSocketServer` 无 heartbeat——建议服务端同时设 `ws.isAlive` 模式（与 A5 一并做）。

---

## 健壮项（实测/验证过没问题的，防止误修）

1. **express 4 async 挂起问题不适用**：grep 全部路由 0 个 async handler，全部同步——同步 throw 一律进 `index.js:63` 全局 error handler，不会挂起请求。
2. **500 不泄堆栈**：error handler 无 `err.status` 时返回通用文案（实测 UNIQUE 类异常路径、multer 均不泄栈；err.message 仅 4xx 透出）。
3. **WS 恶意 conv_id 不崩进程**：实测 node:sqlite 对 NaN 绑定返回 undefined → `handleChatMessage` 走"会话不存在"分支返回 chat_error；`run(undefined)` 才抛（当前无此调用点）。`JSON.parse` 包了 try。
4. **jobs 双保险**：三个子任务独立 try-catch + interval 再包一层 + `unref()`，单轮失败不冒泡（jobs.js:99-112）。
5. **发布幂等护栏在同步模型下无竞态**：60s 同标题+内容去重（posts.js:160-164），检查与插入间无 await，注释自证成立。
6. **埋点静默失败**（util.js:90-95）、计数防负 `MAX(0,...)`（posts.js:232）、信用分钳制 0-1000（util.js:180）。
7. **拉黑口径一致**：feed 过滤、评论过滤、动作级拦截、通知投递（operatorId）四处统一走 `anyBlocked`。
8. **注销账号密码失效**：随机串替换 bcrypt hash（users.js:101），原密码必失效；登录对 banned/deleted 分支文案区分。
9. **测试覆盖**：server/test/api.test.js 64 个用例覆盖主要业务流与权限边界（本轮未发现断言性错误）。

## 压测数字摘要

| 场景 | 结果 |
|---|---|
| GET /api/posts 1000 请求 @c10（24 帖） | 0 错误，P50=17.4ms P99=25.2ms（延迟≈并发×单请求同步耗时，队头串联） |
| GET /api/posts @c50 | P50=79.5ms P99=96.5ms（≈50×1.9ms，同步串联佐证） |
| /for-you 5k / 50k open 帖 | 235ms / **8,655ms**（同步阻塞全站） |
| 50 并发登录（bcrypt compareSync） | wall=4,601ms；期间 /api/meta P50=**2,312ms** max=4,561ms |
| WS 连接 | 单用户 50 连接全过 + 100 未认证全过（150/150），无上限；65s 服务端 ping=0 |
| WS 重连（杀进程重启，20 客户端） | 两波完全同步：21ms / 18ms 窗口内全部挤入，无 jitter |
| /admin/funnel @1M events | 2,197ms，RSS 84.8→560.8MB |
| events 增长 | 1000 详情请求 = +1000 行，WAL 至 4MB |
| /sms/send | 20,000 手机号 1.7s 全入 Map，无 IP 限流 |
| 伪造 JWT（默认 secret） | /api/admin/stats 返回 200 全量统计 |
| multer 超限/类型错误 | 均 500 通用文案；坏 JSON → 400 英文内部消息 |
