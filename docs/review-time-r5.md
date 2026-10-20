# R5 时间语义批评（时区与时间数据专项）

审计基准：2026-10-21（周三，北京时间）。实测环境：`http://localhost:3000`（宿主机 CST/UTC+8），DB 实查 `server/data/dada.sqlite` 27 帖 / 24 条 open。核心结论先行：**这个产品约的就是"什么时候"，但"什么时候"在数据库里是一段不可计算的中文散文**——排序、过期、倒计时、日历、提醒全部因此做不了，且过期任务与真实活动时间完全脱钩（实测 24 条招募中帖子里 9-10 条的活动时间已经过了，还在照常收申请）。

## R5时间语义批评：5项（P1数据模型缺陷 2 / P2显示与部署一致性 3）

---

### [TS-1]（P1）meet_time 是自由文本，时间在数据层不可计算

**实测证据**
- DB 全量 meet_time 分布（24 条 open）：`本周六 11:30`、`每周六 07:00`、`每天 07:30`、`工作日 09:00-17:00`、`工作日 07:40`、`下周五 20:00`、`5月1日 15:00`（无年份！id14）、`周五 20:00`（id15，连"本周"都没有）。27 帖中 **0 条**是机器可解析格式。
- 服务端零校验：`server/src/routes/posts.js:177` 创建时仅 `String(meet_time || '').slice(0, 30)`；发布页 `web/public/js/pages/publish.js:63` 是纯 `<input maxlength="30" placeholder="如：本周六 11:30">`——产品文案（publish.js:25"写清楚时间…"）鼓励填时间，但系统对它无任何理解。
- 连长度校验都自相矛盾：创建截 30 字，编辑路由 `posts.js:199-207` 的字段循环对 meet_time 用 `slice(0, 1000)`——同一字段两条路径两种上限（location_name 同病：创建 50 / 编辑 1000）。
- 检索接口（posts.js:109-135）只有 city/category/keyword/gender_req，**没有任何时间维度**的筛选/排序参数；排序仅 `id DESC` 和 `hot`（likes+comments+views/50）。

**用户损失**
- 无法按"今天/本周末"筛局，无法按开始时间排序；"5月1日"和"本周五"在列表里视觉权重完全相同。
- 无法做日历导入（.ics）、开始前提醒——约局类产品的第二刚需直接缺失。
- "周五 20:00"（id15）读者无法判断是哪个周五；"5月1日 15:00"（id14）读者无法判断是哪一年。

**分阶段修复（不破坏现有数据的结构化方案）**
1. **加列**（沿 db.js 现有 try/catch ALTER 轻量迁移惯例）：
   ```sql
   ALTER TABLE posts ADD COLUMN meet_at INTEGER DEFAULT NULL;      -- epoch ms，UTC 存储
   ALTER TABLE posts ADD COLUMN meet_repeat TEXT DEFAULT 'once';   -- once|daily|weekly|weekdays
   ```
   `meet_time` 保留为人类可读显示文本（老帖/兜底路径不变）；`meet_at` 可空，**NULL 时一切行为与今天完全一致**。
2. **后端校验**（posts.js POST/PUT）：接受 `meet_at`（ISO 8601 或 epoch ms），统一转 UTC ms 落库；规则：可空；提供时必须在 now+5min ~ now+365d 之间；`meet_repeat != 'once'` 时免"未来"校验（长期帖）。同时修掉创建/编辑 slice 不一致（统一 meet_time ≤30 字）。
3. **发布页引导结构化**：时间字段升级为「快捷 chips（今晚/明天/本周末）+ `<input type=date>` + `<input type=time>` + 重复下拉（单次/每天/每周/工作日）」，date+time 组装为 meet_at（固定 Asia/Shanghai，见 TS-3）；自由文本输入框保留为"补充说明（选填）"，双向兼容。
4. **展示层**：`postView`/卡片有 meet_at 时前端格式化为"周六 11:30（3天后）"，无 meet_at 回退 meet_time 原文——老帖零影响。
5. **存量回填**（可选脚本）：对 seed 风格文本（`本/下周[一二..日] HH:mm`、`每周X`、`每天`、`工作日`）做正则解析回填 meet_at，失败留 NULL，不阻塞。

---

### [TS-2]（P1）过期语义与活动时间脱钩：活动过了还在收申请，长期局14天被误杀

**实测证据（2026-10-21 周三实查 DB + feed API）**
- 过期只看 `created_at + 14d`：`server/src/jobs.js:16-17` `WHERE status='open' AND created_at < now-14d`，与 meet_time 零关联。
- **9 条 open 帖的名义活动时间已过，仍在 feed 照常展示、可申请**（GET /api/posts 实测 total=24 全部返回）：id4 `本周日 14:00`（实为 10-18，已过 2.9 天）、id7 `本周日 15:00`（10-18）、id10 `本周五 19:30`（10-16）、id11 `本周六 10:30`（10-17）、id13 `本周六 03:30`（10-17）、id19 `本周日 10:30`（10-18）、id20 `本周日 09:30`（10-18）、id21 `本周六 14:00`（10-17）。其中 **id9 `本周五 19:00` 是周六 19:56 才发布的——帖子在活动结束后才出生**。
- 反向伤害 1（长期局误杀）：`每周六 07:00`、`每天 07:30`、`工作日 08:00/07:40/08:30/09:00-17:00` 共 6 条长期帖，14 天后一律被 jobs 打成 expired——持续有效的活动被系统宣判死亡。
- 反向伤害 2（远期局误杀）：id14 `5月1日 15:00`（若指 2027 年则还有 6 个多月），10-29 就会被"发布超 14 天"过期——真正的僵尸局活 12 天，远期局活 14 天，语义完全错位。
- 状态与时间脱钩还有第三形态：id25-27 `本周六 18:30`（10-24，未来）已于 10-20 被标记 **done**——"已完成"发生在活动开始前 4 天，done 后互评/加分（completePost，posts.js:469）随之提前结算。

**用户损失**
- 申请者对着"招募中"绿灯报名一个昨天就散场的局，组局者永不再审核 → 申请悬置（7 天后才随 14 天过期连带关闭），申请端焦虑+对平台"活人感"的信任损耗；feed 新鲜度失真（24 条里 4 成是尸体）。
- 长期跑步/遛狗/拼车帖（本产品最能带留存的内容）被 14 天强制下架，组局者需手动重发。

**分阶段修复**
1. **P0**（meet_at 落地后）：jobExpirePosts 改为双轨——`meet_at IS NOT NULL` 按 `meet_at + 24h < now` 过期（给 24h 缓冲容纳拖堂）；`meet_repeat != 'once'` 不自动过期（或按 last_done/last_activity 续期）；meet_at 为 NULL 维持 created_at+14d。
2. **P1**：申请入口守卫——meet_at 已过 24h 的 open 帖 join 返回"该搭局活动时间已过"，详情页卡片置灰"已结束"标签（不必等 jobs 扫）。
3. **P1**：done 幂等守卫补时间维度——meet_at 在未来时提示"活动尚未开始，确认提前完成？"（现仅防重复 done，posts.js:232，不防提前 done）。
4. **P2**：expire 通知文案带上活动时间，替代现在统一"发布超过14天"（jobs.js:21）。

---

### [TS-3]（P2）时区基准未声明：部署容器是 UTC，"天"的边界漂移 8 小时

**实测证据**
- 绝对时间本身是安全的：全部 `created_at/read_at/last_msg_at` 为 epoch ms（db.js），API 原样返回；前端 `hhmm/timeAgo`（ui.js:107-122）用 `new Date(ts).getHours()/toLocaleDateString` 设备本地渲染。实测模拟：同一消息北京用户看到 21:00、纽约用户看到 09:00——各自正确的本地墙钟，无跨时区错乱。
- 但部署缺 TZ：`Dockerfile`（node:22-alpine）与 `docker-compose.yml` 均未设 `TZ` → 生产容器是 **UTC**。宿主机实测是 CST，两套环境语义不同。
- 唯一做"天级"运算的地方：`jobs.js:100` `Math.floor(now()/86400000)` 判断 events 清理"每天一轮"——epoch 天 = **UTC 零点边界 = 北京早上 8 点**才开始新的一天清理；`PARTNER_PUSH_DAILY_CAP`（jobs.js:84）注释叫"每日上限"实为滚动 24h 窗口。当前均无用户可见损失，但这是"服务器时区思维"的地基问题：一旦未来做"每天 0 点推送摘要""今日新局"类功能，UTC 容器会让所有"今天"在北京偏移 8 小时。
- meet_time 自由文本本身无时区概念（"本周六 11:30"是谁的周六？）——纯国内线下局影响小，但 meet_at 落地时必须先钉死基准。

**用户损失**：当前为零（时间戳链路实测正确）；是前瞻性债务——meet_at 一旦落地而时区未声明，日历导入/提醒将埋下错 8 小时的事故。

**修复**
1. Dockerfile/compose 显式 `ENV TZ=Asia/Shanghai`（一行，消除部署矩阵分歧）。
2. 在 docs/product-spec.md 钉死约定：**DB 一律 UTC epoch ms（现状已是）；meet_at 以 Asia/Shanghai 墙钟组装；展示一律设备本地时区**。出海再引入 `meet_at_tz`（IANA 名）列，v1 不做。

---

### [TS-4]（P2）聊天气泡只显示时分，跨天会话时间失真；timeAgo 无未来兜底

**实测证据**
- `web/public/js/pages/conv.js:214` 气泡时间 = `UI.hhmm(m.created_at)`，**无日期分隔、无跨天标记**。昨天 21:00 的消息今天打开显示的还是"21:00"——与 5 分钟前的消息视觉完全相同。seed 演示会话（seed.js:166，6 条消息 7 分钟内）恰好掩盖了这个问题，真实使用第二天必然踩中。
- 对比：会话列表/通知/评论/申请列表用 `UI.timeAgo`（chat.js:62、misc.js:226、post.js:71/345/377、admin.js:79），≥30 天才落日期（ui.js:116 `toLocaleDateString('zh-CN')`）——列表场景可接受，但和气泡的 hhmm 是两套口径，同一会话"列表 3小时前 / 气泡 21:00"，尚可接受。
- timeAgo 无未来处理：`diff` 为负时 `m<1` 落"刚刚"（ui.js:108-110）。当前无业务产生未来时间戳，但 TS-2 的提前-done 与 seed 时间漂移都可能造出负差，一进入"倒计时"时代就是必踩点。

**用户损失**：跨天对局细节（"周六 11:25 店门口碰头"约在三天前）回看时失去时间锚点，纠纷取证（举报需引用消息，conv.js:124）时间证据弱化。

**修复**（纯前端，低成本）
1. 气泡流加日期分隔条：相邻消息跨天（按设备本地日历日）时插入"今天 / 昨天 / M月D日"分隔。
2. timeAgo 增加 `diff < 0` 分支返回"即将/稍后"，30 天内>24h 的显示"M月D日"而非粗粒度"N天前"（可选）。

---

### [TS-5]（P2）"还有 3 小时开始"的紧迫感能力为零——推荐/详情无任何临近维度

**实测证据**
- 全代码检索 countdown/即将/紧迫/开始：唯一倒计时是短信验证码 60s（login.js:109）。详情页时间行只是静态文本（post.js:68 `metaRow(clock, p.meet_time)`），卡片同（ui.js:315）。
- 推荐流 reason（discover）与 hot 排序均无时间信号；feed 无法回答"今晚有什么局""周末有什么局"——搭子场景最高频的两个进入意图。

**用户损失**：临近开始的局（转化率最高的供给）被 id DESC 淹没；"今晚想找饭搭子"的用户只能人肉扫文本。此条为 TS-1 的直接后果，单独立项是为保住产品价值视角：**修 TS-1 不是技术洁癖，是解锁本条**。

**修复**（依赖 TS-1 第 1-2 步）
1. 详情页/卡片：meet_at 距今 <24h 时显示"明天 11:30 开始"/"3 小时后开始"pill。
2. feed 加 `?when=today|weekend|week` 参数（SQL 层按 meet_at 区间过滤，服务器以 Asia/Shanghai 判定日界）。
3. 推荐流 urgency 加权：临近开始且未满员的局小幅提权（hot 公式加一项）。

---

## 合格项

- **绝对时间链路正确**：全库 created_at/read_at/last_msg_at 均为 UTC epoch ms，API 直传毫秒，前端统一 `new Date()` 本地渲染——跨时区用户看到的墙钟各自正确（实测模拟北京/纽约双端通过），无"服务器时区串进 UI"的经典事故。
- **jobs 未用"每日 0 点 cron"**：10 分钟轮询 + 各子任务独立 try-catch + unref（jobs.js:107-127），不依赖服务器时区午夜，不因单任务异常 crash——时区敏感面被主动缩小到仅 jobCleanEvents 的天级桶。
- **过期规则对用户可感知**：post_expired 通知文案明说"发布超过 14 天"（jobs.js:21），且 expired 局有完整的不可复活守卫（approve 状态机 T4，posts.js:358；api.test.js:1832 有回归覆盖）。
- **meet_time 有长度护栏**：创建 30 字截断防滥用（虽是长度不是语义）；敏感词过滤覆盖时间字段之外的正文路径。
- **seed 演示会话时间一致性好**：消息时间戳递增、last_msg_at 同步（seed.js:166-185），列表 timeAgo 渲染无负差异常。
- **测试对 14 天过期语义有真实覆盖**：api.test.js:1343/1841 走真实 runJobs 路径回拨 created_at 验证，非 mock——TS-2 修改过期逻辑时有现成测试骨架可扩展。

## 附：meet_at 落地顺序（一句话版）

① db.js 加列 `meet_at`(可空 epoch ms)+`meet_repeat`，postView 透传（老前端零感知）→ ② posts.js POST/PUT 校验 meet_at（未来 5min~365d，repeat 豁免）并统一 slice 不一致 → ③ jobs 过期切双轨（meet_at+24h / repeat 永续 / NULL 维持 14d）+ join 入口时间守卫 → ④ 发布页结构化控件（date/time/重复 + 快捷 chips，自由文本降级为补充说明）→ ⑤ 前端展示升级（格式化+倒计时 pill+日期分隔条）→ ⑥ feed when 筛选与推荐 urgency → ⑦（可选）存量 seed 正则回填 + Dockerfile TZ=Asia/Shanghai。
