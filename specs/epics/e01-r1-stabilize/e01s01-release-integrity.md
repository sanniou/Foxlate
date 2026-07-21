# e01s01 — 发布完整性门禁（版本 SoT + 双目标构建）

**type:** fix  
**risk:** P1  
**bcps:** 3  
**status:** failing  

## Context

`build.js` 已从 `package.json` 注入 `manifest.version`，并按 target 改写 background。但 `public/manifest.base.json` 仍写 `1.3.0`，易误导；且无测试锁定 Chrome `service_worker` / Firefox `scripts` 形状。本故事补门禁，不改构建管线语义。

## Requirements

#### MODIFIED: 扩展版本与构建产物一致
**Before:** 仅靠 build 时覆盖；base manifest 残留 1.3.0，无自动断言。  
**After:** 测试断言 dist manifest.version === package.json.version；base 的 version 为明确占位（`0.0.0`），CONVENTIONS/注释标明由 build 注入。

#### ADDED: 双目标 background 形状门禁
**After:** Chrome 构建 manifest 含 `background.service_worker` 且无 `scripts`；Firefox 构建含 `background.scripts`。

## Zoom-out

| 模块 | 目的 | 调用方 | 契约 |
|------|------|--------|------|
| `build.js` | esbuild + 拷贝 public + 改写 manifest | npm scripts | 读 package.json.version；chrome→service_worker；firefox→scripts |
| `public/manifest.base.json` | 清单模板 | build.js | 非最终版本源 |

## Steps

1. 新增 `test/build-manifest.test.mjs`：对 chrome/firefox 各跑一次 build（或调用现有 CLI），读 dist manifest，断言 version 与 package.json 一致 → verify: `node --test test/build-manifest.test.mjs`
2. 同文件断言 background 形状（chrome service_worker / firefox scripts） → verify: `node --test test/build-manifest.test.mjs`
3. `public/manifest.base.json` version → `0.0.0`，必要时一行注释在 build.js 旁已有逻辑处保持 SoT 说明 → verify: `node -e "JSON.parse(require('fs').readFileSync('public/manifest.base.json')).version==='0.0.0'||process.exit(1)"`
4. Preflight → verify: `npm test && npm run build:firefox && npm run build:chrome`

## Verification Script (人工)

1. `npm run build:chrome` 后打开 `dist/manifest.json`，确认 `version` 为 package.json 当前版，`background.service_worker` 存在。
2. `npm run build:firefox` 后确认 `background.scripts` 存在。
3. 确认 base 文件不再显示 1.3.0。

## Out of scope

- 商店上架、签名、CI 矩阵
- 改 esbuild 打包策略

## Risks

- 测试若串行写同一 `dist/` 会互相覆盖 → 测试内顺序执行 chrome 再 firefox，或临时 outdir（优先顺序执行，少改 build）
- Windows 路径差异 → 用 path.join / 现有 build 入口

## Slopcheck

无新依赖。`[OK]`
