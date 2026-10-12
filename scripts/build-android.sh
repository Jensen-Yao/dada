#!/usr/bin/env bash
# 搭搭 · Android 打包前置脚本
# 职责：占位域名检查 → 依赖安装 → cap sync → 给出 Android Studio / gradle 出包指引。
# 本仓库交付"可打包工程"：无 Android SDK 的环境不出包，android/ 缺失时提示先 npx cap add android。
# 用法：./scripts/build-android.sh [--yes]   # --yes 跳过占位域名确认（CI 用）
set -euo pipefail
cd "$(dirname "$0")/.."

YES=0
for a in "$@"; do [ "$a" = "--yes" ] && YES=1; done

echo "==> ① 检查 capacitor.config.json"
if grep -q 'example\.com' capacitor.config.json 2>/dev/null; then
  echo "⚠️  server.url 仍为占位域名 https://dada.example.com"
  echo "    真机包会加载这个地址，打包前请改为："
  echo "      · 生产：https://<你的正式域名>"
  echo "      · 局域网演示：http://<局域网IP>:3000（需保持 cleartext: true）"
  if [ "$YES" -eq 1 ]; then
    echo "    （--yes 已确认，继续构建——产物仅用于商店审核演示/内部测试）"
  else
    read -r -p "    确认仍要继续构建？输入 YES 继续：" CONFIRM
    [ "$CONFIRM" = "YES" ] || { echo "已取消。请修改 server.url 后重试。"; exit 1; }
  fi
else
  echo "    server.url 已配置为生产地址：$(node -p "require('./capacitor.config.json').server.url")"
fi
# 上线前提醒：https 域名下应收回明文开关
if grep -q '"cleartext"[[:space:]]*:[[:space:]]*true' capacitor.config.json && grep -q 'https://' capacitor.config.json && ! grep -q 'example\.com' capacitor.config.json; then
  echo "    提醒：正式 https 域名下发版前建议将 cleartext 改为 false。"
fi

echo "==> ② 检查依赖"
cap_ok() { npx --no-install cap --version >/dev/null 2>&1; }
if ! cap_ok; then
  if [ ! -d node_modules ]; then
    echo "    node_modules 不存在，执行 npm i ..."
  else
    echo "    node_modules 存在但缺少 Capacitor 工具链，补装依赖 ..."
  fi
  npm i --no-audit --no-fund
fi
if ! cap_ok; then
  echo "❌ 依赖安装后仍找不到 @capacitor/cli，请手动执行："
  echo "     npm i -D @capacitor/cli && npm i @capacitor/core @capacitor/android"
  exit 1
fi
echo "    Capacitor CLI $(npx --no-install cap --version 2>/dev/null | head -1) 就绪"

echo "==> ③ 检查 android/ 平台工程"
if [ ! -d android ]; then
  echo "❌ android/ 平台工程不存在（本仓库按约定不提交平台目录）。"
  echo "   请先执行一次："
  echo "     npx cap add android"
  echo "   生成后可执行：npx @capacitor/assets generate --iconBackgroundColor '#FF7A45' 替换图标/启动屏"
  echo "   然后重新运行本脚本完成同步与出包。"
  exit 1
fi

echo "==> ④ 同步 web 资源与插件（npx cap sync android）"
npx cap sync android

echo "==> ⑤ 出包指引（本环境无 Android SDK，不执行 gradle）"
cat <<'EOF'
同步完成 ✅  接下来任选其一出包：

  A. Android Studio（推荐）：
       npx cap open android
       菜单 Build → Generate Signed Bundle / APK → 按 GUI 走签名流程

  B. 命令行（需 JDK 17 + Android SDK）：
       cd android
       ./gradlew bundleRelease     # AAB → android/app/build/outputs/bundle/release/
       ./gradlew assembleRelease   # APK → android/app/build/outputs/apk/release/

  签名（一次性）：
       keytool -genkey -v -keystore dada.keystore -alias dada -keyalg RSA -keysize 2048 -validity 10000
       keystore 放 android/app/，并在 android/app/build.gradle 的 signingConfigs 配置；
       密码建议放 ~/.gradle/gradle.properties，切勿提交仓库。

  上架去向：
       国内五商店（华为/小米/OPPO/vivo/应用宝）上传 APK；Google Play 上传 AAB。
       材料与备案要求见 docs/release/android-stores.md，上架自查见 docs/release/checklist.md
EOF
