#!/usr/bin/env bash
#
# 生成 Firefox 上架所需的三个产物。
#
#   dist/firefox/foxlate-<version>.zip              商店包（manifest + 代码资源，含已打包的 franc）
#   dist/firefox/foxlate-<version>-source.zip       源码包（人可读的 src/，不含任何第三方打包产物）
#   dist/firefox/AMO-SUBMISSION.txt                 上架信息（slug、版本、文件路径、校验和）
#
# 关键约束：商店包里的 franc.bundle.mjs 是 esm.sh 生成的机器代码，AMO 评审员无法审阅，
# 因此它必须出现在源码包里（以「构建产物 + 获取方式」的形式），否则会因「不可审阅代码」被拒。
#
# 用法：npm run package:firefox
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

VERSION=$(node -p "require('./package.json').version")
OUT="$ROOT/dist/firefox"
SHOP="$OUT/foxlate-$VERSION.zip"
SOURCE="$OUT/foxlate-$VERSION-source.zip"
INFO="$OUT/AMO-SUBMISSION.txt"

# --- 1. 商店包 -----------------------------------------------------------------
echo "▸ 构建 Firefox 产物"
npm run --silent build:firefox

# 构建产物必须自洽：manifest 版本 == package.json 版本（构建期注入，这里做交付前复核）
MANIFEST_VERSION=$(node -p "require('./dist/manifest.json').version")
if [ "$MANIFEST_VERSION" != "$VERSION" ]; then
    echo "✗ manifest 版本 $MANIFEST_VERSION != package.json 版本 $VERSION" >&2
    exit 1
fi

# 工程文件不得混入商店包（414 KB 的 .psd 曾被打进过发布包）
if find dist -name '*.psd' -o -name '*.ai' -o -name '*.xcf' | grep -q .; then
    echo "✗ 商店包目录里发现设计源文件" >&2
    find dist \( -name '*.psd' -o -name '*.ai' -o -name '*.xcf' \) >&2
    exit 1
fi

mkdir -p "$OUT"
rm -f "$SHOP" "$SOURCE"

echo "▸ 打包商店包"
# manifest.json 必须在 zip 根目录；显式列出顶层条目，避免把 dist/ 下的中间产物带进来。
(cd dist && zip -qr "$SHOP" manifest.json \
    background content common icons lib options popup _locales \
    -x '*.map' '*.DS_Store')

# --- 2. 源码包 -----------------------------------------------------------------
echo "▸ 打包源码包"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

# 随包发一份源码，让评审员在无网络环境下也能走完构建。
mkdir -p "$STAGE/src"
cp -R src/. "$STAGE/src/"
cp -R public "$STAGE/public"
cp -R scripts "$STAGE/scripts"
cp -R test "$STAGE/test"
cp build.js package.json package-lock.json CONVENTIONS.md README.md "$STAGE/"
cp specs/verifications/full-refactor-review-1.7.4.md "$STAGE/REFACTOR-NOTES.md" 2>/dev/null || true

# 以 esm.sh 生成的机器代码不属于「源码」，但评审员需要它来复现构建，因此单独放一份
# 并附获取方式；正式源码包里不含它。
mkdir -p "$STAGE/build-artifacts"
cp src/lib/franc.bundle.mjs "$STAGE/build-artifacts/" 2>/dev/null || true

cat > "$STAGE/BUILD.md" <<'BUILDMD'
# 从源码构建

```bash
npm ci
npm run build:firefox   # 产出 dist/，与上架包内容一致
npm test                # 全量测试
```

构建产物 `dist/` 的结构与上架包一一对应。

## 关于 `build-artifacts/franc.bundle.mjs`

上架包里的 `lib/franc.bundle.mjs`（约 355 KB）由 `esm.sh` 打包生成，是机器代码。
构建脚本 `build.js` 中 `LIBS_TO_CHECK` 的入口会在 `npm run check` 时从
`https://esm.sh/franc@<version>/edge` 重新下载它。

按 AMO 对「不可审阅代码」的要求，这里附上构建时使用的同一份产物，便于对照。
若不希望依赖网络，可将其复制到 `src/lib/franc.bundle.mjs` 后再执行构建 —— 结果与上架包一致。

除该文件外，`src/` 下的全部代码均为手写、可读的源码。
BUILDMD

# 排除任何构建产物与依赖目录，源码包只装人能读的东西。
(cd "$STAGE" && zip -qr "$SOURCE" . \
    -x 'node_modules/*' 'dist/*' '.git/*' '*.log' '*.DS_Store')

# --- 3. 上架信息 ---------------------------------------------------------------

cat > "$INFO" <<INFO
Foxlate ${VERSION} — Firefox (AMO) 上架信息
生成时间：$(date -u '+%Y-%m-%dT%H:%M:%SZ')
生成方式：npm run package:firefox（scripts/package-firefox.sh）

【1】商店页面 / 详情页
  提交入口：https://addons.mozilla.org/developers/addon/submit/distribution
  已有条目（更新版本走这里）：https://addons.mozilla.org/developers/addons/
  扩展 ID：foxlate@sanni（写在 public/manifest.base.json 的 browser_specific_settings.gecko.id，与已有条目绑定）

【2】上传插件包（已构建、可直接上传）
  $(cd "$OUT" && realpath "$SHOP")
  大小：$(du -h "$SHOP" | cut -f1)
  SHA-256：$(shasum -a 256 "$SHOP" | cut -d' ' -f1)

【3】上传源码包（AMO 要求：包内含压缩/机器生成代码时须提供）
  $(cd "$OUT" && realpath "$SOURCE")
  大小：$(du -h "$SOURCE" | cut -f1)
  SHA-256：$(shasum -a 256 "$SOURCE" | cut -d' ' -f1)

  为什么需要源码包：商店包里的 lib/franc.bundle.mjs 是 esm.sh 生成的压缩代码，
  不可直接审阅。源码包内 BUILD.md 说明了它的来源与获取方式。

【提交时的其它填写项】
  许可证：MIT（见 package.json）
  隐私政策：扩展仅在本机处理文本；翻译文本会发送到用户自选的翻译服务
    （Google / DeepLX / 用户自配 AI）。无遥测、无自建服务器。
  数据收集声明：不收集（none），填写时逐项选 NO。
INFO

echo
echo "✓ 完成"
echo
sed -n '1,200p' "$INFO"