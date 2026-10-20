# R4 运营批评：平台运营工具缺口审计（2026-10）

视角：如果明天接手搭搭的平台运营，我缺什么工具。方法：通读 server/src/routes/admin.js、web/public/js/pages/admin.js 及全部路由/定时任务代码，并对 localhost:3000 后台实测（admin 登录、处置流、发帖频控、404 探测）。已知规划不重复立项：算法备案/群聊/高校认证/城市运营位（roadmap v2.x）、发布幂等生产化（v2.6）、灰产识别（v1.2）、联系方式占位（R3 法务 L4）。

**结论：9 项缺口。P1 上线即需要 5 项，P2 规模化才需要 4 项。**

## R4运营批评：9项（P1上线即需要/P2规模化才需要）

### P1 — 上线即需要（运营第一天就要用，没有就得人肉顶）

[O1] **处置梯度缺失：无"仅下架不罚人"、无"禁言N天"，下架=自动记违规**
- 现状证据：admin.js:91 处置动作仅 `warn | ban | dismiss` 三档；实测：admin 对举报帖执行 ban → 帖子 `closed` 的**同时**作者 `warnings` 0→1（admin.js:100-103 下架与 warnUser 硬编码耦合），累计 3 次自动永久封号（util.js warnUser）。全站无禁言概念（users.status 只有 active/banned/deleted）；后台无"查看/撤销警告记录"入口（admin.js FE 用户 tab 仅封禁/解封按钮，warnings 只读展示）。
- 运营损失场景：用户发了标题党/重复灌水/负能量但无暗语的帖——运营只有两个选择：不处理（社区体验恶化）或下架并记 1/3 违规（一个轻违规走三步就把人送进永久封号）。过度封号直接转化为申诉、投诉与"封号过重"的舆情；误判警告无入口撤销。协议写了"警告、封禁、下架"处置体系（legal.js:70），产品只给了最重的一档。
- 实现要点：server/src/routes/admin.js——resolve 增加 `takedown`（帖 closed 但不 warnUser）与 `mute`（写 `users.muted_until` 时间戳，禁止发帖/评论/申请/聊天，登录与浏览不受限）；处置时支持必填/选填"处置备注"供申诉复核；POST /admin/users/:id/warnings 清除警告。db.js 加迁移列；posts.js（发布/评论/join 入口）与 chat.js 校验 muted_until；web/public/js/pages/admin.js 按钮组从 3 个改 5 个 + 用户 tab 加"违规记录"展开。
- 成本：中（1-2 天，核心是处置语义拆分 + muted_until 全入口校验）

[O2] **封禁申诉流程缺失：协议承诺申诉，产品零实现**
- 现状证据：登录被拒提示"账号已被封禁，如有疑问请申诉"（auth.js:185）；用户协议"被封禁的账号可通过联系方式申诉，每人限申诉一次，我们将重新核实并书面答复"（legal.js:120）——唯一渠道是占位邮箱（R3 L4 已记，此处不重复立项邮箱本身）。实测 `GET /appeals` 404；代码无任何申诉表/端点/后台队列；封禁本可逆（admin 解封按钮存在）但无复核流程承接。
- 运营损失场景：用户被误封（O1 的 3 次自动封号放大概率）→ 找不到申诉入口 → 应用商店差评/黑猫投诉/监管转办，运营在无工单系统的情况下完全被动；封禁处理无留痕复核，也过不了"属地网信安全评估"对处置申诉机制的材料要求。
- 实现要点：db.js 新增 appeals 表（user_id/report_id 可空/stmt 状态 pending/accepted/rejected/replied_at，一账号一次约束）；server/src/routes/ 新增（或并入 admin.js）`POST /appeals`（banned 用户凭密码登录态或手机号验证提交）+ `GET /admin/appeals` 队列 + `POST /admin/appeals/:id/resolve`（接受→自动解封+返还通知）；auth.js:185 提示语改为带申诉入口指引；web/public/js/pages/me.js 加"我的申诉"、admin.js 加申诉 tab。
- 成本：中（1-2 天）

[O3] **用户触达通道缺失：无公告系统，运营对全员零触达**
- 现状证据：实测 `GET /announcements`、`GET /admin/announcements` 均 404；notifications 表是逐用户行，`notify()` 只能点对点（util.js:190）；代码无 banner 位/弹窗/kv 公告读取逻辑。运营想说任何一句话（规则变更、新城市开通、封禁公示、活动）都只能逐个用户手写 notify。
- 运营损失场景：新城市开通当天无法告知该城用户"你们的城市已上线"；敏感词库更新后无法公告"新规已生效"；出现公共安全事件时无紧急全站通报能力——这最后一条在 UGC 线下约见场景是监管与安全双重要求。push 渠道（roadmap v1.1 Web Push）未就绪前，站内公告 banner 是唯一兜底，当前连兜底都没有。
- 实现要点：轻量方案直接用现成 kv 表（`announcement:global` / `announcement:city:北京` JSON：文案/跳转/生效区间）；server/src/routes/misc.js 加 `GET /announcements`（按用户城市返回 global+city 两条）、admin.js 加 `POST/DELETE /admin/announcements`；web/public/js/app.js 启动时拉取并在首页顶部渲染可关闭 banner（localStorage 记已读）；discover.js/square.js 顶部留渲染位。
- 成本：小（半天-1 天，kv 方案无需新表迁移）

[O4] **数据看板只有累计值：无趋势/分布/时效，无导出**
- 现状证据：实测 `/admin/stats` 返回 10 个累计数（用户/帖/消息/待处理举报等），FE 文案自述"演示版数据看板 · 正式版可接入趋势图与漏斗"（admin.js:64）；`/admin/funnel` 是 90 天窗口累计漏斗 + 日活近似（events 有 90 天 TTL），无每日新帖序列。实测缺且 `GET /admin/export*` 404：每日新帖数、分类分布、城市分布、举报响应时长分布全部缺失——其中响应时长数据已就绪（reports.resolved_at/created_at，R3-C7 落地）只是没人算。
- 运营损失场景：运营周报只能肉眼抄 10 个总数，回答不了"这周北京发帖量涨了吗""哪个分类供给不足""举报平均多久处理完"——最后一个直接对应安全评估材料的"处置时效"指标；无 CSV 导出则连抄进 Excel 都要手敲。
- 实现要点：server/src/routes/admin.js——/stats 扩展：`SELECT date(created_at/1000,'unixepoch') d, COUNT(*) FROM posts GROUP BY d` 式按日序列、GROUP BY category / city 分布、举报响应时长（AVG/P50/P90 = resolved_at-created_at）、过期/封禁帖数；新增 `GET /admin/export?table=posts|users|reports` 输出 CSV（Content-Disposition attachment）；web/public/js/pages/admin.js 看板 tab 加简易柱状卡（纯 CSS 条形即可，不引图表库）+ 导出按钮。
- 成本：中（1-2 天）

[O5] **意见反馈通道缺失：用户反馈 bug 只能"举报"或拉响 SOS**
- 现状证据：实测 `GET /feedback` 404；全站唯一用户→平台入口是举报（6 个固定理由：骚扰/欺诈/虚假信息/言语辱骂/人身安全/其他，users.js:216）与 SOS（safety.js，直接进举报队列标"人身安全"并全员管理员通知）。me 页只有"我的举报记录"（misc.js:363），无"意见反馈"；隐私政策却承诺"收到你的反馈后 15 个工作日内答复"（legal.js:105）。
- 运营损失场景：用户发现 bug / 产品建议 → 只能选"其他"举报某人（语义错误，还触发对方 -20 搭力值等待核实）或按 SOS（把产品问题混进人身安全紧急队列，稀释真实警情响应）→ 运营既收不到产品反馈，又污染了 SOS 严肃性；发布阻塞类 bug 无反馈出口时用户直接流失且无感知。
- 实现要点：db.js 新增 feedback 表（user_id/content/contact 可空/status/created_at）；server/src/routes/misc.js 加 `POST /feedback`（requireAuth，200 字上限，敏感词过滤复用 filterContent）+ admin.js `GET /admin/feedback` 列表/标记已处理；web/public/js/pages/me.js 设置区加"意见反馈"入口（简单 textarea sheet），admin.js 加反馈 tab（可与申诉 tab 合并为"工单"）。
- 成本：小（半天-1 天）

### P2 — 规模化才需要（用户量/城市数上来前补齐）

[O6] **发帖/互动零频控：新号实测 2 秒连发 4 帖**
- 现状证据：实测：新注册账号连续 POST /api/posts 4 个不同标题帖全部成功（post 26/27/28/29，间隔约 0.5s）；60 秒幂等窗口仅拦截"同标题+同内容"（posts.js:165-169），改 1 个字即绕过（实测改"！"后新帖落库）。防线仅剩搭力值 ≥300 门槛（新号默认 600+，形同虚设）。评论（posts.js:281）、申请加入、通用举报入口（users.js:245，无 24h 去重——仅用户举报路径有）同样无频控。roadmap v2.6 已列"发布幂等生产化"，但那是防重复提交（多 tab/重试），不是防灌水频控，属两件事。
- 运营损失场景：引流号一天刷 200 帖打爆广场 feed 与推荐候选池（/for-you 候选池 200 条会全被刷屏）；脚本批量注册（用户名注册模式无验证码，roadmap v1.2 灰产识别未落地）+ 零频控 = 广场一夜变贴片墙，届时只能人工逐帖举报处理（而 admin 连帖子列表都没有，见 O7）。
- 实现要点：server/src/util.js 加通用滑动窗口计数助手（内存 Map，参照 auth.js smsIpLog 模式）；posts.js 发布前校验"该用户当日 ≤5 帖 + 两次发布间隔 ≥10 分钟"，评论 ≤30/日、join ≤20/日；通用举报入口补 24h 同 target 去重（与用户举报路径对齐）；429 文案友好化。
- 成本：小（半天-1 天）

[O7] **admin 无帖子管理与官方发帖工具：空城无运营位**
- 现状证据：实测 `GET /admin/posts` 404——admin 看不到全量帖子列表，不能直接下架/恢复/置顶，唯一处置路径是等用户举报后走举报队列（O1）。官方示范局：admin 账号就是普通用户（seed.js:11，credit 600+），可直接走发布接口发帖（posts.js 仅校验 credit，无 is_admin 特判），但 posts 表无 is_official/is_pinned 字段——官方帖与用户帖视觉无区分、无置顶能力。城市冷启动：空城有兜底文案（square.js:144"这里还没有搭局"、discover.js:141"这座城市还没有搭局，发一个试试"）算及格；但城市选择器只从已有帖聚合（misc.js /cities `WHERE posts 存在 GROUP BY`）+ 发现页城市 chip 硬编码 6 城（discover.js:20），0 帖城市在浏览 UI 中不可见，也无"城市需求登记/开通投票"，运营无法知道"哪个城市有用户没供给"。
- 运营损失场景：接手新城市：先手动 SQL 查"注册用户多但 0 帖"的城市，再用 admin 号发示范局（无官方标识，用户不知道是平台发的），帖子无法置顶（热度排序会很快沉底），空城用户看到的永远是"还没有搭局"——冷启动全靠 DBA 式人肉操作。
- 实现要点：db.js posts 表加 `is_official`、`is_pinned`、`pinned_until` 迁移列；server/src/routes/admin.js 加 `GET /admin/posts`（按状态/城市/分类筛选 + 分页）、`POST /admin/posts/:id/status`（下架/恢复/置顶，官方操作不 warnUser）、`GET /admin/city-gaps`（有活跃用户 0 开放帖的城市清单）；misc.js /cities 与 CITY_CHIPS 取并集并返回 0 帖城市标记（FE 显示"即将开通"）；admin.js FE 加"帖子"tab（第 4 个 seg），square.js/discover.js 渲染置顶位与官方标识角标。
- 成本：中（2-3 天）

[O8] **举报队列无分级/无时效/无历史视图**
- 现状证据：SOS"人身安全"与普通"其他"举报混在同一 pending 队列按 id 倒序（admin.js:59-62），无置顶/分级/批量操作，LIMIT 200 无分页；后端支持 `status=resolved` 查询（admin.js:58）但 FE 只请求 pending（admin.js:68）——已处理记录在后台不可回查，处置无复核依据；响应时长字段已落库（O4）但队列无任何时效展示（如"已等待 26 小时"标红）。
- 运营损失场景：一条人身安全 SOS 淹没在灌水举报下第 15 条（接手运营按顺序处理就是第 15 个才看到）；处理过的举报无法回看"当时为什么封他"，申诉来了（O2）无据可查；安全评估要求举报处置"及时"却拿不出时效证据。
- 实现要点：admin.js BE：/reports 排序改 `CASE WHEN reason='人身安全' THEN 0 ELSE 1 END, id DESC`，响应体加 `age_hours`；FE：队列项显示等待时长（>24h 标红）、顶部加"已处理"切换 seg（调已有 resolved 接口）、人身安全置顶样式。批量操作可后置。
- 成本：小（半天，纯排序+一个 tab）

[O9] **过期帖只过期不治理：统计口径失真，无批量工具**
- 现状证据：jobs.js 每 10 分钟扫 open 帖超 **14 天**（EXPIRE_DAYS=14，非 30）置 expired 并通知作者（jobs.js:15-24）——自动化这一步是好的；但 expired 帖永久留库，admin stats"搭局总数"把 expired/closed 全算进去（admin.js:23），看板无法区分"活跃供给"与"历史存量"；后台无 expired 帖列表与批量清理/归档入口；过期通知说"可重新发布"但用户需手动重建全部字段，无一键重发。
- 运营损失场景：半年后"搭局总数 10 万"里 8 万是过期僵尸帖，运营据此误判供给规模；城市分布统计被僵尸帖城市污染（O4 落地时口径先错）；user 主页 post_count 已排除 closed 但 expired 计入，口径互相打架。
- 实现要点：server/src/routes/admin.js /stats 拆 `posts_total / posts_open / posts_expired`；O7 的 /admin/posts 支持 `?status=expired` 批量删除（`POST /admin/posts/batch` 传 ids）；过期 90 天后的 expired 帖可在 jobs.js 加每日归档清理（可先只做口径拆分，物理清理后置）；posts.js 过期通知 data 里带原帖字段便于前端"一键重发"预填。
- 成本：小（口径半天；一键重发 +1 天）

## 已有工具盘点（接手运营第一天你能用的）

**看板**
- `/admin/stats`：10 个累计指标（总用户/7日新增/周活跃/帖子总数/招募中/已完成/成搭对数/消息数/待处理举报/封禁用户）
- `/admin/funnel?days=N`：六级成搭漏斗（register→post_view→publish→join→approve→done→rate，events 90 天窗口）+ 按日去重日活近似

**举报与处置**
- 举报队列：pending/resolved 查询、目标摘要（用户状态/帖标题/消息前 40 字）、处理留痕（resolved_at + resolve_action，举报人可经 /api/reports/mine 自查进度）
- 三档处置：警告（3 次自动封号）/ 封禁·下架（帖 closed+警告作者、评论删除、消息打码）/ 驳回（举报不实返还 20 搭力值）；处置后自动通知举报人结果
- 用户管理：昵称/用户名关键词搜索、封禁/解封切换（不可封 admin）
- SOS：一键应急直入举报队列（reason=人身安全）+ 通知全体管理员

**自动化（jobs.js，每 10 分钟一轮，全 try-catch 不 crash）**
- open 帖 14 天未成行自动过期 + 通知作者；done 超 72h 未互评提醒一轮（events 防重）；老搭子新帖同城推送（每日每人 ≤2 条）；events 埋点 90 天 TTL 清理

**内建防线（无需运营操作的）**
- 敏感词过滤（导流/涉黄暗语/诈骗话术 40+ 词，发布/编辑/评论/申请/评价全拦截）
- 发布 60 秒幂等（同标题+同内容）；用户举报 24h 同 target 去重 + 被举报人当日仅扣一次 20 分
- WS 三层限流（总连接 2000 / 单用户 5 连接 / 每连接 5 帧每秒）+ 30s 心跳探活；短信/登录接口 IP 滑窗限流
- 搭力值 <300 禁发布；拉黑双向过滤 feed/评论/互动；被拉黑者通知不投递

**已验证不存在（404 实测）**：/admin/posts、/admin/export*、/admin/announcements、/appeals、/feedback、/admin/users/:id/mute、/admin/city-stats

---
*实测环境：localhost:3000（seed 数据），审计过程产生的测试帖/临时账号/测试举报已全部清理还原。*
