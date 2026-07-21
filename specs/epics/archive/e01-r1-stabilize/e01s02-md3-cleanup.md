# e01s02 — 清除 MD3 类名残留

**type:** refactor  
**risk:** P3  
**bcps:** 1  
**status:** failing  

## Context

1.6.0 已切到语义类名（`.input-group` 等）。`src/options/validator.js` 仍兼容 `.m3-form-field`，属死代码兼容壳。

## Requirements

#### REMOVED: validator 对 MD3 表单类的兼容
**Before:** 校验逻辑同时匹配 `.input-group` 与 `.m3-form-field`。  
**After:** 仅匹配 `.input-group`。`src` 下无 `m3-form-field` / `.m3-` 类选择器。

## Zoom-out

| 模块 | 目的 | 调用方 | 契约 |
|------|------|--------|------|
| `options/validator.js` | 表单字段 invalid 标记 | options 保存/校验流 | 在 `.input-group` 上挂 `is-invalid` |

## Steps

1. 删除 validator 中三处 `.m3-form-field` 选择器 → verify: `! grep -R --include='*.js' -n 'm3-form-field' src`
2. 全 `src` 扫描无 `.m3-` / `m3-button` 类残留 → verify: `! grep -R --include='*.js' --include='*.css' --include='*.html' -nE 'm3-form-field|\\.m3-|m3-button' src`
3. 全量测试 → verify: `npm test`

## Verification Script (人工)

1. 打开 options，触发一次必填校验（若有），错误态仍挂在 input-group 上。
2. 无控制台错误。

## Out of scope

- 重写 validator 架构
- 改 options HTML 结构

## Risks

- 无：HTML 已无 m3 类（已 grep 确认仅 validator）

## Slopcheck

无新依赖。`[OK]`
