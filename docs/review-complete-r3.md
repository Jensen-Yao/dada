# R3 产品完整性批评（对标小红书/大众点评/Meetup/闲鱼）

审计方法：通读 server/src 全部路由 + web/public/js 全部页面（约 6300 行），grep 逐项验证，localhost:3000 API 实测（浏览器后端不可用，改用 HTTP 实测）。

## R3完整性批评：必备缺失10项 + 加分缺失8项

### 必备（成熟组局App没有就无法长期留住用户）

[C1] 搭局编辑入口 | 半成品：后端 PUT /posts/:id 完备（标题/内容/时间/地点/要求/人数均可改，posts.js:192），前端 0 处调用（仅 status:'done'，grep 证实）| 时间地点改不了只能关帖重发，点赞评论全部归零，组局者最痛 | 详情页作者态加"编辑"入口，复用 publish 表单回填 | 小
[C2] 满员扩容闭环 | 缺失：实测 full 帖 need_count 1→2 后 status 仍 'full'，新用户加入报"已停止招募"；此前被自动婉拒的申请者也无任何回流通知 | 有人退出/扩容时局救不活，被拒者永远错过第二次机会 | PUT 扩容且 approved<need_count 时 status 回 'open'，并批量 notify 已 rejected 用户 | 小
[C3] 收藏/想参加 | 缺失：无 favorites 表、无"我的收藏"入口（grep favorite/collect/收藏 0 命中），点赞≠收藏且点赞会进对方通知 | 看到局但时间未定→点赞会骚扰帖主；下次想找找不到（闲鱼"想要"级刚需）| 新 favorites 表 + 详情页星标 + 我的页收藏 tab | 中
[C4] 通知分类与聚合 | 缺失：通知单流 LIMIT 100，无互动/系统 tab（misc.js:198）；同一帖 N 个赞=N 条（notify 每事件插一行）| 热帖作者通知被点赞刷屏，重要申请/结果被 100 条滚动丢弃 | type 分 tab（join/rating=互动，credit/warning=系统）+ 同 post 同 type 聚合计数 | 中
[C5] 密码修改/找回 | 缺失：POST /api/auth/password 实测 404；登录仅密码式，无验证码登录/忘记密码（login.js 证实）| 手机号注册却不能短信找回，忘密码=永久锁号，合规风险 | smsCodes 基础设施已有，加 code 登录分支 + PUT /auth/password | 小
[C6] 聊天图片 | 缺失：messages.type CHECK 仅 text/system/safety（db.js:155），前端无发图按钮 | 约局发不了场地截图/路线图，沟通效率低必然外流微信 | type 加 'image'，复用 multer 上传链路 + 气泡渲染 | 中
[C7] 举报进度查询 | 半成品：reports.status 存在、管理员可 resolve 并推 report_result 通知；但举报人无列表页——reportRouter GET /mine 是死代码（misc.js:5 导入未挂载，实测 404）| "已收到举报"之后黑盒，处理了也不知道为什么 | 挂载 /reports/mine + 安全中心加"我的举报"页（含 status）| 小
[C8] 搜索历史/热搜/空态推荐 | 缺失：搜索历史/热搜 grep 0 命中；空态仅通用文案"这里还没有搭局"（square.js:144），无基于搜索词的分类推荐 | 高频搜索每次重敲；搜不到时直接流失，无引导 | localStorage 存最近 10 词 + posts 按 city 聚合 top 关键词 + 空态推荐同分类开放局 | 小
[C9] 他人主页"TA正在招募的局" | 缺失：GET /users/:id 只回 recent_done（5 条已完成），开放中的局不展示（users.js:44）| 个人页这个最核心的内容分发位被浪费，从主页无法约 TA 现在的局 | 补 open posts 字段 + 主页"招募中"瀑布流（与 recent_done 同款卡片）| 小
[C10] 第三方登录 | 缺失：无微信/Apple 登录（grep 0 命中，仅注销注释提及 Apple 合规）| 注册门槛高（手机号+验证码+设密码三步），国内成熟App标配；上架 App Store 若接入任一第三方则必须补 Apple 登录 | 微信开放平台 + Sign in with Apple，auth 表加 provider/unionid | 大

### 加分（有则体验对齐一线，无则不致命）

[C11] 资料完成度引导 | 半成品：无统一完成度提示，只有零散暗示（发现页冷启动 tip、me.js"还没写简介"）| 用户不知道补头像/标签/认证能涨成搭率 | me 页顶部进度条：头像/简介/标签/城市/认证 各计权重，缺项点击直达 | 小
[C12] 他人主页兴趣标签视觉 | 已有但藏太深：tags 以灰 pill 混在搭力值/评分同一行（user.js:42），无"共同兴趣"高亮（for-you 已有 tag_overlap 算法可复用）| 看不到合拍点，错过申请动机 | tags 独立区块 + 与我的 tags 交集标橙 | 小
[C13] 共同搭子/社交证明 | 缺失：partners 表有 times 数据，但他人主页不算"你们共同搭过的搭友" | 熟人背书是组局App最强信任信号，白白浪费 | /users/:id 补 common_partners（partners 表自连接）| 小
[C14] 分享海报 | 缺失：分享仅 navigator.share/复制链接（post.js:170），无 canvas 海报（grep 证实）| 站外拉新无物料，帖子在微信里只是裸链 | canvas 合成封面+标题+时间地点+小程序码 | 中
[C15] 会话置顶 | 缺失：conversations 无 pinned 列，仅按 last_msg_at 排序（chat.js:42）| 重要搭子被新消息冲掉 | 加 pinned 列 + 长按菜单置顶 | 小
[C16] "对方正在输入" | 缺失：WS 仅 auth/chat/ping 三种帧（index.js:116-172）| 实时感弱，等待焦虑 | WS typing 帧 + 输入栏状态条（节流 3s）| 小
[C17] 夜间免打扰 | 缺失：设置页仅推荐开关+大字模式（misc.js:311）| 深夜申请/点赞轰炸 | 设置开关 + notify 时段静默（仍入站不推 WS）| 小
[C18] 搜索排序与筛选持久化 | 半成品：最新/热门切换已有但藏在分类条尾部 pill（square.js:73），搜索态无相关度排序；筛选条件刷新即丢（仅 city 可从 URL 读，无入口写入）| 搜"火锅"按热门排，匹配词的帖沉底 | keyword 态切换相关度（LIKE 命中位置加权）；筛选同步到 hash query | 小

## 判断合格的部分

- 满员自动婉拒剩余 pending 并通知、搭局完成婉拒（R1 批评已修，posts.js:349-356）
- 通知深链详情页、5 秒延迟已读、全部已读（misc.js:247）
- 搭后互评→搭力值→搭友沉淀（partners）全闭环，老搭子推荐加权
- 拉黑双向过滤贯穿 feed/评论/聊天/互动动作，个人页"已拉黑"标识与解除入口齐全
- 聊天安全：破冰话题卡、已读回执、涉资诈骗警示条、首条消息安全提示、气泡长按举报
- 注销账号流程合规（输入 DELETE 二次确认、资料清空、手机号释放、登录明确拒绝）
- 个性化推荐关闭开关（算法备案要求）+ 冷启动降级热门，发现页职责（为你而设/城市热门）与广场（分类列表/搜索）分工基本清晰
- 搜索服务端 LIKE 已防注入（参数化），广场触底加载/竞态丢弃实现扎实
