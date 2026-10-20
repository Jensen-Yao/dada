# 搭搭 API 接口文档（v1 逆向版）

> 本文由代码逆向生成（R5 API 契约审计交付物），基线为 `server/src/routes/` 当前实现，未经实现方确认。
> 所有请求/响应示例均为 localhost:3000 实测真实输出。配合 `docs/review-api-r5.md`（契约不一致清单）阅读。

## 0. 通用约定

| 项 | 约定 |
|---|---|
| Base URL | `http://<host>:3000/api`（**无版本段**，见 review-api-r5 [API-11]） |
| 传输格式 | `application/json`（上传接口除外：`multipart/form-data`） |
| 时间戳 | 统一 epoch 毫秒整数（`created_at` / `read_at` / `last_msg_at` …） |
| 字段命名 | 统一 snake_case（HTTP 与 WebSocket 均是，无 camelCase） |
| 成功包络 | `{"ok": true, "data": <业务数据>}`（全站一致） |
| 错误包络 | `{"error": "<中文文案>"}`，配对应 HTTP 状态码（全站一致；**例外：未匹配的 /api 路径返回 Express 默认 HTML 404**，见 [API-2]） |
| 鉴权 | `Authorization: Bearer <JWT>`，JWT 有效期 30 天；无刷新机制，过期重新登录 |
| 游客可见 | 标注 `optionalAuth` 的端点无 token 可访问，带 token 返回个性化字段（`liked` / `my_join` / `blocked_by_me`） |
| 限流 | 内存级，超限 `429 {"error": "..."}`，**无 Retry-After 头**：短信 10 次/IP/小时、单手机号 60s 一条；登录 20 次/IP/15 分钟 |
| CORS | `Access-Control-Allow-Origin: *`（全开放） |

错误码语义速查：

| 码 | 语义 | 现状说明 |
|---|---|---|
| 400 | 参数校验错误 **及** 状态机冲突（"已申请过""已处理""已完成"等） | 冲突类与 409 混用，见 [API-3] |
| 401 | 未登录 / token 失效 / 账号已注销（文案区分："请先登录" / "账号已注销"） | |
| 403 | 无权限（非组局者/非管理员/非会话成员）、账号封禁、拉黑关系、性别限制、搭力值不足 | |
| 404 | 资源不存在（JSON）；**未匹配路径 → HTML** | 见 [API-2] |
| 409 | 重复冲突：手机号/用户名已注册、24h 内重复举报 | 仅 4 处，见 [API-3] |
| 429 | 触发限流 | |
| 500 | 服务器兜底 `{"error":"服务器开小差了，请稍后再试"}` | |

---

## 1. 认证 `/api/auth`

### POST /auth/sms/send — 发送短信验证码（公开）
| 请求体 | 说明 |
|---|---|
| `phone` | 必填，中国大陆手机号 `1[3-9]\d{9}` |
| `scene` | 可选，`register`（默认）/ `reset`；`reset` 时手机号必须已注册（否则 404） |

成功 `200`：`{"ok":true,"data":{"sent":true,"demo_code":"573478"}}`
> ⚠️ `demo_code` 为演示环境直返验证码，接入真实短信 SDK 后此字段将移除（契约变更点）。

错误：`400` 手机号格式不正确 ｜ `404` 该手机号未注册（仅 scene=reset）｜ `409` 该手机号已注册（默认 scene）｜ `429` 发送过于频繁（60s 单号 / 10 次每 IP 每小时）

### POST /auth/register — 注册（公开，双模式）
手机号模式（合规主流程）：

```json
{ "phone": "13800001234", "code": "573478", "password": "******",
  "nickname": "昵称(1-20字)", "gender": "male|female|secret", "city": "北京",
  "adult_confirmed": true }
```

用户名模式（存量测试兼容，`DADA_USERNAME_REG=0` 时关闭返回 403）：

```json
{ "username": "abc_123", "password": "******", "nickname": "昵称",
  "gender": "male|female|secret", "birth_year": 1998, "city": "北京" }
```

成功 `200`：`{"ok":true,"data":{"token":"<JWT>","user":{...publicUser}}}`（user 结构见 §8.1）
错误：`400` 验证码错误或已过期 / 需确认已满18岁 / 密码至少 6 位 / 昵称需为 1-20 个字符 / 昵称包含违规信息 / 用户名格式 ｜ `403` 注册已改为手机号方式 ｜ `409` 该手机号已注册 / 用户名已被注册

### POST /auth/login — 登录（公开）
`{"username":"abc"} 或 {"phone":"138..."}` + `password`。二选一，传 `phone` 走手机号。

成功 `200`：同注册 `{"token","user"}`。
错误：`401` 用户名或密码错误 / 手机号或密码错误 / 账号已注销 ｜ `403` 账号已被封禁，如有疑问请申诉 ｜ `429` 尝试过于频繁

### POST /auth/password/reset — 验证码重置密码（公开）
`{"phone","code","password"}`（验证码须 scene=reset 下发；成功才消费，失败不烧码）
成功 `200`：`{"ok":true,"data":{"reset":true}}`
错误：`400` 格式/验证码/密码长度 ｜ `404` 该手机号未注册

### GET /auth/me — 我的完整信息（登录）
成功 `200`：`publicUser` 附加字段：

```json
{"ok":true,"data":{ "...publicUser": {},
  "post_count": 3, "joined_count": 1, "unread_notif": 2, "unread_chat": 5, "warnings": 0 }}
```

---

## 2. 用户 `/api/users`

### GET /users/:id — 他人主页（optionalAuth）
成功 `200`：`publicUser` 附加：

```json
{ "post_count": 3, "rating_avg": 4.8, "rating_count": 6,
  "rating_tags": ["守时","靠谱"],
  "recent_done": [{ "id":1, "title":"...", "category":"food", "meet_time":"..." }],
  "open_posts":  [{ "id":2, "title":"...", "category":"food", "city":"北京", "meet_time":"...", "cover":"...", "aspect":"3:4" }],
  "blocked_by_me": false }
```

错误：`404` 用户不存在（含 banned 用户，对外隐藏）

### PUT /users/me — 编辑资料（登录）
可更新字段：`nickname, gender(male|female|secret), birth_year, city, district, school, occupation, mbti, bio(≤200), rec_off(0|1), tags[](≤10个、单个≤12字)`。昵称/简介/学校/职业过敏感词，命中 `400`。
成功 `200`：`{"ok":true,"data":{...publicUser}}`　错误：`400` 各字段校验文案

### POST /users/me/delete — 注销账号（登录）⚠️ 动作型 POST，非 DELETE 方法
`{"confirm":"DELETE"}`（字符串二次确认）
成功 `200`：`{"ok":true,"data":{"deleted":true}}`　错误：`400` 请输入 DELETE 以确认注销
> 注销后 token 立即失效（后续请求 401 `账号已注销`）。

### POST /users/me/avatar — 头像上传（登录，multipart）
form-data 字段名 `avatar`，支持 png/jpeg/webp/gif，≤5MB。
成功 `200`：`{"ok":true,"data":{"avatar":"/uploads/avatar_..._xxx.png"}}`　错误：`400` 请选择图片 / 仅支持图片文件 / 上传失败：文件过大

### POST /users/me/verify — 认证（登录，演示环境自动通过）
`{"type":"student","school":"XX大学"}` 或 `{"type":"real"}`。学生认证 +30 搭力值、真人认证 +50。
成功 `200`：`{"ok":true,"data":{...publicUser}}`　错误：`400` 认证类型不合法 / 请填写学校名称 / 已通过学生认证 / 已通过真人认证 / 学校名称包含违规信息

### GET /users/me/ratings — 我收到的评价（登录）
成功 `200`：**裸数组**（≤50 条，无分页元信息）

```json
{"ok":true,"data":[{ "id":1, "stars":5, "tags":["守时"], "comment":"...",
  "created_at":1792518000000, "rater":{"id":2,"nickname":"...","avatar":"..."},
  "post_title":"..." }]}
```

### GET /users/me/partners — 我的搭友（登录）
成功 `200`：`{"ok":true,"data":{"list":[{ "partner":{...publicUser}, "times":2, "last_post_id":5, "done_count":1 }]}}`
> `{list}` 包络但无 `total/page/has_more`；已注销/封禁搭友不出现在 list。

### GET /users/me/blocks — 我的拉黑列表（登录）
成功 `200`：**裸数组** `[{ "id":2, "nickname":"...", "avatar":"..." }]`

### POST /users/:id/block — 拉黑（登录）
成功 `200`：`{"ok":true,"data":{"blocked":true}}`（幂等，重复拉黑不报错）
错误：`400` 不能拉黑自己 ｜ `404` 用户不存在

### DELETE /users/:id/block — 取消拉黑（登录）
成功 `200`：`{"ok":true,"data":{"blocked":false}}`
> 与 like（单端点 toggle）、admin ban（单端点 toggle）是三种并存的切换习语，见 [API-5]。

### POST /users/:id/report — 举报用户（登录）
`{"reason":"骚扰|欺诈|虚假信息|言语辱骂|人身安全|其他", "detail":"≤500字"}`
成功 `200`：`{"ok":true,"data":{"reported":true}}`（演示环境自动处理，今日首次被举报扣 20 搭力值）
错误：`400` 请选择举报理由 ｜ `404` 用户不存在 ｜ `409` 已举报，请等待处理（24h 一次）

---

## 3. 搭局 `/api/posts`

### 3.1 postView 帖子视图（多处复用）

```json
{ "id":28, "author":{...publicUser}, "category":"food",
  "category_name":"美食干饭", "category_icon":"utensils",
  "title":"...", "content":"...", "city":"北京", "location_name":"...",
  "meet_time":"周六 12:00", "need_count":4, "fee_mode":"aa", "fee_mode_name":"费用AA",
  "gender_req":"any", "gender_req_name":"不限", "requirements":"...",
  "images":[], "cover":"/img/photos/food-1.jpg", "aspect":"3:4",
  "status":"open|full|closed|done|expired",
  "approved_count":1, "likes_count":2, "comments_count":1, "views_count":10,
  "created_at":1792518000000, "liked":false, "my_join":"pending|null|approved|...",
  "is_author":false, "blocked_by_me":false }
```

### GET /posts — 广场列表（optionalAuth）★ 唯一全分页端点
Query：`page`(≥1，默认1)、`size`(1-50，默认20，超限钳制)、`city`、`category`(key)、`keyword`(标题/内容 LIKE)、`gender_req`(any|female|male)、`sort`(缺省最新 / `hot`)

```json
{"ok":true,"data":{"list":[postView...], "total":25, "page":1, "size":20, "has_more":true}}
```

### POST /posts — 发布搭局（登录）
`{ "category":"food(必填,合法key)", "title":"1-40字", "content":"≤1000字",
  "city":"必填", "location_name":"≤50字", "meet_time":"≤30字", "need_count":1-20,
  "fee_mode":"free|aa|treat(默认aa)", "gender_req":"any|female|male", "requirements":"..." }`
前置：搭力值 ≥300，否则 `403`。
成功 `200`：`{"ok":true,"data":{...postView}}`
幂等：同用户 60s 内同标题+同内容重复提交 → `200` 返回已有帖（不新建）。
错误：`400` 各字段校验 / 内容包含违规信息 ｜ `403` 搭力值不足（文案含当前分数与门槛）

### GET /posts/:id — 帖子详情（optionalAuth）
成功 `200`：`{"ok":true,"data":{...postView}}`
> ⚠️ GET 副作用：每次调用 `views_count +1`（见 [API-9]）。
错误：`404` 搭局不存在（含非数字 id，实测 `/posts/abc` → 404 JSON）

### PUT /posts/:id — 编辑 / 状态流转（登录，仅组局者）
可更新：`title, content, location_name, meet_time, requirements, need_count(1-20，不可低于已通过人数), status(open|closed|done)`
- `status=done`：触发完成流程（成员各 +20 搭力值、剩余 pending 自动婉拒）；done 后再改状态 `400` 该搭局已完成（幂等护栏）
- 满员帖扩容：`need_count` 增加时 full→open 自动回流，rejected 申请批量恢复 pending 并通知
- `status=closed`：停止招募

成功 `200`：`{"ok":true,"data":{...postView}}`
错误：`404` 搭局不存在 ｜ `403` 只能编辑自己发布的搭局 ｜ `400` 状态不合法 / 人数上限不能低于该数 / 该搭局已完成 / 内容包含违规信息

### POST /posts/:id/images — 追加配图（登录，multipart，仅组局者）
form-data 字段名 `images`（可多张，单次≤3），单张 ≤8MB，帖内累计 ≤6 张。
成功 `200`：`{"ok":true,"data":{"images":["/uploads/post_..._xxx.png", "..." ]}}`（合并后的全量图列表）
错误：`404` 搭局不存在 ｜ `403` 只能给自己的搭局传图 ｜ `400` 请选择图片 / 仅支持图片文件

### POST /posts/:id/like — 点赞 / 取消点赞（登录，单端点 toggle ⚠️）
成功 `200`：`{"ok":true,"data":{"liked":true}}` 或 `{"liked":false}`
> 网络重试会翻转状态（点赞被撤销），见 [API-5]。
错误：`404` 搭局不存在 ｜ `403` 无法与该用户互动（拉黑）

### GET /posts/:id/comments — 评论列表（optionalAuth）
成功 `200`：**裸数组**（按 id 升序，≤200 条，无分页）

```json
{"ok":true,"data":[{ "id":1, "content":"...", "created_at":...,
  "user":{"id":2,"nickname":"...","avatar":"...","gender":"female"} }]}
```

### POST /posts/:id/comments — 发表评论（登录）
`{"content":"1-300字"}`　成功 `200`：`{"ok":true,"data":{"commented":true}}`
错误：`404` 搭局不存在 ｜ `403` 无法与该用户互动 ｜ `400` 评论不能为空 / 最多 300 字 / 包含违规信息

### POST /posts/:id/join — 申请加入（登录）
`{"message":"≤200字(可选)"}`。rejected/quit 后可重新申请（重新置 pending）。
成功 `200`：`{"ok":true,"data":{"joined":true,"status":"pending"}}`
错误：`404` 搭局不存在 ｜ `403` 无法与该用户互动 / 该搭局仅限女生(男生)参加 ｜ `400` 该搭局已停止招募 / 不能加入自己发布的搭局 / 已申请过该搭局

### GET /posts/:id/joins — 申请人列表（登录，仅组局者）
成功 `200`：**裸数组**（无 LIMIT，全量）

```json
{"ok":true,"data":[{ "id":3, "message":"...", "status":"pending", "created_at":...,
  "user":{ "id":2, "nickname":"...", "avatar":"...", "gender":"female", "age":24,
           "city":"北京", "mbti":"ENFJ", "credit":650,
           "verify_student":true, "verify_real":true, "tags":["..."] } }]}
```

错误：`404` 搭局不存在 ｜ `403` 只有组局者可以查看申请列表

### POST /posts/:id/joins/:joinId/approve — 通过 / 拒绝申请（登录，仅组局者）⚠️ 双语义端点
`{"approve":true}` 通过 / `{"approve":false}` 拒绝。
成功 `200`：`{"ok":true,"data":{"approved":1}}`
> ⚠️ 此处 `approved` 是**已通过人数计数（number）**，不是布尔——与其他端点 `{liked}/{blocked}` 布尔语义冲突，见 [API-4]。通过后自动建会话；满员自动转 full 并婉拒剩余 pending。
错误：`404` 申请不存在 ｜ `403` 只有组局者可以操作 ｜ `400` 该搭局已过期或结束 / 该申请已处理 / 人数已满 / 该用户账号已注销或异常，其申请已自动拒绝

### POST /posts/:id/quit — 退出申请（登录，仅本人）
仅 pending/rejected 可退；approved 不可自行退出。
成功 `200`：`{"ok":true,"data":{"quit":true}}`
错误：`404` 搭局不存在 / 你没有申请过该搭局 ｜ `400` 已退出过该搭局 / 申请已通过，无法退出

### POST /posts/:id/rate — 搭后互评（登录）
`{ "ratee_id":2, "stars":1-5, "tags":["守时","靠谱"...官方标签≤6], "comment":"≤200字" }`
前置：帖子 `status=done`；双方为同局（组局者↔已通过成员，或两个已通过成员）；每人每局对每人仅一次。好评(≥4)被评者 +10 搭力值、差评(≤2) -15；双方互评完成 → 建立搭友关系。
成功 `200`：`{"ok":true,"data":{"rated":true}}`
错误：`404` 搭局不存在 ｜ `400` 被评价用户不存在 / 不能评价自己 / 评分需为 1-5 星 / 搭局需先标记为「已完成」才能互评 / 已经评价过对方了 / 评价包含违规信息 ｜ `403` 只能评价一起参加过该搭局的人

---

## 4. 我的搭局 `/api/my/posts`（挂载于 misc）

### GET /my/posts/published — 我发布的（登录）
成功 `200`：**裸数组**（postView，≤100 条，无分页）

### GET /my/posts/joined — 我参加的（登录）
成功 `200`：**裸数组**（postView + 覆盖 `my_join` 为 join 表状态，≤100 条，无分页）

---

## 5. 聊天 `/api/chat`（消息发送仅 WebSocket，见 §9）

### GET /chat/convs — 会话列表（登录）
成功 `200`：**裸数组**（按 last_msg_at 降序，≤100 条，无分页）

```json
{"ok":true,"data":[{ "id":5, "other":{"id":18,"nickname":"...","avatar":"...",
    "gender":"female","verify_real":true,"verify_student":true},
  "post_id":28, "last_message":{"type":"text","content":"...","created_at":...},
  "unread":0, "last_msg_at":1792518142383 }]}
```

### POST /chat/conv — 开启/获取会话（登录，get-or-create 幂等）
`{"user_id":18, "post_id":28(可选)}`
门槛：必须存在 approved 同局关系（组局者↔已通过成员，或同局两个已通过成员）。
成功 `200`：单个 conv 对象（同上列表项结构）
错误：`404` 用户不存在 ｜ `400` 不能和自己聊天 ｜ `403` 无法建立会话（存在拉黑关系）/ 申请通过后才能私信

### GET /chat/conv/:id/messages — 消息历史（登录，会话成员）⚠️ GET 副作用
成功 `200`：

```json
{"ok":true,"data":{
  "messages":[{ "id":10, "sender_id":17, "type":"text|safety", "content":"...",
                "created_at":..., "read_at":null }],
  "other":{"id":18,"nickname":"...","avatar":"...","gender":"female"},
  "context":{ "post_category":"travel", "post_title":"...",
              "my_tags":["..."], "other_tags":["..."] } | null }}
```

> ⚠️ 副作用：拉取即把对端发来消息标记已读，并向对端 WS 推 `peer_read`（已读回执）。≤500 条，无分页（更早消息当前无法获取）。
错误：`404` 会话不存在 ｜ `403` 无权访问该会话

### POST /chat/message/:id/report — 举报消息（登录，会话成员）
`{"reason":"≤20字(默认'骚扰')", "detail":"≤500字(默认消息原文)"}`
成功 `200`：`{"ok":true,"data":{"reported":true}}`
错误：`404` 消息不存在 ｜ `403` 无权举报该消息

---

## 6. 通知 / 推荐 / 反馈 / 举报 `/api`

### GET /notifications — 我的通知（登录）
成功 `200`：**裸数组**（≤100 条，无分页）。item 为通知表整行 + 解析后的 data：

```json
{ "id":9, "user_id":17, "type":"like|comment|join_request|join_result|join_quit|rating|
    post_done|credit|warning|report_result|feedback_result|sos",
  "title":"收到新点赞", "body":"...", "data":{"post_id":28}, "read":0,
  "created_at":1792518000000 }
```

### POST /notifications/read — 标记已读（登录，幂等）
`{"ids":[9,10]}`（指定条目）或不传 ids（全部已读）
成功 `200`：`{"ok":true,"data":{"read":true}}`

### GET /recommend — 推荐搭子（optionalAuth）
Query：`city`（传空串=全城；登录未传默认本人城市）
成功 `200`：`{"ok":true,"data":{"list":[...]}}`（≤20 条；item 含 `id,title,category,category_name,category_icon,city,meet_time,status,author{id,nickname,avatar,gender,credit},likes_count,liked,images,cover,aspect,reason`）
> `{list}` 包络但无 total/has_more。

### GET /for-you — 为你推荐（登录）
成功 `200`：

```json
{"ok":true,"data":{ "list":[{ "...推荐卡片": {},
    "match_score":82, "match_reasons":["老搭子·搭过2次","3个共同兴趣","同城·北京"],
    "partner_times":2, "tag_overlap":["徒步"] }],
  "cold_start":false, "my_tags":["..."], "my_city":"北京", "my_categories":["food"] }}
```

降级形态：冷启动 `{"list":[...20条无match_score...],"cold_start":true,...}`；关闭个性化（`rec_off=1`）`{"list":[],"rec_off":true}`。

### POST /feedback — 意见反馈（登录）
`{"content":"5-500字"}`　成功 `200`：`{"ok":true,"data":{"submitted":true}}`　错误：`400` 长度/违规词

### POST /reports — 通用举报（登录）
`{"target_type":"user|post|comment|message", "target_id":1, "reason":"≤20字", "detail":"≤500字"}`
成功 `200`：`{"ok":true,"data":{"reported":true}}`　错误：`400` 举报对象不合法
> 注意：与 POST /users/:id/report 不同，本端点无 24h 去重（不返回 409）。

### GET /reports/mine — 我的举报进度（登录）
成功 `200`：**裸数组**（≤50 条）。item 为白名单字段（R5 [API-8] 已修复，内部字段不再外泄）：

```json
{ "id":1, "target_type":"user", "target_id":17, "reason":"骚扰",
  "detail":"...", "status":"pending|resolved",
  "created_at":..., "resolved_at":1792519000000|null, "action_text":"已警告对方"|null }
```

---

## 7. 安全中心 `/api/safety`

### GET /safety/tips — 安全提示与社区公约（公开）
`{"ok":true,"data":{"emergency":[{icon,title,body}...6条], "community_rules":["..."]}}`

### POST /safety/sos — 一键应急上报（登录）
`{ "post_id":28(可选), "location":"文本位置(可选)", "note":"≤300字(可选)", "target_user_id":2(可选) }`
落一条高优先级举报并通知全体管理员。
成功 `200`：`{"ok":true,"data":{"reported":true,"message":"已收到你的求助，平台已通知风控人员。如遇紧急情况请务必先拨打 110。"}}`

### GET /safety/my-emergency-contacts — 紧急联系人引导（登录）
`{"ok":true,"data":{"hint":"请在手机上将 110 与信任亲友设为紧急联系人；..."}}`（演示环境固定文案）

---

## 8. 其他公开端点

### GET /meta — 元信息目录（公开，启动加载一次）
```json
{"ok":true,"data":{ "categories":[{key,name,icon}...14个],
  "fee_modes":[{"key":"free","name":"免费"},...],
  "gender_reqs":[{"key":"any","name":"不限"},...],
  "rate_tags":["守时","靠谱","友善","有趣","聊得来","再次约"] }}
```

### GET /cities — 城市列表（公开，按开放帖聚合）
`{"ok":true,"data":[{"city":"北京","count":13},...]}`
> R5 [API-8] 已修复：计数别名列名为 `count`，仅白名单两键。≤50 条。

### 8.1 publicUser 公开用户视图（注册/登录/me/主页/帖子 author 复用）

```json
{ "id":17, "username":"apir5a", "nickname":"...", "avatar":"/uploads/..."|null,
  "gender":"male|female|secret", "age":24|null, "city":"北京", "district":"朝阳区",
  "school":"", "occupation":"", "mbti":"", "bio":"", "tags":[],
  "verify_student":false, "verify_real":false, "credit":600,
  "post_count":0, "rating_avg":null, "rec_off":false }
```

---

## 9. WebSocket `ws://<host>:3000/ws`（聊天实时通道）

连接后第一条消息必须是 auth；消息体均为 JSON，字段 snake_case（与 HTTP 一致）。

| C→S | S→C | 说明 |
|---|---|---|
| `{"type":"auth","token":"<JWT>"}` | `{"type":"auth_ok","user_id":17}` | 成功；失败回 `{"type":"auth_fail"}` 并以 **close 4001** 关闭（客户端勿自动重连，需重新登录） |
| `{"type":"chat","conv_id":5,"content":"≤2000字"}` | `{"type":"chat","message":{"id":10,"conv_id":5,"sender_id":17,"type":"text","content":"...","created_at":...}}` | 发送成功（双方各推一帧）；首条消息后追加一帧 `type:"safety"` 安全提示 |
| 同上（错误时） | `{"type":"chat_error","error":"会话不存在"}` | 错误文案：会话不存在 / 无权在该会话发送消息 / 消息不能为空 / 消息太长 / 无法发送消息（存在拉黑关系）/ 消息包含违规内容，已被拦截（硬词拒收） |
| `{"type":"ping"}` | `{"type":"pong"}` | 应用层心跳 |
| — | `{"type":"peer_read","conv_id":5}` | 对端拉取历史触发已读回执（服务端主动推） |

连接策略：总连接 ≤2000（超限 close 4003）、单用户 ≤5 连接（超限回 `auth_fail` + close 4001）、单连接 chat 帧 ≤5 帧/秒（超限 close 4003 "发送过快"）；服务端每 30s 协议级 ping，连续 2 次未 pong 判定死链 terminate。
> HTTP 侧**没有发送消息的端点**，发消息只能走 WS（[API-10]）。

---

## 10. 管理端 `/api/admin`（全部需登录 + `is_admin=1`，否则 403 需要管理员权限）

### GET /admin/stats — 数据看板
```json
{"ok":true,"data":{ "users":13, "active_users":9, "banned_users":0, "posts":25,
  "open_posts":18, "done_posts":3, "joins":6, "messages":10,
  "pending_reports":0, "new_users_7d":5 }}
```

### GET /admin/funnel?days=30 — 成搭漏斗（days 1-90）
`{"ok":true,"data":{"days":30, "funnel":[{"type":"register","count":13},...固定7级], "daily_active":[{"date":"2026-10-12","count":5},...]}}`

### GET /admin/reports?status=pending|resolved — 举报队列
**裸数组** ≤200：举报表整行 + `reporter_nickname` + `target_summary`（目标摘要，已删除目标为"已删除"）

### POST /admin/reports/:id/resolve — 处理举报
`{"action":"warn|ban|dismiss"}`（ban：user→封禁、post→下架closed、comment→删除、message→撤回文案；dismiss 且 user → 返还 20 搭力值）
成功 `200`：`{"ok":true,"data":{"resolved":true,"action":"dismiss"}}`
错误：`404` 举报不存在 ｜ `400` 该举报已处理 / 处理动作不合法

### GET /admin/feedback?status=open|resolved — 反馈队列
**裸数组** ≤200：反馈表整行 + `user_nickname` + `user_status`（LEFT JOIN，可能为 null）

### POST /admin/feedback/:id/resolve — 处理反馈
`{"action_text":"处理说明(必填≤200字)"}` → 回告提交人通知。
成功 `200`：`{"ok":true,"data":{"resolved":true,"action_text":"..."}}`
错误：`404` 反馈不存在 ｜ `400` 该反馈已处理 / 请填写处理说明

### GET /admin/users?keyword= — 用户检索（昵称/用户名 LIKE）
**裸数组** ≤100，item 白名单字段：
`{id, username, nickname, gender, city, credit, warnings, status, is_admin, verify_student, verify_real, created_at}`

### POST /admin/users/:id/ban — 封禁/解封（单端点 toggle ⚠️）
成功 `200`：`{"ok":true,"data":{"banned":true}}`（封禁）/ `{"banned":false}`（解封）——网络重试会翻转状态，见 [API-5]。
错误：`404` 用户不存在 ｜ `400` 不能封禁管理员

---

## 11. 非 /api 资源

| 路径 | 说明 |
|---|---|
| `GET /uploads/*` | 用户上传静态文件（头像/配图） |
| `GET /img/*` | 内置静态资产（封面 SVG/实拍照片/头像），`Cache-Control: max-age=604800` |
| 其余 GET | SPA fallback → `index.html`（**不含 /api、/uploads**） |
| 未匹配的 `/api/*` | Express 默认 **HTML** 404（`Cannot GET /api/xxx`），非 JSON —— 第三方集成注意 [API-2] |

---

## 附：端点总数

HTTP 端点 **56** 个（公开 12 / 登录 36 / 管理端 8）+ WebSocket 通道 1 个。
列表型端点 17 个中：全分页元信息 1 个（GET /posts）、`{list}` 包络 3 个、裸数组 13 个 —— 详见 `docs/review-api-r5.md` [API-1]。
