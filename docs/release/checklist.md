# 搭搭 · 上架前自查清单

> 使用方式：每完成一项勾选 `[x]`。分四节：技术就绪 → 合规材料 → 商店素材 → 审核应对。
> 与本仓库实际状态强对应的项已标注（✅ 已具备 / ⚠️ 待办），未标注的为上架动作项。

## 一、技术就绪

- [ ] `cd server && npm test` → 23 个测试全绿（回归基线，见 docs/product-spec.md §C3）
- [x] H5 全功能回归：广场/发布/审批/聊天/互评/搭力值/安全中心/后台闭环（v2.0 已验收）
- [x] PWA 就绪：`/manifest.json`、`sw.js`、安装横幅、iOS meta（README「多端打包指南」）
- [ ] capacitor.config.json 的 `server.url` 从占位 `https://dada.example.com` 改为生产域名（⚠️ 当前为占位，scripts/build-android.sh 已内置该检查）
- [ ] `cleartext: true` 在正式 https 域名下发版前收回（README 注意事项）
- [x] 应用图标全套已生成：icon-192/512/180/maskable（scripts/gen-icons.mjs 产物已入库）
- [ ] Android 原生工程图标/启动屏替换：`npx @capacitor/assets generate --iconBackgroundColor '#FF7A45'`（首次 `npx cap add android` 后执行）
- [ ] 正式签名：keystore 生成 + `android/app/build.gradle` signingConfig（密码不入库）
- [x] 截图回归基线：390×844 与桌面端双视口脚本（scripts/shoot-both.mjs）
- [ ] 发布版数据重置：`rm server/data/dada.sqlite* && cd server && node src/seed.js`，演示数据丰富且无测试残留（⚠️ 提审前重跑）
- [ ] 生产部署：Node 22.5+ 单机 + HTTPS（WSS 聊天必需）+ 域名解析；`/ws` 反代确认不缓冲
- [ ] Service Worker 与新版发布策略确认：缓存版本号升级避免老用户加载旧静态资源

## 二、合规材料

- [x] 隐私政策页已上线可访问：`#/legal/privacy`（web/public/js/pages/legal.js，注册即达、无需登录）
- [x] 用户协议页已上线可访问：`#/legal/terms`（含产品定位/账号规则/内容规范/见面安全免责/知识产权/变更终止）
- [x] 注册页有协议提示：登录页按钮下方「注册即代表同意《用户协议》与《隐私政策》」可点击跳转（web/public/js/pages/login.js）
- [ ] 协议/政策占位信息替换：域名、privacy@/support@ 邮箱、运营主体（当前 Jensen-Yao 占位）、生效日期
- [ ] 隐私政策静态镜像页可被爬虫抓取（hash 路由页部分审核机读不到，导出 `/legal/privacy.html`）
- [x] 举报与封禁机制说明：用户协议第三条（警告→累计 3 次违规自动封号）+ 安全中心社区公约 + 运营后台举报队列（警告/封禁/下架/驳回）
- [x] 未成年人保护条款：14 岁以下不可用、未成年需监护人同意（隐私政策第六条）
- [x] 搭力值/举报数据说明：隐私政策第七条 + 用户协议第四条（加减分规则与服务器 util.js 实现一致：认证+30/+50、完成+20、好评+10、差评-15、被举报-20、<300 禁发布）
- [ ] 域名 ICP 备案完成（android-stores.md §4）
- [ ] 工信部 App 备案完成，备案号展示在 App「设置→关于」
- [ ] 公安联网备案（上线后 30 日内，beian.mps.gov.cn）
- [ ] 软件著作权：登记或拿到受理通知书（应用宝必须，见 android-stores.md §3）
- [ ] 算法备案 + 安全评估计划排期（UGC 社交类必做，android-stores.md §5）
- [ ] 实名制升级排期：注册改为手机号+验证码（社交类审核常见要求，android-stores.md §5.3）
- [ ] 权限声明与实际一致：网络必需；相册/相机仅上传时触发；未用定位则不声明

## 三、商店素材

- [x] 6.5 寸截图（1284×2778）已生成：`node scripts/store-shots.mjs` → docs/release/store-shots/6.5-*.png（广场/详情/聊天/我的/发布 5 张带说明条）
- [ ] 5.5 寸截图（1242×2208）：`node scripts/store-shots.mjs --size 5.5`（App Store 仍要求该档位）
- [ ] 国内商店版截图（无装饰包装的 390×844@3x 原图）：`node scripts/store-shots.mjs --raw`
- [ ] 商店文案定稿：名称/副标题/5 段式描述/关键词（docs/release/appstore.md §1–§3 已给稿）
- [ ] 五店简介 50 字/200 字两版定稿（docs/release/android-stores.md §1 已给稿）
- [ ] 年龄分级问卷答案确认：UGC=是 → 17+，不为过审虚报（appstore.md §5）
- [ ] App Privacy「营养标签」逐项确认（appstore.md §6）
- [ ] 应用图标 1024×1024（App Store 用，可由 gen-icons.mjs 输出放大版）与五店 512×512 就位
- [ ] 预览视频（可选）：录 15–30s「发布搭局→报名→聊天→互评」流程

## 四、审核应对

- [x] 演示账号可用且资料丰富：xiaoyu/123456（普通）、admin/123456（管理员）（README + seed.js）
- [ ] 审核备注已填写：演示账号 + 建议测试路径 + UGC 审核机制说明（appstore.md §7 模板）
- [ ] 举报响应值守：上架后 24h 内有人处理举报队列（App Store UGC 问卷「24 小时响应」为如实作答项）
- [ ] 敏感词演示自测通过：发布含导流/涉诈话术的内容被拦截、聊天发「加微信」被打码、首条消息带安全提示
- [ ] 封禁机制演示自测通过：admin 后台可对用户警告/封禁/解封，被举报扣搭力值
- [ ] SOS 自测通过：安全中心发起 SOS → admin 收到通知
- [ ] 拒审预案：常见拒审点（隐私政策不可达 / UGC 审核说明不清 / 权限用途不一致 / 实名缺失）与对应补救材料已备
- [ ] 被拒后 48h 内可复提：截图、说明文案、账号数据随时可重置回演示态
- [ ] 各店资料一致性最终核对：权限用途、隐私政策 URL、演示账号三处逐字一致（android-stores.md §2 底注）
