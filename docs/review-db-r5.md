# R5 备份/迁移演练报告（DBA/SRE 视角，全部实操）

> 演练原则：不看文档猜，全部动手。所有演练在 /tmp/dadrill 沙箱进行，未触碰 `server/data/dada.sqlite` 生产演示库。
> 老库用 **git 真实历史代码**生成（v2.7=7a950a1 的 db.js、v1.0=ce2be09 的 db.js），非手工伪造。
> 环境：Node v24.15.0（node:sqlite，SQLite 3.51.3），无 sqlite3 CLI（`db.backup()` API 在此版本不可用，在线备份改用 `VACUUM INTO` 实测）。
> 演练日期：2026-10-12。

## R5备份/迁移演练：10项（P0×2 数据丢失路径 / P1×5 演练暴露 / P2×3 建议）

### P0 —— 数据丢失路径

**[P0-1] WAL 运行期"只拷主文件"= 静默旧备份，integrity_check 依然 ok，无人会发现**
- 场景：D3 备份恢复演练。最可能被运维 instinct 使用的备份方式：`cp dada.sqlite backup.sqlite`。
- 演练步骤：① 沙箱库写 100 行并 `wal_checkpoint(TRUNCATE)`；② 写入进程持续追加 300 行（每行间隔 3ms）；③ 期间 `cp` 主文件；④ 恢复副本到独立进程，`PRAGMA integrity_check` + 数行数。
- 实测结果：副本 **100/400 行（丢 75%）**，`integrity_check: ok`。丢失的 300 行全在未拷走的 `-wal` 里，**校验全绿、无任何报错**——是最危险的一类备份失败（静默旧数据）。
- 真实库放大实测：对 `server/data/dada.sqlite`（主文件 163KB / `-wal` 2.29MB）只拷主文件，打开后 users **16→10**、posts 27→24、**events 54→0**、messages 9→7。
- 修复/流程建议：备份一律用 `VACUUM INTO`（在线、时间点一致，实测写入进行中拿到一致快照）或先 `PRAGMA wal_checkpoint(TRUNCATE)` 再冷拷贝；在 README/deploy.sh 写明"**禁止**只拷 `dada.sqlite`"；备份后必须附带行数/integrity 校验输出。

**[P0-2] 仓库自带备份（deploy.sh tar 热备）= 非原子多文件拷贝；WAL 丢失即回退到 checkpoint 点**
- 场景：D3/D4。审计发现 deploy.sh:49-53 是唯一的官方备份手段：应用运行中 `tar czf` 整个 data 卷，注释声称"WAL 模式下 tar 一致性足够做日常备份"——此说法未经演练，本次实测。
- 演练步骤：① 写入进行中依次 cp 主文件+`-wal`+`-shm`（模拟 tar 顺序读取三文件）；② 另做 kill -9 制造"WAL 未 checkpoint"现场后删除 `-wal`，观察回退量。
- 实测结果：① 三文件非原子拷贝得 185/400 行——本次侥幸一致（tar 单线程顺序读通常能赶上同一快照边界，但**无任何机制保证**，checkpoint 恰好发生在 tar 读 wal 时即 torn copy）；② kill -9 后删 `-wal`：**300/400 行蒸发**，精确回退到最后一次 checkpoint。
- 真实库敞口：当前 `dada.sqlite-wal` 2.29MB vs 主文件 163KB——**约 93% 的数据活在 WAL 里**，此窗口内任何 WAL 缺损/未包含 = 大部分数据回退。
- 修复/流程建议：deploy.sh 备份改为容器内 `node -e "...VACUUM INTO..."`（容器里没有 sqlite3 CLI，原注释建议不可执行）；给应用加定时 `wal_checkpoint`（见 P1-5）；备份产物做恢复演练验证（本报告 §演练通过项 的跨机恢复步骤可直接脚本化）。

### P1 —— 演练暴露

**[P1-1] users 重建迁移硬编码列清单，清单外的列被静默丢弃（未来加列必踩）**
- 场景：D2 多代升级链的"缺失中间态"分支。
- 演练步骤：v1.0 未迁移库上 `ALTER TABLE users ADD COLUMN loyalty INTEGER NOT NULL DEFAULT 5` 并写值 9（模拟"某个中间版本加过列"的库）；跑当前 db.js。
- 实测结果：users 重建迁移正常执行，**loyalty 列连同值 9 无声消失**——无警告、无报错、exit 0。根因：db.js:60 的 `COLS` 常量是硬编码清单，`INSERT INTO users_new (COLS) SELECT ...` 之外的一切列被 DROP。
- 修复/流程建议：重建迁移的列清单改由 `PRAGMA table_info(users)` 动态生成；INSERT 前后比对行数与列数；迁移日志打印迁移了多少列。

**[P1-2] 迁移失败被吞掉，服务带病启动，注销功能全量 500**
- 场景：D5 不可逆审计的故障注入分支。
- 演练步骤：未迁移老库注入遗留 `users_new` 表（模拟异常恢复混合态/上次失败残留）→ 用当前代码启动 → 触达注销写入（users.js:129 `status='deleted'`）。
- 实测结果：仅一行 `console.error`（`users 表迁移失败： table users_new already exists`）后**启动继续**；API 正常服务；注销写入实测报 `CHECK constraint failed: status IN ('active','banned')` → 该功能 100% 500。无任何健康检查能发现此状态。
- 修复/流程建议：users 重建迁移失败应 **exit 非零拒绝启动**（fail-fast）或进入只读降级；catch 后必须 rethrow 非"可重试"错误（参见 P2-1）。

**[P1-3] 无 schema 版本管理：SCHEMA_VERSION 是死常量，无 user_version，无 DOWN 迁移**
- 场景：D5 静态审计。
- 实测结果：`SCHEMA_VERSION=1`（db.js:16）全仓库**零引用**；`PRAGMA user_version` 从未使用（实测线上库 =0）；无任何 ROLLBACK/down 路径。迁移不可逆这一点本身可接受（SQLite 场景常规），但**没有版本号意味着**：无法判断某库"还缺哪些迁移"、无法在升级前做版本门槛校验、出问题无法回答"这库是哪个时代的"。
- 修复/流程建议：迁移完成后 `PRAGMA user_version = N`；启动时校验 `user_version <= 当前支持版本` 否则拒启；文档记录每版对应的 user_version。

**[P1-4] 损坏库的启动表现 = 裸崩溃，报错无指引，无损坏应急 runbook**
- 场景：D4 损坏恢复。
- 实测结果：① 文件头 1 字节破坏（'S'→'X'）：`db.js:13 PRAGMA journal_mode=WAL` 抛 `Error: file is not a database`，进程启动即死；② 数据页/schema 页破坏（512B×3）：启动即死 `Error: malformed database schema (?)`。fail-fast 方向正确（不会带病读写损坏库），但报错无"怎么办"，docs/ 无任何恢复流程。
- 恢复步骤（实测有效，应写入 runbook）：停进程 → 保留损坏文件做取证 → 用最近一次 `VACUUM INTO` 备份恢复到新文件 → `integrity_check` + 行数比对 → 更换 DADA_DB 指向重启 → API 冒烟。实测恢复后 users=3、integrity ok。
- 修复/流程建议：index.js 顶层 catch DB 打开异常，输出结构化报错 + 恢复指引；docs 增加损坏应急章节。

**[P1-5] WAL 长期不 checkpoint：93% 数据悬在 WAL，放大 P0-1/P0-2 且拉长崩溃恢复窗口**
- 场景：D3/D4 交叉发现。真实库主文件 163KB、WAL 2.29MB 且持续增长（演练期间 1.69MB→2.29MB）。
- 实测结果：node:sqlite 仅在**连接干净关闭**时自动 checkpoint（D4 对照组实测 close 后 WAL 消空）；服务器进程永不关闭连接 → WAL 无限增长。后果：崩溃后回放窗口越来越大；一切"只备主文件"的方案（P0-1）几乎等于备了个空壳。
- 修复/流程建议：jobs.js 定时任务里加每小时 `PRAGMA wal_checkpoint(TRUNCATE)`（低峰执行）；或设置 `PRAGMA wal_autocheckpoint` 显式阈值并监控 WAL 文件大小告警。

### P2 —— 建议

**[P2-1] `try { ALTER } catch {}` 吞掉一切错误**：db.js 共 8 处，本意只吞 "duplicate column"，实际磁盘满/只读文件系统/库损坏全部静默跳过。建议 catch 里判断 `e.message.includes('duplicate column name')` 才忽略，其余 rethrow。

**[P2-2] 重建迁移加自校验**：INSERT SELECT 后比对 `changes` 行数与源表行数（P1-1 的丢列若有行数/列数断言至少能报警）。

**[P2-3] 补一份可执行的备份脚本 + 恢复演练脚本**：`scripts/backup.mjs`（VACUUM INTO + 行数快照 + 保留 N 份）与 `scripts/verify-restore.mjs`（对备份文件 integrity_check + 关键表行数 vs 快照），cron 化；events 表 90 天滚动删除，备份保留期建议 ≥ 90 天才能覆盖埋点审计需求。

## 演练通过项

| # | 演练 | 结果 |
|---|---|---|
| 1 | **D1 升级路径**：v2.7 真实老库（7a950a1 代码生成：users 无 phone/adult_confirmed/rec_off、CHECK 无 'deleted'、无 events/partners/feedback）→ 当前代码 | **12/12 PASS**：12 表行数与旧列逐值保真；新列默认值正确（phone=NULL/adult=0/rec_off=0）；posts.images 老行保留原值；status='deleted' 与 phone 写入可用；idx_users_phone 就位；无 users_new 残留；integrity ok |
| 2 | **D1 端到端**：迁移后库启动完整服务，/api/posts、/api/meta、登录路由 | PASS：老数据正常返回，服务正常 |
| 3 | **D2 两跳升级链**：v1.0 最老库（ce2be09 代码生成，posts 无 images 列）跳过中间两代代码直达当前 | **12/12 PASS**：images 补 '[]'，全部数据保真。证实迁移**不依赖中间态存在**（全靠 try-ALTER/IF NOT EXISTS 幂等重放）。注：git 考古确认最早 schema 即 v1.0，**likes 表自始存在**，"无 likes 的更老状态"为人为构造 |
| 4 | **D2 缺失中间态（无 likes 表）**：人为 DROP likes 后跑当前代码 | PASS：likes 以空表重建，其余数据无伤，integrity ok（likes 明细不可恢复属预期） |
| 5 | **D3 在线备份**：写入进行中 `VACUUM INTO` | PASS：时间点一致快照（194 行完整一致），毫秒级完成 |
| 6 | **D3 冷备**：`wal_checkpoint(TRUNCATE)` 后 cp | PASS：300/300 完整 |
| 7 | **D3 跨机恢复**：备份文件投递另一目录+独立进程，当前服务端代码启动 + API | PASS：users/posts/likes/ratings 全对，integrity ok，API 正常 |
| 8 | **D4 对照：-shm 丢失** | PASS：无影响（自动重建） |
| 9 | **D5 迁移原子性 kill -9 实测**：复刻 users 重建事务，在 `DROP TABLE users` 之后、`COMMIT` 之前 SIGKILL | **PASS**：重开库 users 完整回滚（旧 CHECK、2 行俱在）、无 users_new 残留、integrity ok；随后当前代码重跑迁移一次成功。**SQLite 事务性 DDL 实测成立，"迁移中途崩溃毁库"不成立** |
| 10 | **D4 干净关闭后无 WAL 丢失窗口**（node:sqlite close 自动 checkpoint） | PASS（但服务进程永不 close，见 P1-5） |

## schema快照摘要（指向db-schema.md）

- 当前 schema：**14 业务表 + kv，16 索引**（含 1 个部分唯一索引 idx_users_phone），全列语义/约束/迁移历史见 **[docs/db-schema.md](./db-schema.md)**（由迁移后库的 sqlite_master 实测导出，非文档转抄）。
- 基线行数（演示库，快照于演练开始）：users=16, posts=27, likes=150, comments=6, joins=3, conversations=4, messages=9, notifications=30, ratings=6, events=54, partners=3, reports/blocks/feedback/kv=0。
- 迁移代际：v1.0(13表) → v1.1(posts.images) → 合规(users重建+3列) → v3.0(events,partners) → R3(reports×2列) → R4(feedback+phone唯一索引)。

## 最脆弱环节（一句话）

**备份链路，而非迁移**：迁移被证明幂等且原子（kill -9 都打不穿），但全仓库唯一在用的备份手段是"运行中 tar 数据卷"这种非原子拷贝，而真实库 93% 的数据躺在从未 checkpoint 的 WAL 里——现在执行一次"成功的备份"，最可能得到一个 integrity_check 全绿、却缺了绝大部分数据的旧快照，且无人能发现。
