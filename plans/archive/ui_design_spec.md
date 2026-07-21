# Foxlate UI/UX 2.0 设计规范与实施方案

## 1. 核心设计语言 (Design Tokens)

我们将扩展现有的 CSS 变量，建立更完整的设计系统。

### 1.1 形状系统 (Shape System)
统一全站圆角，营造柔和现代的视觉感受。

```css
:root {
    /* 基础圆角 */
    --md-sys-shape-corner-extra-small: 4px;  /* 标签、微型组件 */
    --md-sys-shape-corner-small: 8px;        /* 下拉菜单、表单项 */
    --md-sys-shape-corner-medium: 12px;      /* 卡片、对话框 */
    --md-sys-shape-corner-large: 16px;       /* 浮动按钮 (FAB)、大型容器 */
    --md-sys-shape-corner-extra-large: 28px; /* 全圆角按钮、侧边栏胶囊 */
}
```

### 1.2 海拔系统 (Elevation & Shadows)
通过阴影深浅表达层级关系，让界面“立”起来。

```css
:root {
    --md-sys-elevation-level-1: 0 1px 2px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.08); /* 卡片默认态 */
    --md-sys-elevation-level-2: 0 2px 4px rgba(0,0,0,0.12), 0 2px 3px rgba(0,0,0,0.10); /* 悬停态 */
    --md-sys-elevation-level-3: 0 4px 8px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08); /* 下拉菜单、弹窗 */
    --md-sys-elevation-level-4: 0 6px 12px rgba(0,0,0,0.15), 0 4px 6px rgba(0,0,0,0.10);
}
```

### 1.3 间距系统 (Spacing)
统一间距，拒绝“凭感觉”调整 margin。

```css
:root {
    --spacing-xs: 4px;
    --spacing-s: 8px;
    --spacing-m: 16px;
    --spacing-l: 24px;
    --spacing-xl: 32px;
}
```

---

## 2. 扩展弹窗 (Popup) 重构方案

目标：在有限空间内清晰展示核心功能，减少视觉噪点。

### 2.1 布局结构
```mermaid
graph TD
    Header[Header: Logo + Title + Settings Icon]
    LangCard[Language Card: Source -> Target]
    Options[Compact Options: Engine | Display Mode]
    MainAction[Primary Action: TRANSLATE FAB/Button]
    Footer[Minimal Footer: Version]
```

### 2.2 具体改动
*   **Header**: 新增顶部栏，包含 Foxlate Logo 和一个齿轮图标（跳转设置），移除底部的文字链接，节省空间。
*   **语言选择**: 将上下两个大下拉框改为 **左右并排** 布局，中间放置一个“互换”图标按钮。背景使用 `Surface Container Low`，使其成为一个独立的视觉单元。
*   **次要选项**: “翻译引擎”和“显示模式”不再占据整行，改为 **半宽 (50%)** 布局或使用 **Chips (小标签)** 样式。
*   **主操作按钮**: 按钮尺寸加大，文字加粗，使用主色（Primary）填充。加载状态下，按钮变为圆形进度条或保留文字并显示 Spinner。
*   **开关优化**: "总是翻译此网站" 的开关样式优化，使其更像一个 List Item，左侧文字，右侧开关。

---

## 3. 设置页面 (Options) 重构方案

目标：利用大屏优势，提供沉浸式的配置体验。

### 3.1 布局结构
采用 **左侧导航 + 右侧卡片流** 布局。

*   **左侧侧边栏 (Sidebar)**:
    *   固定宽度 (240px)。
    *   菜单项增加 SVG 图标。
    *   选中态使用 `Surface Container High` 背景 + `Primary` 文字色 + 胶囊圆角。
*   **右侧内容区 (Main)**:
    *   背景色为 `Surface` (浅灰/白)。
    *   每个设置板块 (Section) 变为一个 **独立卡片 (Card)**：
        *   白色背景 (`Surface Container Lowest`)。
        *   圆角 `Medium` (12px)。
        *   阴影 `Level 1`。
        *   内边距 `Large` (24px)。

### 3.2 列表项优化
针对“域名规则列表”和“AI 引擎列表”：
*   **List Item 样式**: 每个条目也是一个小卡片或具有分隔线的列表项。
*   **Hover 效果**: 鼠标悬停时背景轻微变色。
*   **操作区**: 编辑/删除按钮默认淡化，Hover 时高亮。

---

## 4. 组件库升级 (Components)

*   **Select (下拉框)**: 增加自定义箭头的样式，调整 Padding，使其在各个系统下表现一致。
*   **Button (按钮)**: 增加点击波纹效果 (Ripple Effect) 的 CSS 实现。
*   **Input (输入框)**: 优化 Focus 时的 Label 浮动动画，确保不遮挡输入内容。
*   **Transition (过渡)**: 为所有交互元素（Hover, Focus, Active）添加 `0.2s cubic-bezier` 过渡，提升精致感。