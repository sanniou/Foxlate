# e04 Core Polish — 交付记录

**Date:** 2026-07-22  
**Branch:** feat/e04-core-polish  
**Tests at delivery:** 87 pass · Preflight builds green  

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
