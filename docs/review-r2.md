# 搭搭 R2：本轮迭代验收 + 性能/体验快评

> 评审人：产品经理（R2 第二职责：性能/体验快评）
> 方式：curl 直查 API + Playwright-core 实机（390×844, DPR3，chromium-1247）+ 47 条后端测试亲跑复验。
> 环境：http://localhost:3000，演示库 24 帖（feed total 实测 24），xiaoyu/123456、admin/123456。
> 测试副作用：新增 2 个已关闭测试帖（id 26/27，feed 不可见，feed 计数仍 24）；上传测试文件已删；拉黑关系已复原（blocked_by_me=false 终态验证）。

---

## 本轮验收：通过

无 P0/P1 问题，全部交付项实测命中。47 条后端测试亲跑复验：`tests 47 / pass 47 / fail 0`（2.07s）。8 步 E2E（scripts/e2e.mjs）按交付声明引用为绿，本轮未重跑（避免污染 24 帖演示库）。

### 1. BE：拉黑动作级拦截 + blocked_by_me + feed has_more + seed 通知

| 项 | 结果 | 证据（一句话） |
|---|---|---|
| 拉黑动作级拦截（点赞/评论/申请 403） | ✓ | xiaoyu 拉黑 momo 后，`POST /posts/24/like`、`/comments`、`/join` 三连发全部 403「无法与该用户互动」（curl 实测 + 专项测试"拉黑动作级拦截…均403（双向）"绿） |
| blocked_by_me 字段 | ✓ | 拉黑后帖子详情 `blocked_by_me=true`、他人主页 `=true`、游客视角恒 `false`；取消拉黑后回 `false`（curl 前后对比） |
| （附带口径正确）feed 过滤 | ✓ | 拉黑后 momo 的帖从 xiaoyu 视角 feed 消失（size=50 全量检索 filtered out） |
| feed has_more | ✓ | `page=1&size=10` → `total=24, has_more=true, list=10`；`page=3` → `false`；`size=24` → `false`（边界精确） |
| seed 预置通知 3 条 | ✓ | xiaoyu 登录 `/notifications` 返回 2 条（join_request「阿跑 申请加入」+ rating「美美 5 星评价」）；admin 返回 1 条 sos「紧急求助」且 `read=1` |
| 47 测试全绿 | ✓ | 本机复跑 `npm test`：pass 47 / fail 0 |

### 2. FE：触底分页 + canvas 压缩 + 拉黑标识

| 项 | 结果 | 证据（Playwright 390×844 实测，19/19 断言通过） |
|---|---|---|
| 广场触底分页 | ✓ | 首屏 10 张 → 连续滚动触底加载至 **24 张**且尾部渲染「没有更多了」；切「美食」分类重置为 2 张，切回「全部」恢复首屏 10 张（分页与列表重置均正确） |
| 发布图片 canvas 压缩 | ✓ | 造 5377KB 噪声 PNG（1000×1600）走发布流程，服务端落盘 **411KB JPEG、解码 750×1200**（长边 1200 钳制 + q0.75 命中），上传往返 200、详情页正常回显；压缩失败/变大回退原图的分支代码审阅在位 |
| 拉黑标识（详情页） | ✓ | 拉黑后打开对方帖：作者行灰 pill「已拉黑」×1，点赞/评论按钮 `disabled=true`，申请按钮不可用态 |
| 拉黑标识（他人主页） | ✓ | 主页灰 pill「已拉黑」+ 底部按钮切换为「取消拉黑」；点击后原地重渲染恢复「拉黑」按钮（状态闭环） |
| 通知中心有内容 | ✓ | xiaoyu 通知中心渲染「收到入搭申请-阿跑」「收到搭后评价-美美」两条预置通知（截图 /tmp/r2_notif.png） |

### 3. 编排者加修：上传目录路径 bug

| 项 | 结果 | 证据 |
|---|---|---|
| /uploads 404 修复 + 文件迁移 + 往返 | ✓ | 存量文件 `GET /uploads/post_1792379929138_ftehnc.jpg` → 200；本轮 D 组实测新发帖上传新图 → 落盘 → 浏览器回显（`img.decode()` 成功读出 750×1200），全链路往返 200 |

> 备注：R1 遗留的 H2（拉黑落地）/H5（bio 200 字）/H16（发布幂等）/H19（防双击加固）均随本轮交付关闭，专项测试在 47 条中在列。

---

## R2 性能快评（390×844 / DPR3，localhost）

### 首屏指标（广场，冷访）

| 指标 | 数值 | 评价 |
|---|---|---|
| 请求数 | 38 个 | 偏多：12 个 page JS + 3 CSS 未打包合并，HTTP/2 下可接受 |
| 传输体积 | 1157KB | 偏重：其中图片 949KB 占 82%，文本壳约 200KB |
| DOMContentLoaded | 33ms | 优（localhost 绝对值仅参考，结构信号有效） |
| load | 34ms | 优，load 早于图片完成（lazy 生效，不阻塞) |
| FCP | 60ms | 优（同上，弱网下由传输体积主导） |
| 二次访问（SW v2） | 图片 transferSize=0，DCL 24ms | 优：SW 对静态 SWR、/uploads cache-first 生效 |
| feed 首屏 JSON | 13.5KB（未压缩） | 中：size=10 合理，但无 gzip |

### 图片策略抽查

| 检查项 | 结果 | 评价 |
|---|---|---|
| 瀑布流封面 lazy | 10/10 `loading="lazy"` | ✓ 合格 |
| 封面宽高比占位 | `--ar` aspect-ratio 预留 | ✓ 无 CLS 跳动 |
| 封面解码尺寸 | natural 800px vs 显示 183 CSS px | 中：DPR3 下设备像素 549 → 1.46x 轻度过采样尚可；DPR1/2 设备浪费翻倍 |
| 头像加载策略 | `loading=auto` 10/10 全量急加载 | ✗ 未懒加载，且 200px 源显示 16px（DPR3 设备像素 48，4.2x 过采样），~14KB×10 |
| 图片资产 | 38 张实拍照共 3.1MB，均值 84KB/张 | 中：无小尺寸档，最大单张 162KB |

### 滚动流畅度（主观 + 量化代理）

| 检查项 | 结果 | 评价 |
|---|---|---|
| 连续滚动 4200px（约 3 屏+）rAF 采样 | 164 帧中 >50ms 长帧 **0** 个，最差帧 17ms | 优：无明显卡顿（软件渲染下测得，中低端真机建议复测） |
| 滚动停止后视口未加载图 | 0 张 | 优：无白块 |
| 触底 append 后 350ms 视口未加载图 | 0 张 | 优：追加页无白块，aspect-ratio 占位防跳动 |

（WS 断线重连按约定跳过。）

---

## 下轮建议（≤3 条，按优先级）

1. **图片瘦身（影响最大）**：首屏传输 82% 是图片。封面出 400px 宽缩略档（srcset/sizes 按 DPR 选档，或 seed 侧双尺寸生成）；头像出 64px 档并给瀑布流头像 img 补 `loading="lazy"`。预计首屏 -400~500KB，弱网首屏时间近半。
2. **开启 HTTP 压缩（性价比最高）**：实测服务器对 JS/CSS/API JSON/图片均无 gzip/br（curl 带 Accept-Encoding 无 content-encoding）。Express 加 `compression` 中间件一行：JS 150KB→~40KB、feed JSON 13.5KB→~3KB，全部文本资产 -70%。
3. **首屏 LCP 精修（预防性）**：瀑布流首图加 `fetchpriority="high"`、封面 img 统一补 `decoding="async"`，避免解码阻塞主线程（当前无长帧，属上真机前的保险）。
