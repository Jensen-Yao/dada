# R3性能批评（移动Web性能视角）

> 评审人：性能批评家（R3第三职责：移动Web性能）。实测环境：Playwright + Chromium 1247，视口 390×844 / DPR 3，`http://localhost:3000`，Fast3G = CDP `Network.emulateNetworkConditions`（150ms RTT / 1.6Mbps down / 750Kbps up）。种子库 24 帖，登录态 xiaoyu。测量脚本存于 `/tmp/perf-r3/`（lib/t1/t2c/t4/t4b/t4c/t5）。
> 口径说明：任务书中"17个经典script"实为 **17 个 `<script>` 标签 = 1 个内联（head 内 dada_bigfont 预挂，<1ms，不构成阻塞）+ 16 个外链经典脚本**（全部位于 body 尾，无 defer/async）。下文按"16 脚本"计量。

## R3性能批评：4项（P1明显影响/P2改进）

### [F1] 离线首访白屏：PRECACHE 缺 12 个 pages 脚本 + SW 接管时序缺口 | 实测
- `sw.js` PRECACHE 仅 9 项（`/`、3 CSS、api/ui/ws/app.js、logo.svg），12 个 `/js/pages/*.js` 不在其中。
- 首访时序缺口：pages 脚本在 DOMContentLoaded 前已被下载执行（经典脚本），而 SW 在 app.js 执行时才注册，activate+claim 发生在其后——**首访期间页面脚本的请求永远不经过 SW**，SWR 运行时缓存抓不到它们。
- 实测缓存演化：首访后 `dada-static-v2` 内 `/js/pages/*` = **0/12**；二次访问后 = **12/12**（SWR 补齐）。
- 首访后断网 reload（离线矩阵 A）：导航回退壳成功、CSS+核心JS出缓存，但 12 个 pages 脚本全部 `net::ERR_FAILED` → `App.register` 不存在 → `#page-container` 内容长度仅 24B（空白），只剩静态 tabbar。广场/发现/会话全部不可用。
- 二访后断网（矩阵 B）：广场 10 卡、发现 15 卡、会话 13 条气泡全部离线可渲染。
| 项 | 数据 |
|---|---|
| 影响面 | 首访后即离线的用户（安装 PWA 后立刻进地铁/电梯、iOS"添加到主屏幕"后首启）= **100% 白屏**；缺口窗口 = 第1次与第2次在线访问之间 |
| 量化成本 | 修复代价：首装多传 12 个脚本 ≈ **+62KB（gzip 传输口径，含响应头）**，一次性 |
| 修复方案 | `web/public/sw.js`：PRECACHE 数组补入 12 条 `/js/pages/*.js`（install 已用 `cache:'reload'`，直接生效），`VERSION` 升到 `v3` 触发旧缓存清理；可选加强：activate 后对 `clients` 广播前完成预缓存（现有 `waitUntil` 已保证） |

### [F2] 弱网首访"无内容可绘"：16 脚本把 FCP 顶到 DCL 之后，合并/分包收益估算 | 实测+估算（未实施）
实测瀑布（Fast3G，冷）：
- HTML 完成于 164ms → 16 脚本全部于 165–166ms 并行起播（preload scanner 生效，HTTP/1.1 6 连接 → 3 个波次）→ 最后一个于 992ms 完成 → **DCL 997ms，FCP 1060ms，LCP 3612ms（图片，SW屏蔽后收敛值），10 张封面到齐 6142ms**。
- localhost 冷：DCL 32ms / FCP 124ms——即便本地，FCP 仍晚于 DCL：**首帧前没有任何可绘内容**（容器空、tabbar hidden，骨架屏也是 square.js 渲染的）。脚本阶段净阻塞 = 166→997ms 共 831ms；执行仅 ~5ms，瓶颈全在传输。
- 脚本账：解码 192.3KB / 线传 81.4KB（gzip 2.6x）；SW 暖访问 DCL 26ms / FCP 84ms / 线传 0（已知项复核：SW 二访确实好，Fast3G 下 −92%）。
- 启动长任务仅 1 个 69ms，脚本执行不是瓶颈。

收益估算（按实测分量+带宽数学，未改代码）：
| 方案 | 线传 | Fast3G DCL 估算 | 相对现状 997ms |
|---|---|---|---|
| 现状（16 文件，3 波次） | 81.8KB | 997ms（实测） | — |
| 加 defer | 不变 | ≈997ms（**≈0 收益**：实测 16 脚本已于 165ms 并行起播，body 尾经典脚本与 defer 下载行为等价；执行本来就最后） | 0 |
| 合并 app-bundle.js（16合1，gzip -9 实测 60.4KB） | 60.4KB（−26%） | ≈620ms（省 2 个 RTT 波次 −300ms + 传输 −105ms） | **−377ms / −38%** |
| 路由分包（core4+square 合包，实测 18.5KB） | 18.5KB | ≈412ms | **−585ms / −59%** |

- 附带：服务器是 Node http/1.1（6 连接上限造成波次），若 deploy 层上 h2 可再削波次，但收益小于分包。
| 项 | 数据 |
|---|---|
| 影响 | 仅首访/缓存被逐出的用户：弱网首屏 +585~997ms 无内容；SW 暖用户不受影响 |
| 修复方案 | 最小：`web/public/index.html` 把 16 个 `<script>` 合并为单文件（构建脚本拼接 + `gzip -9` 实测 60.4KB，sw.js PRECACHE 同步改名，VERSION v3）。进阶：按路由分包（首屏只需 api/ui/ws/app/square），或引入 esbuild 做合成步骤 |

### [F3] `/uploads/` 用户图原样落盘直出：单卡封面最高可拖 8MB | 实测
- `server/src/routes/posts.js:37-45`：multer `fileSize: 8MB`、`diskStorage` 直写，**无任何服务端转码**；`server/src/index.js:27` 的 compression filter 明确排除 `/uploads/`（对图片正确，但意味着字节数=文件原样）。
- 实库证据：`server/data/uploads/post_1792379929138_ftehnc.jpg` 实测 **450KB** 单图；广场卡片 `UI.pinCard` 直接渲染 `images[0]` 原图（`ui.js` coverOf），无 srcset（srcset 属 roadmap 已知，此处不复报；**新账是服务端源头无转码**——roadmap #72 只有"前端 canvas 压缩"，Web 旧客户端/直传 API 不被覆盖）。
- Fast3G 下一张 8MB 图 ≈ +40s、450KB 图 ≈ +2.3s（按 1.6Mbps）。
| 项 | 数据 |
|---|---|
| 影响 | 每张用户传图最高 8MB 进入广场/详情/发现（种子数据当前未引用 uploads，故未进首屏账；一旦真实用户传图即命中） |
| 修复方案 | `server/src/routes/posts.js` 图片上传后置处理：引入 `sharp`（`await sharp(file.path).rotate().resize({width:1080, withoutEnlargement:true}).jpeg({quality:75}).toBuffer()` 覆写原路径），同法处理 `users.js` 头像（256px 方图）；8MB 上限可降至 10MB 保留+转码兜底 |

### [F4] WS 离线无限重连：30s 退避封顶但永不放弃 | 实测（代码+离线行为）
- `web/public/js/ws.js:42-46`：除 4001 外任何 close 都重连，`delay = min(30000, 1000*2^min(retry,5))`，无重试次数上限。离线矩阵实测：断网期间持续产出 `WebSocket connection failed` 错误（每 30s 一次，无限）。
- 影响：飞行模式下页面挂着 = 每 30s 一次失败连接 + 错误日志；耗电/日志噪音，弱影响。
| 项 | 数据 |
|---|---|
| 修复方案 | `ws.js` 给 retry 设上限（如 5 次后停），并监听 `window online` 事件时重置 retry 立即重连；与现有 4001 停连逻辑同处一个文件 |

## 性能合格项

1. **SW 暖访问（已知项复核）**：第 3 次访问全资源 0 线传，localhost FCP 124→80ms，Fast3G FCP 1060→**84ms（−92%）**，LCP 80ms。SWR+版本化缓存设计有效。
2. **滚动运行时**：正确滚动容器（`.page`，`app.css:65`）上 8 轮触底，翻页 10→24 卡全部加载；滚动期长任务 **0 个**（>50ms），476 帧中 >64ms 卡顿帧 **0 个**。CSS columns 瀑布流追加无主线程压力。
3. **内存稳定性（WS 泄漏修复验证通过）**：conv 页 20 次进出（`#/conv/1` ↔ `#/square`，每轮强制 gc）：JS Heap 0.97→1.05MB 后**平台期**（第 8 轮起完全走平）；Nodes 826↔1513 属 GC 波动且回落基线 826；Documents 恒为 1；监听器数走平。无单调增长，H1 页级清理（App.onCleanup）+ WS.off 修复有效。
4. **gzip**：文本资产 2.6x（JS 192.3KB→75.6KB、CSS 17.6KB→17.7KB wire、`/api/posts` 4KB）；`/img/`、`/uploads/` 正确豁免（压缩格式再压无益）。
5. **缓存头**：`/img/*` `Cache-Control: public, max-age=604800`（`server/src/index.js:40`）+ SW cache-first 双层；JS/CSS 走 ETag/304 且被 SWR 屏蔽。
6. **desktop.css 隔离**：min-width 媒体查询全部门控在该文件（2 处 @media），移动端零样式开销，只多付 2.3KB 下载。
7. **图片体积账（roadmap v2.7 已知项的量化复核，不计新账）**：
   - 首屏 10 封面（`/img/photos/*.jpg`）：naturalWidth 全部 800px，渲染 183px CSS × DPR3 = 549 物理px，**过采样比 1.46x**；线传合计 **876.9KB**（54.6–125.9KB/张），占首屏总重量 1058KB 的 **90%**。
   - 头像（`/img/avatars/photo-N.jpg`）：natural 200×200 渲染 16px CSS（48 物理px），**过采样比 4.17x**；首屏去重 5 个文件 **71.1KB**。
   - Fast3G 收敛 LCP 3612ms、图片尾 6142ms。按 roadmap v2.7"封面 400px 缩略 + 头像 64px"估算：550px 档按面积比 ≈ **−464KB**（与 roadmap 预估 −500KB 相符，成立）；落地后 Fast3G 图片尾理论 ≈2.8s。

## 离线可用性矩阵：页面 × 首次/二次 SW 缓存状态

| 页面 | 首次在线访问后离线（PRECACHE 9 项；`/js/pages/*` 0/12） | 二次在线访问后离线（SWR 补齐；12/12 + API 已缓存） |
|---|---|---|
| `/` 壳+广场 | ❌ **白屏**：12×pages 脚本 ERR_FAILED，`#page-container` 24B 空，仅静态 tabbar；`App` 路由不存在 | ✅ 10 张卡片+分类条+搜索可用，列表来自 `dada-api-v2` 缓存 |
| `#/discover` | ❌ 同上（壳在、路由死） | ✅ 15 张卡片可浏览；4 张未在线看过的封面缺失（movie/pet 的 jpg+svg 兜底都不在缓存） |
| `#/conv/1` | ❌ 同上 | ✅ 13 条消息气泡全渲染（消息 API networkFirst 命中缓存）；WS 不可用属预期 |

- SW 缓存状态明细：首访后 `dada-static-v2` = 9 预缓存项 + 15 张首屏图 + logo（图片/API 在 SW claim 之后请求，故被运行时缓存抓到）；`dada-api-v2` = 1 条 posts。二访后 = +12 pages 脚本 + `/api/meta`。
- 结论：离线能力真实存在但有一个"安装即白屏"的悬崖（F1），PRECACHE 补 12 行即可拉平。
