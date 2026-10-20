# R5 API 契约审计（平台API设计 / 小程序端·第三方集成视角）

> 审计人：搭搭（API契约一致性批评家，R5 新视角）
> 方法：通读 `server/src/routes/` 全部 7 个路由文件 + `index.js` / `util.js`，并对运行中的 localhost:3000 做了 40+ 次 curl/WS 实测（注册双账号走完 发布→申请→批准→聊天→举报→管理端处理 全链路，含错误分支与边界值）。
> 交付物：本文（审计）+ `docs/api.md`（从代码逆向生成的接口文档，56 个 HTTP 端点 + 1 个 WS 通道全覆盖）。

## 结论速览

- 不一致 **14 项**：P1 契约不一致 8 项（对小程序/第三方直接造成适配成本或错误行为），P2 规范建议 6 项。
- 实测确认的契约健康面：成功包络 `{ok,data}` 56/56 一致、错误包络 `{error}` 一致（1 个例外见 API-2）、全站 snake_case 无 camelCase 混用（含 WS 帧）、时间戳统一 epoch 毫秒。
- 最该统一的 1 条：**[API-1] 列表响应形状三套并存**（影响全部 17 个列表端点的每个消费方）；修复成本最低、收益立现的是 [API-2]（一个 catch-all 中间件）。

---

## R5 API契约批评：14项（P1契约不一致/P2规范建议）

### P1 — 契约不一致（第三方/小程序直接受损）

**[API-1] 列表响应形状三套并存** ｜ 涉及全部 17 个列表端点
现状对照（实测盘点）：

| 形状 | 端点 |
|---|---|
| A. `{list,total,page,size,has_more}`（全分页） | `GET /posts`（全站唯一） |
| B. `{list}`（有包络无元信息） | `GET /users/me/partners`、`GET /recommend`、`GET /for-you` |
| C. 裸数组（data 直接是数组） | `GET /posts/:id/comments`(≤200)、`GET /posts/:id/joins`(无上限)、`GET /my/posts/published`(≤100)、`GET /my/posts/joined`(≤100)、`GET /chat/convs`(≤100)、`GET /chat/conv/:id/messages`(≤500，messages键)、`GET /notifications`(≤100)、`GET /users/me/ratings`(≤50)、`GET /users/me/blocks`(无上限)、`GET /reports/mine`(≤50)、`GET /admin/reports`(≤200)、`GET /admin/feedback`(≤200)、`GET /admin/users`(≤100)、`GET /cities`(≤50) |

消费方每个列表都要写三分支适配：`const items = Array.isArray(d) ? d : d.list`，且无法判断"还有没有下一页"（只剩静默截断：第 101 条会话永远拉不到，无任何提示）。
统一建议：列表一律 `{list, has_more, total?}` —— `has_more` 用"本页条数==限额"廉价判定即可，不必都加 COUNT。迁移兼容口径：后端先把裸数组包成 `{list}` 并保留旧字段一个版本（前端一行 `Array.isArray` 兼容层即可双吃），小程序端统一走 `unwrapList()` 帮助函数。

**[API-2] 未匹配 /api/* 路径返回 Express 默认 HTML 404** ｜ 涉及全局兜底
现状对照（实测）：`curl /api/nonexistent` 与 `curl -X DELETE /api/posts/1` 均返回 `Content-Type: text/html` + `Cannot GET /api/xxx`（Express 默认错误页）；SPA fallback 的正则 `(?!\/api)` 把 /api 排除后无人接盘。第三方 JSON.parse 直接失败，拿不到 `{error}` 结构，无法区分"路径写错"与"资源不存在"（后者是规范的 JSON 404）。
统一建议：`api` Router 末尾追加 `api.use((req,res)=>res.status(404).json({error:'接口不存在'}))`，再补一个 405 中间件（路径匹配但方法不符时返回 `{"error":"方法不支持"}`）。零破坏性：现网没有任何端点依赖 HTML 404。

**[API-3] 冲突语义 400/409 混用** ｜ 涉及全部状态机类端点
现状对照（实测）：同为"重复操作/状态冲突"，一边是 409 一边是 400：

| 场景 | 状态码 |
|---|---|
| 手机号/用户名已注册、24h 内重复举报 | **409**（auth.js、users.js） |
| 已申请过该搭局（实测重复 join） | 400 |
| 该申请已处理（重复 approve）、该举报已处理（实测重复 resolve）、该反馈已处理、已退出过该搭局、该搭局已完成、已通过学生/真人认证、已经评价过对方了、人数已满 | 400 |
| 该搭局已停止招募 / 不能加入自己发布的搭局 | 400 |

统一建议：幂等性冲突（重复提交同一动作）统一 409，前置条件不满足（局未开始、人数真满了）留 400。兼容口径：小程序端 4xx 分支本就统一弹 `error` 文案，状态码归并不破坏前端，仅需在 api.md 同步；对第三方则是把"要不要重试"的判断依据固定下来（409 不重试、400 可修正后重试）。

**[API-4] approve 端点承载双语义，响应字段 `approved` 一词两义** ｜ `POST /posts/:id/joins/:joinId/approve`
现状对照（实测）：`{"approve":false}` 走拒绝逻辑；成功响应 `{"ok":true,"data":{"approved":0}}` —— 实测该值为 0，读代码确认它是**已通过人数 COUNT**，不是布尔。而全站其他动作端点的同形字段全是布尔（`liked/blocked/banned/rated/reported/commented/quit`）。第三方极易把 `{approved:0}` 解读为"批准失败"。
统一建议：拆为 `POST .../approves`（通过）与 `POST .../rejection`（拒绝）或改 `body.action:'approve'|'reject'`；响应改 `{approved_count:1, join_status:'approved'}`。兼容：保留旧端点一版本，新字段与旧字段并出。

**[API-5] 切换型端点三种习语并存，且 toggle 有重试翻转风险** ｜ `POST /posts/:id/like`、`POST+DELETE /users/:id/block`、`POST /admin/users/:id/ban`
现状对照：like 是单端点 toggle（重复 POST 在赞/取消间翻转，实测两次调用 `liked:true→false`）；block 是对称的 POST 拉黑 + DELETE 取消（幂等 `INSERT OR IGNORE`）；admin ban 是单端点 toggle（实测两次调用 `banned:true→false`）。弱网重试一个 like 请求会把用户刚点的赞撤销；重试 ban 会把刚封的人解封——这对管理操作是事故级语义。
统一建议：全部改为显式意图 + 幂等：like 拆 `PUT /posts/:id/like` / `DELETE /posts/:id/like`（对齐 block 习语）；admin 拆 `POST /users/:id/ban`（封）+ `POST /users/:id/unban` 或 `DELETE`。兼容：旧 toggle 端点保留并文档标注"非重试安全"。

**[API-6] 资源型 vs 动作型混用，注销/已读藏在动作路径里** ｜ 全站写端点
现状对照盘点：
- 资源型（合理）：`PUT /users/me`、`PUT /posts/:id`、`POST /posts`（创建）、`DELETE /users/:id/block`
- 动作型（合理）：`POST /posts/:id/like|join|quit|rate`、`POST /notifications/read`、`POST /admin/*/:id/resolve`
- 混用点：① 注销用 `POST /users/me/delete`（路径里写方法名，应是 `DELETE /users/me` 或语义化 `POST /users/me/deletion`）；② 申请加入是 `POST /posts/:id/join`（单数）而列表是 `GET /posts/:id/joins`（复数），创建资源却不在复数集合上，REST 惯例断裂；③ 拒绝申请藏在 approve 端点（见 API-4）；④ `PUT /posts/:id` 同时承担编辑与状态流转（close/done），状态机变更混进部分更新语义。
统一建议：不必追求 REST 纯度，但同名概念要对齐——join 创建统一到 `POST /posts/:id/joins`（旧 `/join` 做别名）；注销新增 `DELETE /users/me`（旧路径保留）；状态流转拆 `POST /posts/:id/status`（`{"status":"done"}`），编辑留在 PUT。兼容口径：全部旧路径 301/双挂一个版本。

**[API-7] 分页四态并存 + `pageArgs()` 是死代码** ｜ 全部列表端点
现状对照：仅 `/posts` 有 page/size/has_more/total；其余为固定 LIMIT 静默截断（comments 200 / notifications 100 / convs 100 / messages 500 / my/posts 100 / ratings 50 / reports.mine 50 / admin 200·200·100）；`GET /posts/:id/joins` 与 `GET /users/me/blocks` 连 LIMIT 都没有（全量）；`util.js` 的 `pageArgs()` 定义了却零调用（grep 证实）。 especial: messages LIMIT 500 意味着第 501 条历史消息永久不可达——聊天记录一长就"丢"，且无 cursor 可翻。
统一建议：短期给所有固定 LIMIT 端点补 `?page/size`（复用 pageArgs，顺手激活死代码）+ `has_more`；聊天消息改 cursor 分页（`?before_id=`，按 id 升序天然适配）。兼容：不传参数时保持现行为（默认 LIMIT 不变），纯增量。

**[API-8] 响应字段泄漏 SQL 别名与内部行** ｜ `GET /cities`、`GET /reports/mine`、`GET /notifications`、`GET /admin/reports|feedback`
现状对照（实测）：`/cities` 返回 `[{"city":"北京","c":13}]` —— `c` 是 SQL `COUNT(*) c` 别名原样透出，未文档化、语义不明；`/reports/mine` 用 `...r` 展开举报表整行，`reporter_id`/`resolve_action`/内部 status 直接到达客户端；`/notifications` 同样展开整行（含 `user_id`、`read` 0/1 而非布尔）；`/admin/feedback` LEFT JOIN 出可空的 `user_nickname/user_status` 无说明。第三方按 api.md 对接时这些字段全是暗坑。
统一建议：一律白名单视图函数（仿 `publicUser`/`postView`）：cities 改 `{city, post_count}`；reports/mine 只出 `{id,target_type,target_id,reason,status,resolved_at,action_text,created_at}`；notifications 的 `read` 改布尔并去掉 `user_id`。兼容：新增规范字段与旧字段并出一个版本，前端逐步切换。

### P2 — 规范建议（不破坏现有前端，文档化或增量改进）

**[API-9] GET 带副作用未文档化** ｜ `GET /posts/:id`（views_count+1）、`GET /chat/conv/:id/messages`（批量标记已读 + 向对端推 peer_read）
实测确认每次详情 GET 浏览数上涨；消息 GET 即已读。任何第三方预取/缓存刷新都会虚增浏览量、误触发"已读"回执。建议：api.md 明示（本次已写入）；后续提供 `GET /chat/conv/:id/messages?mark_read=0` 只读变体。

**[API-10] 消息发送无 HTTP 端点，聊天是 WS-only** ｜ `/api/chat/*` + `/ws`
实测：`/api/chat` 下只有 conv 列表/建立/历史/举报，发送消息仅存在 WS `chat` 帧（`handleChatMessage` 只被 WS 调用）。小程序/第三方必须实现 WebSocket + auth 握手 + 4001/4003 关闭码语义（api.md §9 已完整记录）。建议：若目标集成方不便持 WS，可补 `POST /chat/conv/:id/messages` 复用 handleChatMessage（同函数同校验，零逻辑分叉）。

**[API-11] `/api` 无版本段** ｜ 全局
建议：新增 `/api/v1/*` 作为规范前缀，`/api/*` 以别名挂载保持兼容（Express `app.use('/api/v1', api)` + `app.use('/api', api)` 两行）； Breaking 变更（如 API-1 的形状归一）落到 v2 或在 v1 内以新字段并出。当前 56 个端点均无版本协商能力，任何契约收紧都是全量客户端同步升级。

**[API-12] 429 无 Retry-After、限流内存级、CORS 全开** ｜ 全局
实测 429 只有 `{error}` 文案。建议：429 附 `Retry-After` 头（滑动窗口已有现成时间戳）；限流 Map 多进程部署即失效（单进程 SQLite 现状下可接受，文档标注）；`cors()` 全开放对小程序无感，但对第三方 Web 集成等于无防护，若 API 将对外开放需加白名单机制。

**[API-13] 403 承载五种语义，需在文档中显式枚举** ｜ 全局
现状：403 同时表示"身份无权限（非组局者/非管理员）"、"账号封禁"、"拉黑关系拦截"、"性别限制不符"、"搭力值不足"（后者更接近配额/支付语义）。前端只弹文案没问题，但第三方无法按类别处理（例如拉黑 403 应静默、搭力值 403 应引导做任务）。建议：body 增加 `{"error":"...","code":"BLOCKED|GENDER_RESTRICTED|CREDIT_TOO_LOW|FORBIDDEN"}` 机器码字段，纯增量。

**[API-14] 演示契约混入生产契约** ｜ `POST /auth/sms/send`、`POST /safety/sos`
`sms/send` 响应直返 `demo_code`（实测 `{"sent":true,"demo_code":"573478"}`），代码注释已注明接入短信 SDK 后移除——这本身是一次契约变更却无版本标记；`sos` 演示环境自动落举报+通知管理员，无人工审核位。建议：在 api.md 标注"演示环境专属字段"（本次已标注），SDK 接入时按 [API-11] 的 v1 策略发布。

---

## 契约健康项（实测确认，保持住）

1. **成功包络 100% 一致**：56 个 HTTP 端点全部 `{ok:true, data}`（实测抽样 20+ 端点逐一验证）。
2. **错误包络一致**（1 个例外即 API-2）：全部 `{error:"中文文案"}`，文案可直接展示给用户，multer 上传错误也被全局 handler 归一为 400 JSON。
3. **命名无 camelCase 混用**：任务假设的 `lastMsgAt/readAt` 混用不存在——HTTP 与 WS 帧全站 snake_case（`conv_id`、`last_msg_at`、`read_at`），前端 web/public/js 直接消费 snake 字段，无转换层负担。唯一"命名"问题是 API-8 的 SQL 别名泄漏与 API-4 的一词两义。
4. **时间戳统一** epoch 毫秒整数（`created_at`/`read_at`/`last_msg_at`/`resolved_at`），无 ISO 字符串混排。
5. **鉴权单一机制**：全站 Bearer JWT，401 文案区分"请先登录/账号已注销"；管理端独立 `requireAdmin` 中间件统一 403。
6. **幂等设计有亮点**：发布 60s 窗口去重、`POST /chat/conv` get-or-create、`notifications/read` 可重复、block `INSERT OR IGNORE`、sms 验证码一次性消费且失败不烧码。
7. **边界输入安全**：实测 `/posts/abc`（NaN id）→ 404 JSON；`?page=0&size=999` → 钳制为 page=1/size=50，无越界。
8. **WS 契约清晰**：auth_ok/auth_fail、chat/chat_error、ping/pong、peer_read 帧结构 snake_case 与 HTTP 一致，4001（勿重连）/4003（策略拒绝）关闭码语义明确。

## 建议落地顺序

1. [API-2] catch-all JSON 404（10 行，立即可做）→ 2. [API-1][API-7] 列表形状+分页归一（一个版本双字段过渡）→ 3. [API-4][API-5] approve/ban/like 语义拆分（管理端先行）→ 4. [API-3] 状态码归一 → 5. [API-11] /v1 前缀 → 6. 其余文档化项随 api.md 迭代。
