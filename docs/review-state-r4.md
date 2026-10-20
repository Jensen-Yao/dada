# R4 状态机/并发批评：join/approve/done 状态机与请求并发实测（2026-10）

视角：分布式一致性批评家。对象：server/src/routes/posts.js（join/approve/done）、chat.js、jobs.js（14 天过期等定时任务）、auth.js（SMS）、users.js（注销/拉黑）、util.js（notify/addCredit/getOrCreatePartner）、db.js（node:sqlite DatabaseSync 同步驱动）。
方法：起独立服务（DADA_PORT=3969、独立库 /tmp/dada-race/race.sqlite），写 Node 并发脚本（Promise.all 客户端并发 + 独立进程跑真实 jobs.js 制造 job/request 跨进程并发）逐项实测，跑完全库 SQL 审计。测试后服务已杀、临时库已隔离。

**结论：5 项（P0 数据错乱 1 项 / P1 边界异常 2 项 / P2 理论风险 2 项）；10 组实测中另 6 组为"同步模型事实原子性豁免"，无需修复（见豁免清单防重复报）。全库计数审计 0 不一致。**

先说结构性事实（后文所有判断的前提）：**全部 HTTP/WS handler 从取参、校验（check）到写库（write）之间没有任何 `await`**（node:sqlite DatabaseSync 同步 API，posts.js/auth.js/chat.js 通篇无 async handler），Node 单进程事件循环把"客户端并发"串行化消化——经典 check-then-act 竞态窗口在这个架构里**不存在**。因此本次实测抓到的 3 个实质缺陷全部是**顺序即可触发、与并发无关的状态机守卫缺失**；同步模型救不了"重复请求"和"缺前置校验"，只救得了"交错"。

## R4状态机/并发批评：5项（P0数据错乱/P1边界异常/P2理论风险）

[T3] **P0 · done 无幂等护栏：重复标记完成重复发搭力值，且零成员局可直接 done 刷分**
- 场景：组局者 PUT /posts/:id {status:'done'} 两次（双击/网络重试即可，无需并发）；另发现 done 对 0 成员的 open 局也放行。
- 并发脚本：test-a.mjs（PUT done ×2 串行；PUT done ×4 Promise.all；rate×done 同发）。
- 实测结果（错乱数据具体值）：第 1 次 done → author credit 600→620、member 600→620（各 +20，符合设计）；**第 2 次 done → 620→640 / 620→640，再各 +20**；**4 连发 done 全部 200，author credit 640→720（Δ+80，应 +20）**。探针另证：全新 open 局（0 个 approved 成员）直接 PUT done → 200，author +20（620→640）——"发帖→立即done→+20"可无限循环刷到 1000 上限。附带数据错乱：重复 done 给同一人落重复通知（审计实测 user#2 在 post#6 收到 4 条"搭局已完成"、user#5 在 post#5 收到 2 条）。
- 根因：posts.js PUT /:id 的 done 分支（:226-234）**不检查当前状态**（任何 status 都能再 done 一次），completePost（:428-435）也无"本局已发过完成分"的去重；同步模型对此无效——这是两个先后到达的合法请求，各自完整执行。信用加分且**无任何参与门槛**（0 成员照发），也无 credit 流水表可对账。
- 是否需要事务/修复：**不需要事务**（同步串行下事务无并发增益），需要幂等守卫 + 门槛：done 分支加 `if (p.status === 'done') return 400/幂等返回`；completePost 加 `approved 成员数 ≥ 1`（或作者+成员 ≥ 2）才发分；根治建议加 credit_ledger 表并以 `(post_id, type)` 唯一去重，顺带解决"credit 无法审计"问题。

[T4] **P1 · approve 不校验帖子状态：expired 局被批准并"复活"为 full（job vs request 竞态实锤）**
- 场景：帖子超 14 天被 jobs.js jobExpirePosts 置 expired 的同一时刻，组局者对存量 pending 申请点通过。
- 并发脚本：test-b.mjs（dbtool.mjs 回拨 created_at -15 天 → 独立进程执行**真实** jobs.js runJobs() → approve；另做 5 轮"approve(HTTP) 与 runJobs(独立进程) 同刻发起"真并发）。
- 实测结果（错乱数据具体值）：过期后 post.status='expired'（job 返回 expired:1）→ 对 expired 局 **approve 返回 200**，join 终态 approved，**post.status 被改写回 'full'**（expired 复活，expired_count 与 approved_count 从此对不上）；5 轮真并发 5/5 复现（post#8~#13 全部终态 full）。closed 局同理可批准（同一缺失守卫）。
- 根因：posts.js approve 路由（:345-375）只校验 `j.status==='pending'` 与容量，**从不读 p.status**；满员转移 `UPDATE posts SET status='full'`（:361）直接覆盖 expired。job 侧自身有守卫（`WHERE id=? AND status='open'`，jobs.js:19）所以 job 不会写坏别人的状态——错乱方向单向：请求侧越过 job 的结论。
- 是否需要事务/修复：不需要事务，需要路由守卫：approve（以及 join 已有的 status!=='open' 检查之外）加 `if (!['open','full'].includes(p.status)) return 400`。一行修复。

[T5] **P1 · 注销与在途/后续 approve 脱节：已注销用户的申请照样被批准、建会话、收通知、涨搭力值**
- 场景：申请人 POST /users/me/delete 的同时（或之后），组局者批准其 pending 申请。
- 并发脚本：test-b.mjs（注销+approve Promise.all 同发；再补"先注销完成后 approve"确定性对照；随后 done）。
- 实测结果（错乱数据具体值）：并发轮注销 200 + approve 200 → join 终态 **approved**，注销账号 status='deleted'；给已注销用户落通知 1 条、getOrCreateConv 建会话 1 个；确定性对照同样 approved。后续该局 done → **已注销账号 credit 600→620**（注销态继续积累搭力值）。全库审计残留：注销用户仍挂 approved 成员的 join 2 条、发给注销用户的通知 4 条、含注销用户的会话 2 个。
- 根因：approve/completePost/notify 全链路不复查 `j.user` 的 users.status（对比：chat 的 WS 每帧点查 status，HTTP approve 却不查）；注销实现（users.js:108-122）只改用户行本身，不清 joins/会话，"注销"与"成员名单"两个状态机互不知晓。
- 是否需要事务/修复：不需要事务。approve 前查 `j.user status==='active'`（user 概要已在 joins 列表 SQL 里 JOIN users，顺手取即可）；注销时把该用户 pending joins 批量置 rejected 并通知组局者；completePost/notify 对 deleted 用户跳过。

[T2] **P2 · quit 是死枚举：申请人无任何退出通道，"approve vs quit 竞态"前提不成立**
- 场景：申请人主动退出申请（joins.status 的 CHECK 枚举含 'quit'，db.js:134）。
- 并发脚本：test-a.mjs（探测 POST /posts/:id/joins/:jid/quit；替代性实测同 join 的 approve/reject/approve 三连发、need_count=1 的双 approve 竞态）。
- 实测结果：quit 端点 **HTTP 404**（全代码无任何写入 'quit' 的语句）；替代实测均无错乱：同 join 三连发 → 200,400,400（"该申请已处理"×2），终态唯一；need_count=1 双 approve → 200,400，先到者 approved 并触发满员自动婉拒另一 pending，后到者 400。
- 根因：schema 预留了 quit 语义但路由层从未实现（死枚举值）；而"同一 join 的并发写"被 `j.status==='pending'` 唯一闸门 + 同步串行消化。
- 是否需要事务/修复：非并发问题，是产品缺口——若要支持退出，加 POST /:id/joins/:jid/quit（仅本人、pending 时置 quit 并通知组局者）；现有闸门无需动。

[T7] **P2 · 验证码原子性与 phone 唯一性完全寄生在"单进程同步"这一实现细节上（多进程部署即破防）**
- 场景：同一 SMS code 并发用于两个注册；并发重发。
- 并发脚本：test-b.mjs（sms/send 取 demo_code → 两注册 Promise.all 同发同 code；同 code 第三次重放；sms/send ×3 并发）。
- 实测结果：双注册 → 200 + 400（"验证码错误或已过期"），同手机号账号数 = **1**；code 重放第三次 → 400；并发 sms/send ×3 → 200,429,429（60s 重发窗）。**单进程下一次性消费确实原子**（verifySmsCode 读内存 Map → INSERT → smsCodes.delete 之间零 await）。
- 根因（风险所在）：① `users.phone` **无 UNIQUE 索引**（db.js users 表），防双注册纯靠 check-then-insert 的串行性；② smsCodes 是**进程内存 Map**（auth.js:11）。一旦 pm2 cluster/多容器共享 SQLite，两个进程各持一份 Map：验证码在 A 进程消费后 B 进程仍有效，TOCTOU 窗口重新打开，可双注册同手机号（正是该约束缺失时最脏的后果）。
- 是否需要事务/修复：单进程现状无需修；多进程前必须做两件事：`CREATE UNIQUE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL AND status!='deleted'`（部分唯一索引，保留注销释放手机号语义）+ smsCodes 迁到 SQLite（kv 表或专表，消费用 `DELETE ... WHERE code=?` 的 changes 判断，天然原子）。

## 事实原子性豁免项（同步 SQLite 下无需修复的，说明原因防重复报）

- **[T1] join 竞态（need_count=1，3 人同毫秒 join → approve 超发？）— 无缺陷**。实测：3×join 全 200 落 3 条 pending——join 本就不做容量校验，**pending 是申请队列语义、不占名额**（占名额的是 approved）；并发 approve×3 → 200,400,400，approved 恰 1、post 变 full、其余 pending 被满员自动婉拒并各收恰好一条通知。闸门在 approve 的 `approved >= need_count` 前置（posts.js:352-353），同步串行下检查与更新间无窗口，不可能超发。
- **[T2 替代] 同一 join 并发 approve/reject、满员临界双 approve — 无缺陷**。`j.status==='pending'` 是唯一状态闸门，串行消化下恰好一个请求成功、终态确定、通知与终态一致（申请人只收一条结果通知）。
- **[T3 部分] rate vs done 时序 — 无缺陷**。rate 有 `p.status==='done'` 前置（先到 400"需先标记完成"、后到 200）+ `UNIQUE(post_id,rater_id,ratee_id)` 双保险；同对同局重复 rate → 400"已经评价过对方了"，2 星差评 credit Δ-15 恰好一次。且帖子**无删除端点**（作者只能 closed/done），"评了不存在的局"前提不成立。
- **[T6] 拉黑 vs 在途评论 — 无缺陷**。12 轮"评论×拉黑"Promise.all：12×200 落库、comments 行数 12 == comments_count、拉黑行 12/12；反向对照（拉黑先完成再评论）→ 403"无法与该用户互动"。串行次序决定两种**都合法的历史**：评论先消化则落库（拉黑只拦后续互动，列表侧另有过滤），拉黑先消化则 403。无撕裂状态、计数不漂移。
- **[T8] partners 双向并发互评 → times=2？— 无缺陷**。getOrCreatePartner 只在"看到对方已评"的一侧触发（posts.js:421-423），同步串行下恰好触发一次：3 轮同局并发互评 times=1,2,3（每局 +1），串行第 4 局后 times=4；审计 SQL 重算"互评完成局数"与 partners.times 全量一致。双击 rate 只落一评、加分一次。
- **[T9] approve+done 竞态的矛盾通知 — 无缺陷**。交替次序 4 轮实测：approve 先到 → 申请人收 [申请已通过, 搭局已完成]；done 先到 → join 被婉拒、申请人只收 [申请未通过]，随后的 approve 吃 400"该申请已处理"。rejectPendingJoins 与 approve 共用 pending 闸门，**同一 join 不可能同时收到"通过"与"未通过"**。真正的通知重复只来自 T3 的双 done（已并入 P0）。
- **点赞/取消点赞双击（审读推断，未实测）**：like 路由的 exist→insert/delete 与 likes_count 增减在同一次同步执行里完成，双击退化为串行的 like→unlike，计数自洽；likes 审计 PASS 旁证。
- **通用**：发布幂等护栏（同用户 60s 同标题内容只落一帖）与 WS 每帧账号状态点查是代码里已正确利用同步模型的正面样本，无需重复立项。

## 并发后一致性审计结果

全部实测跑完后（39 用户 / 29 帖 / 28 joins / 22 approved / 10 ratings / 145 通知 / 156 events），对同一库执行只读 SQL 核对（audit.mjs）：

| # | 不变式 | 结果 |
|---|---|---|
| 1 | posts.likes_count vs COUNT(likes) | PASS（0 行漂移） |
| 2 | posts.comments_count vs COUNT(comments) | PASS |
| 3 | approved joins ≤ need_count（名额不超发） | PASS |
| 4 | status='full' ⇔ approved==need_count | PASS |
| 5 | status='open' ⇒ approved<need_count | PASS |
| 6 | joins (post_id,user_id) 唯一 | PASS |
| 7 | users.phone 无重复注册 | PASS（并发双注册下仍=1） |
| 8 | partners.times vs 互评完成局数重算 | PASS |
| 9 | ratings 双方均为同局参与者 | PASS |
| 10 | users.credit ∈ [0,1000] | PASS |

**计数类不变式 0 不一致**——反证"计数漂移/名额超发/双注册"这类需要写写交错的错乱在同步模型下确实无法发生。审计的 INFO 项精确刻画了仅有的 3 处状态机污渍，与上 文 T3/T4/T5 一一对应：① 注销用户仍为 approved 成员的 join 2 条（join#17/join#18）；② 被 approve 复活为 full 的前 expired 局 6 个（post#8~#13）；③ 双 done 重复通知指纹 2 组（user#2×post#6×4 条、user#5×post#5×2 条）。

**审计局限（独立小 finding）**：credit 无流水表，"某人当前分值是否等于其应得分值"无法用 SQL 对账（本次只能验边界与次数指纹）。修复 T3 时建议一并加 credit_ledger（user_id, delta, reason, post_id, created_at），让下一次审计能做全量对账。

---
复现材料：/tmp/dada-race/{test-a,test-b,test-c,audit,dbtool}.mjs 及输出 out-a.log / out-b.log / out-c.log / out-audit.log（临时目录，关键数值已摘录上文）。
