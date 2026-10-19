# 安全批评 R1（渗透测试视角）

- 测试时间：2026-10-12
- 测试环境：`DADA_PORT=3960` 全新 seed 实例（本报告全部证据编号 T*），并抽查了长期运行的 `:3000` 实例（S1 同样命中）
- 测试账号：xiaoyu(uid=2) / runner(uid=3) / momo(uid=4) / kiki(uid=6) / daye(uid=7) / admin(uid=1)，密码均为 123456
- 方法：全部为真实请求复现（curl / node ws 客户端），无猜测项

## 安全批评 R1：12 项（P0×1 / P1×5 / P2×6）

---

### [S1] P0｜JWT 签名密钥为代码内置默认值，可离线伪造任意用户/管理员 token（含 WS）

- **攻击步骤**
  1. 阅读 `server/src/util.js:4`（开源仓库即知）：`const JWT_SECRET = process.env.DADA_JWT_SECRET || 'dada-dev-secret-change-me'`。
  2. 本地用该默认串签发 `{uid:1, username:'admin'}` 的 HS256 token。
  3. 带 `Authorization: Bearer <forged>` 访问 `/api/admin/stats`、`/api/admin/users/:id/ban`、`/api/auth/me`、WS `auth` 帧。
- **证据**
  - `:3960` `/api/admin/stats`（伪造 admin token）→ `{"ok":true,"data":{"users":10,...}}`（T1）
  - `/api/auth/me`（伪造 `{uid:2,username:'hacker'}`）→ 完整返回小鱼干资料（T1b）
  - 伪造 admin 调 `POST /api/admin/users/3/ban` 两次 → `{"banned":true}` / `{"banned":false}`，任意封/解封用户（T1c）
  - **长期运行的 `:3000` 实例同样命中**：伪造 token 返回 `{"users":16,...,"messages":11}` 真实运营数据（T1 附验）
  - WS：伪造 admin token 发 `auth` 帧 → `{"type":"auth_ok","user_id":1}`（T21c）
  - 运行中的 4 个 dada 进程 environ 均无 `DADA_JWT_SECRET`；`docker-compose.yml:32` 与 systemd 示例里的占位值 `please-change-me-to-a-long-random-string` 本身也是公开在仓库里的"密钥"
- **危害**：全站接管——任意账号冒充（发帖/私信/评价均以受害者身份）、管理员后台全开放（封禁用户、下架帖子、撤回消息、处理举报）、配合 WS 可冒充任何人聊天。无需任何前置条件，curl 即可复现。
- **修复建议**：启动时若未设置 `DADA_JWT_SECRET` 且 `NODE_ENV=production` 直接拒绝启动；密钥改为 ≥32 字节随机值并从环境/密管注入；部署示例中的占位串改为"必须自行生成"的强提示；轮换密钥时用 `kid` 双密钥宽限。

---

### [S2] P1｜举报接口无限刷：单人即可把任意用户搭力值打到 0 并灌爆管理后台

- **攻击步骤**：登录普通用户，对同一目标循环 `POST /api/users/:id/report`（reason 用合法枚举值"骚扰"即可）。
- **证据**：xiaoyu 连续举报 laoxu(id=5) 8 次，全部 200；laoxu credit `655 → 495`（每次 -20，T13）；管理后台 pending 队列瞬间 +8 条。代码依据 `server/src/routes/users.js:202-213`：无同 reporter+target 去重、无频率限制、`addCredit(targetId, -20, ...)` 即时报复性扣分。
- **危害**：把任意用户搭力值刷到 0（<300 即被禁止发帖，等于"软封禁"）；伪造海量举报淹没真实 moderation 队列；可定向打击竞品帖子作者。
- **修复建议**：同一 reporter 对同一 target 仅允许一条 pending 举报；举报不即时扣分（当前注释也写明真实环境由风控介入，扣分应改为 admin resolve 时执行）；按用户/小时限频。

---

### [S3] P1｜注销账号后已建立的 WS 连接仍是"活幽灵"，可继续发消息

- **攻击步骤**：注册新号 → 与 xiaoyu 建立会话 → WS `auth` 建连并发一条消息 → HTTP `POST /api/users/me/delete` 注销 → 用同一条 WS 连接继续发 `chat` 帧。
- **证据**（T24）：注销后 HTTP `/auth/me` 正确返回 `401 账号已注销`；但 WS 发送 `"AFTER DELETE - ghost message"` 被正常入库（messages id=310, sender_id=13）并实时推送给了对端 xiaoyu。代码依据 `server/src/index.js:86-127`：`user` 只在 auth 帧时解析一次，`handleChatMessage`（`chat.js:109-134`）只校验会话成员关系，从不复查 `users.status`。封禁（banned）同理不会踢掉已建连接。
- **危害**：被注销/封禁账号的残留连接可继续冒充"已注销用户"发消息（内容不受任何身份约束，事后追责对象已不存在）；与 PIPL 注销"停止处理个人信息"的合规口径冲突。
- **修复建议**：WS 每条 `chat` 帧处理前复查用户状态（或注销/封禁时主动关闭该用户全部 socket：遍历 `onlineSockets` close）；心跳帧顺带校验。

---

### [S4] P1｜短信接口仅按"单个手机号"限频，无全局/IP/验证码限制——短信轰炸与内存打满

- **攻击步骤**：未登录循环调用 `POST /api/auth/sms/send`，每次换一个手机号。
- **证据**（T17）：20 个不同号码连续请求 **20/20 全部成功**且即时返回；同号 60s 内重发才被拒（`{"error":"发送过于频繁..."}`，T17b）。代码依据 `server/src/routes/auth.js:13,28`：`SMS_RESEND_INTERVAL` 仅以 phone 为 key；`smsCodes` Map 无容量上限。接口无需登录、无图形验证码（T17c）。
- **危害**：接入真实短信通道后：(a) 任意人可对任意手机号段发起轰炸骚扰，短信费由平台承担；(b) 高频换号可无上限撑大 `smsCodes` 进程内存。演示环境 `demo_code` 直接回显属已知接受项，本条针对的是**频控缺失**。
- **修复建议**：按 IP（滑动窗口）+ 全局小时配额双层限频；发送前加图形/行为验证码；`smsCodes` 加 TTL 清理与容量上限。

---

### [S5] P1｜WebSocket 聊天无任何限流：单连接 4 秒灌入 300 条全部落库

- **攻击步骤**：WS auth 后循环发 `{"type":"chat","conv_id":N,"content":"flood"}`。
- **证据**（T23）：300 条连发，`delivered=300 errors=0`，约 4s 内全部写入 messages 表并推送给对端（对端通知/未读数全被打爆）。代码依据 `server/src/index.js:105-123`：无每秒条数/每分钟配额检查。
- **危害**：单账号单连接即可无限膨胀 SQLite（磁盘写放大、WAL 增长），接收方未读数/会话列表被刷爆（骚扰放大器）；横向扩到多连接即应用层 DoS。
- **修复建议**：每用户每 N 秒消息数上限（超出返回 chat_error 并断开）；消息长度已有 2000 上限，补条数上限；对端推送聚合。

---

### [S6] P1（需受害者 token 短暂泄露或叠加 S1）｜WS 同连接重复 auth：换身份后仍持续接收前一用户的全量推送

- **攻击步骤**：同一 WS socket 先 `auth` 为用户 A，再 `auth` 为用户 B（服务端允许，两次都回 `auth_ok`），之后保持连接。
- **证据**（T33）：socket 先 auth=xiaoyu 再 auth=meimei（两次 `auth_ok`），随后第三方 runner 在 conv 2 给 xiaoyu 发消息，**已切换为 meimei 身份的攻击端 socket 收到了本应只推给 xiaoyu 的消息**。代码依据 `server/src/index.js:91-102`：重复 auth 只新增不清理——`onlineSockets.get(A)` 里的旧 socket 条目仍在，`sendToUser(A)` 会继续推给它；`close` 处理（index.js:128-133）也只从最后一个身份的集合中移除。
- **危害**：一旦 token 被短暂窃取（或直接用 S1 伪造），攻击者在"切回自己账号"后仍被动接收受害者的全部实时消息/通知，属于持续性静默窃听；也破坏"一连接一身份"安全不变量。
- **修复建议**：auth 帧处理时先从当前 `user` 的集合移除本 socket 再切换；重复 auth 直接拒绝或断开；close 时按历史身份集合全量清理。

---

### [S7] P2｜点赞开关可无限刷通知（骚扰向量）

- **攻击步骤**：对目标帖子循环 `POST /posts/:id/like`（每次即点赞+取消）。
- **证据**（T27）：10 次 toggle → runner 通知数 `8 → 13`（每次重新点赞都触发 `notify`，`posts.js:237`），无频控。
- **危害**：向任意用户定向刷通知（红点轰炸），notifications 表被灌水。
- **修复建议**：同 actor 对同对象的同类型通知 N 分钟内合并/去重；互动类动作限频。

---

### [S8] P2｜登录接口无锁定/限频，可在线爆破弱口令

- **攻击步骤**：对 `/api/auth/login` 连续发错误密码。
- **证据**（T26）：20 次错误后第 21 次仍正常返回 401 可继续尝试，无锁定、无验证码、无 IP 限频（`auth.js:121-139`）。种子数据全员 6 位弱口令 `123456` 也加重此风险。
- **危害**：在线字典攻击（bcrypt 仅减缓速率，弱口令一猜即中）。
- **修复建议**：按账号+IP 双维度失败计数与指数退避；连续失败引入验证码；演示种子改随机强口令。

---

### [S9] P2｜短信验证码校验无尝试次数上限，可暴力枚举 6 位码

- **攻击步骤**：对某未注册手机号 `sms/send` 后，在 5 分钟有效期内对 `/auth/register` 高速遍历错误 code。
- **证据**（T18）：连续 30 次错误 code 全部返回"验证码错误"且**无任何锁定**，第 31 次仍可继续；拿到正确 demo_code 后立即注册成功。`auth.js:37-41,66,89`：失败不计数、`smsCodes.delete` 仅在注册成功时执行。
- **危害**：接入真实短信后，攻击者可不依赖验证码泄露、纯枚举（~10^6，5 分钟内高 RPS 可行）替他人手机号注册账号。
- **修复建议**：每 phone 验证码错误 ≥5 次即作废重发；注册接口按 IP 限频。

---

### [S10] P2｜游客浏览即触发无限 DB 写入（events 行 + views_count），指标可被污染

- **攻击步骤**：未登录循环 `GET /api/posts/:id`。
- **证据**（T30）：50 次匿名请求后 post5 `views_count` 达 337；每次请求同时 `trackEvent` 落一行 events（`posts.js:181-182`），无任何采样/频控，且游客 `user_id=NULL` 无法追责。
- **危害**：events 表被无成本灌大（影响 /admin/funnel 与日活统计口径——可伪造"日活"骗运营）；热门排序（views/50）可被刷。
- **修复建议**：游客事件按 IP+post 维度采样或限频去重；views_count 同理。

---

### [S11] P2｜非法文件类型上传返回 500（应为 400），错误码语义错误

- **证据**（T20）：avatar 传文本文件 → `{"error":"服务器开小差了，请稍后再试"} [500]`；>5MB 同样 500。multer `fileFilter` 抛出的 Error 未带 `status`（`users.js:21-24`、`posts.js:43-46`），落入兜底 500 分支（`index.js:63-66`）。
- **危害**：无信息泄露（兜底文案不含堆栈，这点做得对），但 500 告警噪音会掩盖真实故障，监控失真。
- **修复建议**：捕获 multer 错误映射为 400 + 明确文案（"仅支持图片文件"）。

---

### [S12] P2｜CORS 全开（`app.use(cors())`）

- **证据**：`server/src/index.js:25` 无 origin 白名单，任意站点可携带用户 token 发起跨域 API 调用（token 若被前端脚本读取，恶意页面可直接驱动 API）。
- **危害**：鉴权为 Bearer 头而非 Cookie，CSRF 风险低，但配合任何 XSS/token 泄露即成放大器；不符最小化原则。
- **修复建议**：`cors({ origin: <app 域名白名单> })`，Capacitor 外壳用 `capacitor://localhost` 等 scheme。

---

## 安全的项（攻过没攻破，20 项）

1. **admin 接口矩阵**：普通用户 token 访问 `GET /admin/stats|funnel|reports|users`、`POST /admin/reports/:id/resolve`、`POST /admin/users/:id/ban` 全部 `403 需要管理员权限`（router 级 `requireAuth+requireAdmin`，admin.js:7-11）（T5）。
2. **越权改帖**：xiaoyu `PUT /posts/2`（runner 的帖子）→ `403 只能编辑自己发布的搭局`（posts.js:190）（T6）。
3. **越权看申请列表**：`GET /posts/2/joins` 非组局者 → `403`（posts.js:308）（T7）。
4. **越权审批**：非组局者 approve 他人帖子的 join → `403 只有组局者可以操作`（posts.js:329）（T9）。
5. **并发重复审批**：need_count=3 的帖子 4 个 join 并发 approve，恰好 3 个通过、第 4 个 `人数已满`——better-sqlite3 同步执行天然原子，无竞态（posts.js:325-345）（T10/T10b/T10c）。
6. **rate 伪造**：非同局用户互评（双向）、评局外第三方、给自己评分 → 全部被"只能评价一起参加过该搭局的人/不能评价自己"拦截；重复评分被唯一性检查拦下（`已经评价过对方了`）；`stars:99` 拒绝。`stars:"5e10"` 被 `parseInt` 收敛为 5 落在合法域，无危害（posts.js:348-369）（T12 系列）。
7. **给自己帖子申请 join** → `400 不能加入自己发布的搭局`（posts.js:283）（T11b）。
8. **need_count 边界**：`0 / -5 / "abc"` 全被钳到 1，`99999` 钳到 20，且低于已通过人数被拒（posts.js:154,202-206）（T15）。
9. **搭力值溢出**：`addCredit` 用 `MAX(0,MIN(1000,...))` 双向钳制，无负数/溢出（util.js:180）（T13 顺带验证下界）。
10. **SQL 注入全家桶**：keyword `' OR '1'='1`、`%';--`、`UNION SELECT`、`sort=;DROP TABLE posts--`、登录用户名注入、注册昵称 `a'b"c;--`、bio 内嵌 `" WHERE id=1--`、`status` 字段注入、admin keyword `%%`——全部被参数化查询/白名单化解，库表完好（posts.js:118-127、users.js:52-83、auth.js:97）（T14 系列）。
11. **JWT 其余攻击**：`alg=none` token → 401（jsonwebtoken v9 默认拒绝）；过期 token → 401；**无密钥**的 uid 篡改（换 payload 留旧签名）→ 401（T2/T3/T4）。唯独默认密钥泄露（S1）破防。
12. **用户信息泄露**：`/api/users/:id` 与 `/auth/me` 返回字段白名单（publicUser），不含 phone/password_hash/adult_confirmed 等（util.js:53-77）（T19）。
13. **错误堆栈泄露**：畸形 JSON → 400 带简短信息；>1MB body → 413；触发 500 时仅返回通用文案，无堆栈/路径（index.js:63-66）（T20）。
14. **WS 未授权**：未 auth 发 chat 帧被静默丢弃（`if (!user) return`，index.js:104）；假 token → `auth_fail`；`conv_id=99999` → `会话不存在`；**非会话成员**（runner → xiaoyu-meimei 的 conv 1）→ `无权在该会话发送消息`（chat.js:110-112）（T21/T21b/T22/T22b）。
15. **上传越权与类型**：给别人帖子传图 → `403 只能给自己的搭局传图`；非图片与超限文件被拒（posts.js:52、multer limits/filter）（T25/T20）。
16. **私信门槛**：无 approved 同局关系创建会话 → `403 申请通过后才能私信`；读取非本人会话消息 → `403 无权访问该会话`（chat.js:57-74,80）（T32/T32b）。
17. **封禁用户 token**：ban 后原 token 立即 `401 请先登录`（getAuthUser 仅认 `status='active'`，util.js:25）（T29）。
18. **未登录访问矩阵**：`/auth/me`、`/chat/convs`、`/my/posts/published`、`/notifications`、`/users/me/ratings`、`/users/me/partners` 全 401（T31）。
19. **通知越权操作**：`POST /notifications/read` 的 UPDATE 以 `user_id=?` 为条件，无法替他人已读/篡改（misc.js:32-41）。
20. **字段走私**：`PUT /posts/:id` 塞 `user_id/likes_count/views_count` 等未白名单字段 → 全部忽略（posts.js:192-207 仅处理白名单列）（T14 附验）。

## 复现环境说明

- 测试实例：`DADA_PORT=3960`（本机 pid 见 /tmp/dada-3960.pid，测试后已杀）；抽查命中 S1 的常驻实例 `:3000` 未做任何写操作外的破坏性变更（ban 后已还原）。
- 对 laoxu(credit 655→495)、kiki/daye（测试申请记录）等种子数据有测试污染，重跑 `node src/seed.js` 即可复原。
