#!/usr/bin/env bash
# ============================================================
# Chrome 扩展打包脚本
# 用途：把扩展运行所需文件打包成可直接提交商店的 zip
# 策略：白名单（只打入 manifest 引用到的文件，避免 docs/设计稿/源码说明混入）
# 用法：./pack.sh           # 输出 dist/api-proxy-ws-tool-<version>.zip
#       ./pack.sh --clean   # 仅清空 dist/ 后退出
# ============================================================
set -euo pipefail

# ---- 路径与变量 ----
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$PROJECT_DIR/manifest.json"
DIST_DIR="$PROJECT_DIR/dist"

# 从 manifest.json 读取版本号（依赖 jq）
if ! command -v jq >/dev/null 2>&1; then
  echo "错误：未安装 jq，请先安装（macOS: brew install jq）" >&2
  exit 1
fi
VERSION="$(jq -r '.version' "$MANIFEST")"
if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
  echo "错误：无法从 manifest.json 读取 version 字段" >&2
  exit 1
fi

ZIP_NAME="api-proxy-ws-tool-${VERSION}.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"
BUILD_DIR="$DIST_DIR/build"

# ---- 白名单：只打包扩展运行必需的文件 ----
# 依据 manifest.json 引用关系整理，新增文件请同步加到此列表
FILES=(
  "manifest.json"
  "sw.js"
  "popup.html"
  "popup.js"
  "options.html"
  "options.js"
  "devtools.html"
  "devtools.js"
  "devtools-panel.html"
  "devtools-panel.js"
  "ws-hook-source.js"
  "rules-model.js"
  "mock-inject.js"
  "mock-bridge.js"
  "_locales/zh_CN/messages.json"
  "_locales/en/messages.json"
  "icons/icon16.png"
  "icons/icon32.png"
  "icons/icon48.png"
  "icons/icon128.png"
)

# ---- 清理 ----
rm -rf "$DIST_DIR"
if [ "${1:-}" = "--clean" ]; then
  echo "已清空 $DIST_DIR"
  exit 0
fi

mkdir -p "$BUILD_DIR/icons"

# ---- 校验 + 复制白名单文件 ----
echo "==> 打包版本：$VERSION"
echo "==> 校验白名单文件是否存在..."
for f in "${FILES[@]}"; do
  if [ ! -f "$PROJECT_DIR/$f" ]; then
    echo "错误：白名单文件不存在 -> $f" >&2
    exit 1
  fi
done

echo "==> 复制文件到临时构建目录..."
for f in "${FILES[@]}"; do
  # 保持目录结构（icons/ 下的文件需要子目录）
  mkdir -p "$BUILD_DIR/$(dirname "$f")"
  cp "$PROJECT_DIR/$f" "$BUILD_DIR/$f"
done

# ---- 校验 zip 内不包含被排除的内容 ----
echo "==> 校验构建目录内容..."
EXCLUDED=("docs" ".git" "README.md" "README_EN.md" "pack.sh" ".gitignore")
for item in "${EXCLUDED[@]}"; do
  if [ -e "$BUILD_DIR/$item" ]; then
    echo "警告：构建目录中意外包含 $item，正在移除..." >&2
    rm -rf "$BUILD_DIR/$item"
  fi
done

# ---- 打包 zip ----
echo "==> 生成 zip：$ZIP_PATH"
cd "$BUILD_DIR"
# 用 -r 递归，-X 排除额外文件属性（macOS 上避免 __MACOSX）
zip -r -X "$ZIP_PATH" . -x "*.DS_Store" >/dev/null
cd "$PROJECT_DIR"

# ---- 清理临时构建目录，只保留 zip ----
rm -rf "$BUILD_DIR"

# ---- 输出汇总 ----
echo "==> 打包完成"
echo "    产物：$ZIP_PATH"
echo "    大小：$(du -h "$ZIP_PATH" | cut -f1)"
echo "    内容清单："
unzip -l "$ZIP_PATH" | sed 's/^/      /'
