调研完成，以下为结构化报告。

# 搭子社交App（UGC+陌生人社交+私信+推荐流）2025-2026 合规上架调研报告

## 一、上架硬门槛清单（按商店）

**国内安卓（华为/小米/OPPO/vivo/应用宝）通用硬门槛**
1. 软著：《计算机软件著作权登记证书》或APP电子版权证书——华为明示“非必选但强烈建议”，小米/OPPO/vivo/应用宝普遍要求，且软著名、APP备案名、应用名需一致（[华为资质审核政策](https://developer.huawei.com/consumer/cn/doc/80301)、[腾讯云开发者综述](https://developer.cloud.tencent.com/article/2722618)）
2. ICP备案（官网）+ APP备案号：工信部2023年8月起强制，未备案不得分发（[华为APP核准备案](https://developer.huawei.com/consumer/cn/doc/app/50130)、[腾讯云综述](https://developer.cloud.tencent.com/article/2722618)）
3. **社交类专项：安全评估报告**——依据《具有舆论属性或社会动员能力的互联网信息服务安全评估规定》，私信/评论/群组/举报等互动功能即触发“舆论属性”认定；须在全国互联网安全管理服务平台提交且状态为【通过】，OPPO明确“待现场检查/整改”状态直接驳回（[网信办原文](https://www.cac.gov.cn/2019-03/20/c_1124259405.htm)、[小米上传指引](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1347)、[OPPO从业资质规范](https://open.oppomobile.com/new/developmentDoc/info?id=12133)）
4. **算法备案**：含推荐流即触发，小米FAQ明确“安全报告、算法备案是必须的”，10个工作日内经网信办算法备案系统办理（[小米资质FAQ](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2251)、[算法备案系统](https://beian.cac.gov.cn)）
5. 隐私政策可访问URL（说明收集目的/内容/方式/范围）、权限最小化、SDK清单披露；部分市场对社交/直播类另要求等保2.0测评（[腾讯云综述](https://developer.cloud.tencent.com/article/2722618)）
6. vivo要求个人开发者资质本人持有（[vivo审核规范](https://dev.vivo.com.cn/wap/documentCenter/doc/12)）；经营性功能（会员/付费）需ICP许可证而非仅备案（[华为政策](https://developer.apple.com/cn/app-store/review/guidelines)同源：[华为80301](https://developer.huawei.com/consumer/cn/doc/80301)）

**App Store（Apple）**
1. 账号删除：5.1.1(v)——支持注册的App必须在App内提供删除入口，不得只引流客服/网页（[审核指南](https://developer.apple.com/cn/app-store/review/guidelines)、[2022-06-30生效公告](https://developer.apple.com/cn/news/?id=12m75xbj)）
2. UGC防护：1.2——必须具备内容过滤、举报机制、违规用户取消资格（封号）、公布联系方式；主要用途为“随机或匿名聊天”直接拒审（[审核指南](https://developer.apple.com/cn/app-store/review/guidelines)）
3. 隐私政策：5.1.1(i)——App Store Connect元数据与App内均须有“可轻松访问”的链接，且须说明撤回同意与请求删除的方式（[审核指南](https://developer.apple.com/cn/app-store/review/guidelines)）
4. 年龄分级：无“社交=17+”硬规则，由分级问卷决定；陌生人随机匹配/匿名聊天类内容答“是”即17+；图标截图须保持4+（2.3.8）（[审核指南](https://developer.apple.com/cn/app-store/review/guidelines)）
5. 中国大陆区：须在App Store Connect填写经核验的ICP备案号，App信息（名称/开发者）须与备案信息一致（[App Store Connect帮助](https://developer.apple.com/cn/help/app-store-connect/reference/app-information/app-information)）
6. 以2025年11月更新版指南为准（含1.2.1(a)新增年龄限制机制阐释）（[更新公告](https://developer.apple.com/cn/news/?id=ey6d8onl)）

## 二、法规功能映射表（条款 → 功能点）

| 法规条款 | 必须具备的功能点 |
|---|---|
| 《网络安全法》第24条（[原文](https://www.cac.gov.cn/2016-11/07/c_1119867116_2.htm)） | 手机号+验证码注册（间接实名，私信/信息发布服务强制），纯用户名注册不合规 |
| 《个人信息保护法》第15/47条（[全文](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)） | 设置页“撤回同意”“注销账号（删除个人信息）”入口，不得设不合理条件 |
| 《个人信息保护法》第6/17条 | 隐私政策含个人信息清单（收集项/目的/方式/范围），最小必要授权 |
| 《个人信息保护法》第31条 | 14岁以下需监护人同意+专门儿童规则；注册须有年龄声明/确认步骤 |
| 《算法推荐管理规定》第17条（[原文](https://www.cac.gov.cn/2022-01/04/c_1642894606364259.htm)） | 设置页“个性化推荐”关闭开关（或提供非个性化选项），关闭后立即生效 |
| 《算法推荐管理规定》第24条 | 有舆论属性+算法推荐须算法备案并在App内展示备案编号 |
| 《移动互联网应用程序信息服务管理规定》（2022修订）第十条（[原文](http://www.cac.gov.cn/2022-01/05/c_1642983962594050.htm)） | 便捷投诉举报入口+受理反馈机制；对违规用户警示/限功能/封号并留痕上报 |
| 《网络数据安全管理条例》(2024)（[解读](https://shanghai.dacheng.com/Party_2/934.html)） | 注销账号、删除个人信息、撤回同意三项功能 |
| 《未成年人网络保护条例》(2024施行)（[原文](https://www.cac.gov.cn/2023-10/24/c_1699806932316206.htm)） | 未成年人模式（内容过滤+时长限制+家长监护工具），社交类需分龄设计 |
| Apple 1.2 / 5.1.1(v)（[指南](https://developer.apple.com/cn/app-store/review/guidelines)） | 过滤+举报+封禁+联系方式四件套；App内删除账号；mute/拉黑为实践必备 |
| 舆论属性安全评估规定（[原文](https://www.cac.gov.cn/2019-03/20/c_1124259409.htm)） | 新增私信/群组等互动功能上线前须安全评估，配合网安现场检查 |

## 三、搭搭现状差距分析

| 现状 | 合规结论 |
|---|---|
| 用户名+密码注册，无手机号 | **不合规（P0）**：私信+UGC属网安法24条“即时通讯/信息发布”范围，必须手机号实名；安卓商店审核也会卡实名功能 |
| 设置页无注销 | **不合规（P0）**：同时违反PIPL 47条、Apple 5.1.1(v)（直接拒审）、网络数据安全管理条例 |
| “为你推荐”无关闭开关 | **不合规（P0）**：违反算法推荐规定第17条；且推荐流触发算法备案义务（现未备案属无证运营推荐算法） |
| 隐私政策hash路由 #/legal/privacy | **风险（P1）**：Apple要求“可轻松访问”URL、安卓市场要求可抓取的隐私政策网址；hash路由无法被商店爬虫/审核机访问，须改服务端渲染静态路径 |
| 有举报/拉黑/敏感词过滤 | 部分满足Apple 1.2，缺：mute（静音）、封号/禁言处置流、App内公布联系方式；举报入口需满足“便捷”标准（App管理规定第10条） |
| 注册无年龄门槛确认 | **风险（P0/P1）**：无年龄声明则无法执行PIPL 31条监护人同意与未成年人模式触发逻辑；陌生人社交内容风险高，宜18+或强年龄确认 |

## 四、落地优先级建议

**P0（法定必须，不做即违法/直接拒审）**
1. 注册改手机号+验证码（网安法24条）；同步加注册时年龄确认勾选（≥18岁或14+监护人流程）
2. 设置页新增“注销账号”（清数据、冷静期提示），复用同一入口提供“撤回同意/删除个人信息”
3. 设置页新增“个性化推荐”开关，关闭后推荐流降级为时间序/热门流；办理算法备案（beian.cac.gov.cn）与安全评估（全国互联网安全管理服务平台，周期长，立即启动）
4. APP备案+ICP备案（上架前置，2023年8月起强制）

**P1（商店审核必需）**
5. 隐私政策改为静态可访问路径（如 /legal/privacy 服务端渲染），补个人信息清单、SDK清单、未成年人条款、联系方式；App内“关于”页展示ICP备案号+算法备案号
6. 补齐UGC四件套缺口：mute静音、封禁/禁言处置后台、App内联系方式；敏感词过滤扩展至私信（搭子类涉黄暗语如“纯绿/半绿”等，见[川观新闻](https://www.ql1d.com/general/28213764.html)）
7. 软著申请（名称与APP备案一致）；若后期加付费/会员需ICP许可证
8. Apple侧：App Store Connect填ICP备案号、分级问卷如实作答（随机匹配类问题答“是”会17+，需产品定位权衡）

**P2（加分/降风险）**
9. 私信内置反诈风险提示（首次私信、含转账/加微信关键词时弹警示）——搭子赛道已被媒体曝光为引流/杀猪盘入口（[凤凰网](https://feng.ifeng.com/c/8xIWPkxiJ8Q)、[北京日报](https://xinwen.bjd.com.cn/content/s68ba5ee1e4b02424b0bfc815.html)），公安部2025年监测2.7万款涉诈App并推送风险提醒（[公安部通报](http://www.scio.gov.cn/xwfb/bwxwfb/gbwfbh/gab/202606/t20260618_995239.html)），“清朗”系列持续覆盖社交乱象（[网信办专栏](https://www.cac.gov.cn/wxzw/qinglang/A093711index_1.htm)）
10. 青少年模式（内容过滤+时长限制），家长监护工具；搭子高频雷同账号风控盯防

**关键结论**：该赛道无独立命名的“陌生人社交专项新规”，监管压力来自“清朗”系列+公安反诈+舆论属性安全评估三条线；当前最大缺口是实名（手机号）、注销、推荐开关三项P0，均为上线前不可绕过的硬门槛，且安全评估与算法备案审批周期长（建议预留1-2个月），应最先启动。