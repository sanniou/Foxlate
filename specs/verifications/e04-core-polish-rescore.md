# e04 Core Polish — 复审打分（10 分制）

**Date:** 2026-07-22  
**Branch:** feat/e04-core-polish  
**Tests:** 87 pass · Preflight builds green

## 完成门槛

各维 ≥ **7.5** 且整体 ≥ **8.0** → 核心打磨可停。

## 分数演进

| 维度 | 改前 | R1 | R2 | R3 |
|------|------|----|----|-----|
| 产品·默认路径 | 4 | 7.5 | 8.5 | **8.5** |
| 产品·规则可达 | 5 | 7.0 | 8.0 | **8.5** |
| 产品·入口收敛 | 4 | 5.0 | 6.5 | **7.5** |
| 开发·策略契约 | 5 | 7.5 | 8.0 | **8.0** |
| 开发·可测性 | 6 | 8.0 | 8.5 | **8.5** |
| 开发·文档一致 | 3 | 8.0 | 8.0 | **8.0** |
| UI·显示可发现 | 4 | 8.0 | 8.0 | **8.0** |
| UI·面板 | 5 | 7.0 | 7.5 | **7.5** |
| UI·状态反馈 | 4 | 6.5 | 7.5 | **7.5** |
| **整体** | **4.5** | **7.2** | **7.9** | **8.1** |

## 判定

**核心打磨完成（8.1 ≥ 8.0，最低维 7.5）。**

## 本 epic 交付清单

### R1 — 默认可读 + 模式可发现
- 默认 `displayMode: replace`
- 收紧 content selector（去裸 div）；exclude 壳层 nav/footer/aside/roles + code
- Popup 显示模式三段 segmented；站点保存提示
- 快选 `clampPanelPosition`；按钮对齐 fox token
- 三策略 `foxlate-state-*` class
- README/Options 内置预检叙事

### R2 — 规则/回退/入口说明
- 任意 popup 规则写入 → 脚注切 hostname
- 首选 selector 空 → 一次性 FALLBACK（section/div）
- append 错误同步 title
- glossary footer 芯片
- Options 选区入口说明

### R3 — 过线 polish
- 规则指示 `站点 · hostname`
- Popup 主按钮下选区微提示（快选 · 右键 · Alt+S）

## 刻意未做（YAGNI）

- 合并 content 三套 token 前缀
- 砍掉右键/快捷键（仅标明主次）
- Options 8 导航重做
- 新显示模式 / PDF / 新引擎 / 商店

## 后续可进 backlog（非阻塞）

- 空结果时 toast「已用宽松选择器」
- 快选次按钮「复制译文」
- 策略错误视觉完全像素级统一
