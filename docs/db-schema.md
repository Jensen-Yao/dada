# 搭搭 DB Schema 文档（v3.0 / R4 后）

> 数据源：实测导出自迁移后 SQLite 库的 `sqlite_master`（非文档猜测）。生成方式见 `docs/review-db-r5.md` D6。
> 存储引擎：SQLite（node:sqlite `DatabaseSync`，Node >= 22.5），`journal_mode=WAL`，`foreign_keys=ON`。
> 时间约定：所有时间列为 **Unix 毫秒整数**（`Date.now()`）。
> Schema 版本管理：`PRAGMA user_version` 已启用（R5 修复）——迁移成功后写 `user_version=1`，启动时读取打印，库版本高于代码支持版本时拒绝启动；历史沿革见下方"迁移机制现状"。

## 表清单（14 张业务表 + 1 个 kv）

| 表 | 语义 | 主键 | 引入版本 |
|---|---|---|---|
| users | 用户（含合规三列 phone/adult_confirmed/rec_off 与注销态） | id 自增 | v1.0 |
| posts | 搭子帖（14 分类） | id 自增 | v1.0 |
| likes | 点赞（一人一帖一次） | (user_id, post_id) 复合 | v1.0 |
| comments | 帖评论 | id 自增 | v1.0 |
| joins | 组局报名（审批流） | id 自增，UNIQUE(post_id,user_id) | v1.0 |
| conversations | 会话（私聊/局聊容器） | id 自增，UNIQUE(user_a,user_b) | v1.0 |
| messages | 消息（text/system/safety） | id 自增 | v1.0 |
| notifications | 站内通知 | id 自增 | v1.0 |
| reports | 举报（含 R3 处理留痕两列） | id 自增 | v1.0 |
| blocks | 拉黑 | (blocker_id, blocked_id) 复合 | v1.0 |
| ratings | 搭后互评（一次一星评） | id 自增，UNIQUE(post_id,rater_id,ratee_id) | v1.0 |
| kv | 简单键值（getKV/setKV） | k TEXT | v1.0 |
| events | v3.0 事件埋点（成搭漏斗，90 天 TTL 清理） | id 自增 | v3.0 (85d2311) |
| partners | v3.0 搭友关系（user_a<user_b 归一化） | (user_a, user_b) 复合 | v3.0 (85d2311) |
| feedback | R4 意见反馈队列 | id 自增 | R4 (aee9ab4) |

## users（用户）

| 列 | 类型/约束 | 语义 |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | 用户 ID |
| username | TEXT NOT NULL UNIQUE | 登录名（唯一索引 sqlite_autoindex_users_1） |
| password_hash | TEXT NOT NULL | bcrypt 哈希；注销后改写为 `deleted:<hex>` 非法哈希使原密码失效 |
| nickname | TEXT NOT NULL | 昵称 |
| avatar | TEXT DEFAULT NULL | 头像（/img/... 或 /uploads/...） |
| gender | TEXT NOT NULL DEFAULT 'secret' CHECK IN ('male','female','secret') | 性别 |
| birth_year | INTEGER DEFAULT NULL | 出生年（算年龄） |
| city | TEXT NOT NULL DEFAULT '' | 城市（检索/冷启动） |
| district / school / occupation / mbti / bio | TEXT DEFAULT ''/'[]' | 资料维度 |
| tags | TEXT NOT NULL DEFAULT '[]' | 兴趣标签 JSON 数组 |
| verify_student / verify_real / verify_pending | INTEGER NOT NULL DEFAULT 0 | 学生认证/真人认证/审核中 |
| is_admin | INTEGER NOT NULL DEFAULT 0 | 运营后台权限 |
| credit | INTEGER NOT NULL DEFAULT 600 | 搭力值（信用分，初始 600） |
| warnings | INTEGER NOT NULL DEFAULT 0 | 违规警告次数 |
| status | TEXT NOT NULL DEFAULT 'active' CHECK IN ('active','banned','deleted') | 账号状态；**'deleted' 为 R4 注销态（CHECK 曾在 1d04c0e 整表重建扩展）** |
| phone | TEXT DEFAULT NULL | 手机号（合规收集）；部分唯一索引见下 |
| adult_confirmed | INTEGER NOT NULL DEFAULT 0 | 成年确认（合规） |
| rec_off | INTEGER NOT NULL DEFAULT 0 | 退出个性化推荐（PIPL 24条） |
| created_at / last_active_at | INTEGER NOT NULL | 注册/最近活跃（毫秒） |

索引：
- `sqlite_autoindex_users_1`：username UNIQUE
- `idx_users_phone`（R4/T7）：`UNIQUE(phone) WHERE phone IS NOT NULL AND status != 'deleted'` —— 部分唯一索引，同号防双注册 + 注销释放号码可复用

## posts（搭子帖）

| 列 | 类型/约束 | 语义 |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | 帖 ID |
| user_id | INTEGER NOT NULL REFERENCES users(id) | 作者 |
| category | TEXT NOT NULL | 14 分类 key（food/sports/study/...） |
| title / content | TEXT NOT NULL / NOT NULL DEFAULT '' | 标题/正文 |
| city | TEXT NOT NULL DEFAULT '' | 城市（广场筛选） |
| location_name / meet_time | TEXT DEFAULT '' | 地点/时间文案（meet_time 为人类可读显示文本，老帖兜底） |
| meet_at | INTEGER DEFAULT NULL | **结构化开始时间（R5/TS-1）**：epoch 毫秒，UTC 存储；可空，NULL 时一切行为与加列前一致 |
| meet_repeat | TEXT DEFAULT NULL | 周期局标记（R5/TS-2）：'daily'\|'weekly'，可空；周期局豁免"未来"校验且永不过期 |
| need_count | INTEGER NOT NULL DEFAULT 1 | 缺几人 |
| fee_mode | TEXT NOT NULL DEFAULT 'aa' CHECK IN ('free','aa','treat') | 费用模式 |
| gender_req | TEXT NOT NULL DEFAULT 'any' CHECK IN ('any','female','male') | 性别要求（仅限女生局） |
| requirements | TEXT DEFAULT '' | 招募要求 |
| images | TEXT NOT NULL DEFAULT '[]' | 配图路径 JSON 数组（v1.1/1293320 增列迁移） |
| status | TEXT NOT NULL DEFAULT 'open' CHECK IN ('open','full','closed','done','expired') | 状态机；'expired' 由定时任务写入 |
| likes_count / comments_count / views_count | INTEGER NOT NULL DEFAULT 0 | 冗余计数 |
| created_at | INTEGER NOT NULL | 发布时间 |

索引：`idx_posts_city`、`idx_posts_category`、`idx_posts_status`。

## likes（点赞）

复合主键 `(user_id, post_id)`；`created_at INTEGER NOT NULL`。取消赞即删行（posts.js:256 DELETE）。

## comments（评论）

id PK；`post_id REFERENCES posts(id)`、`user_id REFERENCES users(id)`、`content TEXT NOT NULL`、`created_at`。索引 `idx_comments_post(post_id)`。

## joins（组局报名）

id PK；post_id/user_id 外键；`message TEXT DEFAULT ''`（报名留言）；`status CHECK IN ('pending','approved','rejected','quit')` 审批状态机；`created_at`/`updated_at`；`UNIQUE(post_id,user_id)`（一人一局一次）。索引 `idx_joins_user(user_id)`。

## conversations（会话）

id PK；`post_id REFERENCES posts(id)` **可空**（纯私聊无局）；`user_a`/`user_b` 外键；`last_msg_at`；`UNIQUE(user_a,user_b)`（一对用户一个会话）。

## messages（消息）

id PK；`conv_id REFERENCES conversations(id)`；`sender_id REFERENCES users(id)`；`type CHECK IN ('text','system','safety')`（safety=首条消息后的安全提示）；`content TEXT NOT NULL`；`read_at INTEGER DEFAULT NULL`（NULL=未读）。索引 `idx_messages_conv(conv_id, id)`。

## notifications（通知）

id PK；user_id 外键；type/title/body；`data TEXT NOT NULL DEFAULT '{}'`（JSON 载荷）；`read INTEGER NOT NULL DEFAULT 0`。索引 `idx_notif_user(user_id, read)`。

## reports（举报）

id PK；reporter_id 外键；`target_type CHECK IN ('user','post','comment','message')`；target_id（多态目标，无外键）；reason/detail；`status CHECK IN ('pending','resolved')`；created_at。
R3 (d3cb82c) 增列：`resolved_at INTEGER DEFAULT NULL`、`resolve_action TEXT DEFAULT NULL`（处理留痕，举报人经 /api/reports/mine 查进度）。

## blocks（拉黑）

复合主键 `(blocker_id, blocked_id)`；created_at。取消拉黑即删行。

## ratings（搭后互评）

id PK；post_id/rater_id/ratee_id 外键；`stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5)`；`tags TEXT NOT NULL DEFAULT '[]'`；comment；`UNIQUE(post_id, rater_id, ratee_id)`（一局内互评一次）。

## kv（键值）

`k TEXT PRIMARY KEY`、`v TEXT NOT NULL`。`getKV/setKV` 读写，UPSERT。

## events（v3.0 事件埋点）

id PK；`user_id REFERENCES users(id)` **可空**（游客事件）；`type TEXT NOT NULL`（埋点名）；`post_id REFERENCES posts(id)` 可空；created_at。
索引 `idx_events_type_time(type, created_at)`。
**数据生命周期**：jobs.js 每日 `DELETE FROM events WHERE created_at < now()-90天`（唯一一个由系统周期性删除数据的表——只增不改、90 天滚动窗）。

## partners（v3.0 搭友）

复合主键 `(user_a, user_b)`，约定 user_a < user_b（写入前排序，一对用户仅一行）；`times INTEGER NOT NULL DEFAULT 0`（成搭次数）；`last_post_id INTEGER DEFAULT NULL`；created_at。无二级索引（PK 覆盖双向查询）。

## feedback（R4 意见反馈）

id PK；user_id 可空；content NOT NULL；`status CHECK IN ('open','resolved')`；`action_text TEXT DEFAULT NULL`（处理动作留痕）；created_at。索引 `idx_feedback_status(status, created_at)`。

## 迁移历史清单（git 可溯）

| 版本 | 提交 | 迁移动作 | 机制 | 风险 |
|---|---|---|---|---|
| v1.0 | ce2be09 | 初始 13 表 | CREATE TABLE | - |
| v1.1 图片体系 | 1293320 | posts + images 列 | try ALTER ADD COLUMN，吞错 | 低 |
| 合规专项 | 1d04c0e | users **整表重建**（status CHECK 增 'deleted'）+ phone/adult_confirmed/rec_off 三列 | 五步法：关外键→建 users_new→INSERT SELECT→DROP users→RENAME，事务内；ALTER 三连 | ~~中：COLS 硬编码~~ **R5 已修：新表 DDL 由库内真实 schema 派生（仅替换 status CHECK），任意中间版本的列自动携带；行数自检；失败 exit(1) 拒绝启动** |
| v3.0 | 85d2311 | events、partners 两表 | CREATE TABLE IF NOT EXISTS | 低 |
| R3 | d3cb82c | reports + resolved_at/resolve_action 两列 | try ALTER，吞错 | 低 |
| R4 | aee9ab4 | feedback 表 + idx_users_phone 部分唯一索引 | CREATE IF NOT EXISTS / UNIQUE INDEX；索引失败仅打日志 | 低（但存量重复手机号会致索引缺位） |
| R5 | 2026-10 | posts + meet_at（epoch ms）/meet_repeat 两列；`PRAGMA user_version=1` 落库 | try ALTER（只吞 duplicate column / no such table，其余错误 exit(1)） | 低（两列均可空，老数据零影响） |

### 迁移机制现状（R5 修复后）

- **无 DOWN 迁移、无任何回滚路径**（SQLite 场景常规，可接受）。
- `PRAGMA user_version` 现已启用：迁移全部成功后写 `user_version=1`，启动时读取打印；若库版本**高于**代码支持版本（旧代码开新库）则拒绝启动。每版对应的 user_version 见迁移历史清单。
- 列 ADD 只吞"duplicate column name"（幂等重放）与"no such table"（新库稍后建表），**磁盘满/只读/损坏等真实错误一律 fail-fast exit(1)**——R5 实测：迁移失败被吞后服务带病启动，注销功能全量 500（CHECK failed）且无健康检查能发现。
- users 重建迁移：失败同样 exit(1)；INSERT 前后行数自检；动态列携带。
- idx_users_phone 创建失败 → exit(1)（需人工清洗重复手机号后重启）。
- 唯一破坏性 DDL：`DROP TABLE users`（重建迁移内，事务保护，R5 kill -9 实测完整回滚）。
- jobs.js 每日执行 `PRAGMA wal_checkpoint(TRUNCATE)`（WAL 此前无限增长，实测 93% 数据悬在 WAL，放大备份/崩溃风险）。

## 损坏应急 runbook（R5-P1-4，步骤经演练验证）

启动报 `数据库打开失败：file is not a database / malformed database schema` = 库文件损坏，按以下步骤恢复：

```bash
# 1) 停进程（保留损坏文件做取证，勿删除）
docker compose stop app          # 或 systemctl stop dada
mv /var/lib/docker/volumes/dada-data/_data/dada.sqlite{,.corrupt-$(date +%F)}

# 2) 用最近一次在线备份恢复到新文件（deploy.sh 升级时自动产出在 /var/backups/dada/）
cp /var/backups/dada/dada-<日期>.sqlite /var/lib/docker/volumes/dada-data/_data/dada.sqlite

# 3) 校验：integrity_check 必须 ok + 行数与备份日志比对
node -e "import('node:sqlite').then(({DatabaseSync})=>{const db=new DatabaseSync(process.argv[1]);console.log(db.prepare('PRAGMA integrity_check').get(),['users','posts','messages'].map(t=>t+'='+db.prepare('SELECT COUNT(*) c FROM '+t).get().c).join(' '))})" /var/lib/docker/volumes/dada-data/_data/dada.sqlite

# 4) 重启并 API 冒烟
docker compose up -d && curl -fsS http://127.0.0.1:3000/api/meta
```

本地/裸机部署等价操作：以 `DADA_DB=<新文件路径> node src/index.js` 验证后再切回。

## 备份/恢复速查（实测结论，详见 review-db-r5.md）

## 备份/恢复速查（实测结论，详见 review-db-r5.md）

```bash
# 在线备份（写入不中断，时间点一致快照）
node -e "import('node:sqlite').then(({DatabaseSync})=>{
  const db = new DatabaseSync('server/data/dada.sqlite');
  db.exec(\"VACUUM INTO '/backup/dada-\$(date +%F).sqlite'\");
});"

# 冷备份（停写后）
sqlite3_exec: PRAGMA wal_checkpoint(TRUNCATE);  # WAL 合并进主文件
cp server/data/dada.sqlite /backup/…            # 之后 cp 单文件即完整

# 禁止：WAL 运行期间只 cp dada.sqlite（实测丢掉自上次 checkpoint 后的全部写入）
```
