# 搭搭安卓端构建指南（Capacitor 6）

安卓壳工程位于 `android/`，由 `npx cap add android` 生成并完成本项目定制（状态栏/启动屏/图标/返回键）。
App 本体是 `web/public`（纯静态 SPA），通过 `capacitor.config.json` 的 `server.url` 远程加载——**壳内不打包前端代码，改前端无需重新发版**。

---

## 1. 环境要求

| 项 | 要求 |
| --- | --- |
| Android Studio | Ladybug 及以上（含 Gradle 同步支持） |
| Android SDK | Platform 34（compileSdk/targetSdk = 34，见 `android/variables.gradle`）、Build-Tools 34.x |
| JDK | 17 或 21（Android Studio 自带 JBR 即可） |
| Node.js | 20+（用于 `npx cap sync`） |

首次在 Android Studio 中打开 `android/` 目录会自动下载 Gradle 8.x（`gradle/wrapper/gradle-wrapper.properties` 已配置）与依赖，需联网。

## 2. 构建步骤

```bash
# 1) 同步 web 资源与插件配置到 android/（改了 capacitor.config.json 或增删插件后必须执行）
npx cap sync android

# 2) 用 Android Studio 打开 android/ 目录，等 Gradle sync 完成
#    （或纯命令行：cd android && ./gradlew assembleDebug）

# 3) 出包
cd android
./gradlew assembleDebug    # 调试 APK → android/app/build/outputs/apk/debug/app-debug.apk
./gradlew bundleRelease    # 发布 AAB → android/app/build/outputs/bundle/release/app-release.aab
```

调试包可直接 `adb install -r app-debug.apk` 安装真机测试（需开启 USB 调试）。

## 3. 签名（发布必做）

生成密钥（一次即可，妥善保管，丢了无法升级包）：

```bash
keytool -genkey -v -keystore dada-release.keystore -alias dada \
  -keyalg RSA -keysize 2048 -validity 10950 \
  -dname "CN=dada, OU=dada, O=dada, L=City, ST=Province, C=CN"
```

在 `android/key.properties`（已被 .gitignore 忽略，不入库）写入：

```properties
storeFile=../dada-release.keystore   # 相对 android/app/ 的路径
storePassword=你的store密码
keyAlias=dada
keyPassword=你的key密码
```

然后在 `android/app/build.gradle` 的 `android { }` 内追加：

```gradle
def keyProps = new Properties()
def keyFile = rootProject.file("key.properties")
if (keyFile.exists()) keyProps.load(new FileInputStream(keyFile))

signingConfigs {
    release {
        storeFile file(keyProps['storeFile'])
        storePassword keyProps['storePassword']
        keyAlias keyProps['keyAlias']
        keyPassword keyProps['keyPassword']
    }
}
```

并将 `buildTypes.release` 中加入 `signingConfig signingConfigs.release`。

## 4. server.url 配置（关键）

`capacitor.config.json` 当前为**占位**，改完必须重新 `npx cap sync android` 再打包：

```jsonc
"server": {
  "url": "https://dada.example.com",   // ← 改这里
  "androidScheme": "https",
  "cleartext": true                     // 注意：此项只对 iOS ATS 生效，Android 无效
}
```

### 本地演示（服务端跑在本机）

1. 启动服务端（默认 3000 端口），手机与电脑同一局域网；
2. `server.url` 改为 `http://<电脑局域网IP>:3000`（手机浏览器先访问确认能通）；
3. **Android 明文限制**：Android 9+ 默认禁止 http 明文请求，需在
   `android/app/src/main/AndroidManifest.xml` 的 `<application>` 标签上加：
   `android:usesCleartextTraffic="true"`
   （当前 manifest 未加——保持 Capacitor 默认的最小化配置；仅本地 http 演示时临时加上，发版前移除）
4. `npx cap sync android` 后重新构建安装。

### 生产

`server.url` 改为正式 HTTPS 域名（勿带尾部斜杠），manifest 无需 cleartext。

## 5. 常见问题

| 现象 | 原因与解决 |
| --- | --- |
| **首启白屏/一直白屏** | `server.url` 不通（域名未解析、服务未启动、手机无法访问该地址）。先手机浏览器打开该 URL 验证 |
| 白屏但 URL 能访问 | 本地 http 演示未加 `usesCleartextTraffic`（见上） |
| 改了前端页面 App 里没变 | 壳是远程加载，检查服务端是否发新；若改了 `web/public` 且希望壳内也更新，跑 `npx cap sync android` |
| 改了 capacitor.config.json 不生效 | 必须重新 `npx cap sync android` 并重新构建安装 |
| 返回键没反应/行为异常 | 确认已安装 `@capacitor/app` 插件且执行过 cap sync（`android/app/capacitor.build.gradle` 里能看到依赖） |
| Gradle 下载慢/失败 | 配置镜像：`android/gradle.properties` 加 `systemProp.http.proxyHost=...`，或使用国内 Gradle/SDK 镜像 |
| 状态栏颜色不对 | 在 `android/app/src/main/res/values/styles.xml` 的 `AppTheme.NoActionBar` 中 `android:statusBarColor` |

## 6. 已完成的安卓定制清单

- **状态栏**：`styles.xml` → `AppTheme.NoActionBar` 品牌色 `#FF7A45`（BridgeActivity 启动后切换至该主题）。
- **启动屏**：`drawable*/splash.png` 全密度重制——白底 + 圆角品牌 logo 居中（横屏/竖屏各密度 11 张，源 `web/public/img/icons/icon-512.png`，圆角比例 56/240 同 logo.svg）。
- **应用图标**：自适应图标（API 26+）背景 `#FF7A45` + 白色字形前景（mipmap-*dpi/ic_launcher_foreground.png，字形居中于 61% 安全区）；传统图标（API<26）圆角 tile / 圆形 tile。
- **应用名**：`res/values/strings.xml` → `搭搭`（appId `com.dada.app`）。
- **权限最小化**（合规，见 `docs/compliance-research-2026.md`）：Manifest 仅 `INTERNET`，无定位/存储/相机等未用权限；`usesCleartextTraffic` 未设置（Capacitor 默认，生产 https 不需要）。
- **软键盘**：Activity `android:windowSoftInputMode="adjustResize"`——键盘弹出时 WebView 视口压缩、底部输入框不被遮挡；`index.html` 现有 viewport（`viewport-fit=cover, maximum-scale=1, user-scalable=no`）配合即可，无需额外改动。
- **返回键**（`web/public/js/app.js` 顶部）：`window.Capacitor` 存在时注册 `App.backButton`——子页面 `history.back()` 路由后退；根页面（四 tab/登录页）2 秒内双击退出（toast“再按一次退出” + `App.exitApp()`）。浏览器环境零影响。
- **PWA 横幅**：原生壳内跳过 `beforeinstallprompt` 逻辑与 Service Worker 注册（已是安装态，注册无意义）。

## 7. 发版检查

- [ ] `versionCode`/`versionName`（`android/app/build.gradle`）递增
- [ ] `server.url` 为生产 HTTPS 域名
- [ ] Manifest 无 `usesCleartextTraffic`
- [ ] release 签名配置就绪，`key.properties` 与 `.keystore` 未入库（.gitignore 已覆盖）
- [ ] `npx cap sync android` 后构建 AAB，上传应用市场（国内市场需软著/隐私政策 URL 等资质，见 compliance 文档）
