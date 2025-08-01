# Foxlate 🦊

<p>
  <a href="https://addons.mozilla.org/zh-CN/firefox/addon/foxlate/" title="在 Mozilla Add-ons 上获取"><img src="https://img.shields.io/badge/dynamic/json?label=Firefox%20Add-on&query=current_version.version&url=https%3A%2F%2Faddons.mozilla.org%2Fapi%2Fv5%2Faddons%2Faddon%2Ffoxlate%2F&color=orange&logo=firefox-browser" alt="Firefox Add-on"></a>
  <img src="https://img.shields.io/badge/Chrome-即将推出-lightgrey?logo=google-chrome" alt="Chrome - 即将推出">
  <img src="https://img.shields.io/badge/Edge-即将推出-lightgrey?logo=microsoft-edge" alt="Edge - 即将推出">
</p>

一个功能强大的浏览器扩展，旨在提供无缝的网页内容翻译体验。支持多种翻译服务，并提供灵活的配置选项，让您轻松翻译选定的文本或管理翻译设置。

## ✨ 主要特性

- **右键菜单翻译**：选中网页上的任何文本，通过右键菜单快速翻译。翻译结果将以浮窗形式显示在选定文本附近。
- **多翻译引擎支持**：
  - **DeepLx**：支持自定义 DeepLx API 地址。
  - **Google Translate**：使用免费的谷歌翻译网页版 API，无需配置。
  - **AI Translator (GPT)**：支持 OpenAI 兼容的 API，可自定义 API 地址和模型名称。
    - **短文本切换**: 为 AI 引擎特别优化。您可以设置一个“短文本切换阈值”，当需要翻译的文本（如单个单词或短语）少于该阈值时，将自动使用一个更快速、更经济的备用翻译引擎（如 DeepLx 或 Google），从而在保证长文本翻译质量的同时，优化短文本的翻译体验和成本。
- **高级显示模式**: 不仅仅是浮窗！您可以选择将译文直接**替换**原文、**追加**在原文后方，或在**悬停**时显示。
- **字幕实时翻译**: 在支持的视频网站（如 YouTube, Bilibili）上，实时翻译视频字幕。提供双语、仅译文等多种显示模式，优化您的观影体验。
- **精准元素选择与域名规则**: 通过独立的“行内”和“块级”CSS选择器，精确控制需要翻译的元素，并为不同类型的文本（如标题和段落）应用不同的换行策略。您还可以为特定网站设置专属的翻译规则，覆盖全局设置。
- **内容过滤 (预检规则)**: 通过强大的正则表达式规则，精确控制哪些内容**不**被翻译。非常适合用于避免翻译代码、专有名词或特定格式的文本。
- **键盘快捷键**:
  - `Alt+S`: 快速翻译您选中的文本。
  - `Alt+A`: 切换页面翻译的显示/隐藏状态。
  - `Alt+X`: 切换页面翻译的显示模式 (替换/追加/悬停)。
- **多语言界面**：扩展界面支持多语言（i18n），为不同地区的用户提供更友好的体验。
- **连接测试**：在设置页面提供“测试连接”功能，帮助您验证翻译引擎的 API 配置是否正确。
- **灵活的设置页面**：
  - 选择偏好的翻译引擎。
  - 设置目标翻译语言。
  - 导入/导出设置，方便备份和迁移。
- **跨浏览器兼容**: 基于 WebExtension Polyfill 开发，确保在 Chrome 和 Firefox 上提供一致的体验。
- **友好的用户界面**：简洁直观的设置页面和翻译结果展示。

## 📜 更新日志 (Changelog)

详细的版本更新历史请查看 [changelog.md](changelog.md)。

## 🚀 支持的翻译引擎

目前支持以下翻译引擎：

- **DeepLx**
- **Google Translate**
- **AI Translator (GPT)** (兼容 OpenAI API)

## 🛠️ 安装指南

### 1. 环境准备 (Environment Setup)

1.  确保您已安装 [Node.js](https://nodejs.org/) (推荐 LTS 版本) 和 [pnpm](https://pnpm.io/installation)。
2.  克隆本仓库到您的本地机器：
    ```bash
    git clone https://github.com/sanniou/foxlate.git
    cd foxlate
    ```
3.  安装项目依赖：
    ```bash
    npm install
    ```

### 2. 开发模式 (Development Mode)

在开发模式下，`esbuild` 会监视文件变动并自动重新编译，方便您快速查看修改效果。

打开终端并运行以下命令之一来启动开发服务器：

-   **为 Chrome 开发**:
    ```bash
    node build.js --watch --target=chrome
    ```
-   **为 Firefox 开发**:
    ```bash
    node build.js --watch --target=firefox
    ```

### 3. 在浏览器中加载扩展 (Loading the Extension)

构建成功后，`dist` 目录将包含所有扩展文件。请按照以下步骤加载它：

    **Firefox:**
    -   在地址栏输入 `about:debugging`。
    -   点击“此 Firefox” > “加载临时附加组件...”。
    -   选择项目根目录下的 `dist/manifest.json` 文件。

    **Chrome:**
    -   在地址栏输入 `chrome://extensions`。
    -   开启“开发者模式”。
    -   点击“加载已解压的扩展程序”。
    -   选择项目根目录下的 `dist` 文件夹。

### 4. 生产构建 (Production Build)

当您准备好打包发布时，运行不带 `--watch` 标志的构建命令。这将生成经过优化的、最小化的文件。

-   **为 Chrome 构建**: `node build.js --target=chrome`
-   **为 Firefox 构建**: `node build.js --target=firefox`

## 💡 使用方法

### 1. 配置翻译引擎

1.  点击浏览器工具栏中的扩展图标，打开弹出窗口。
2.  点击弹出窗口底部的 **“选项”** 按钮，进入设置页面。
3.  在“通用设置”部分，选择您希望使用的 **“Translation Engine”**。
4.  根据所选引擎，填写相应的 **API URL** 或 **API Key**。
    - **DeepLx**：输入您的 DeepLx API 地址。
    - **AI Translator**：输入您的 AI API Key，并可选地设置 API Endpoint URL 和 Model Name。
    - **Google Translate** 无需额外配置。
5.  对于需要配置的引擎（如 DeepLx 或 AI），您可以使用 **“Test”** 按钮验证配置是否正确。
6.  设置 **“Target Language”** (例如 `ZH` 代表中文，`EN` 代表英文)。
7.  点击页面底部的 **“Save Settings”** 按钮保存您的配置。

### 2. 翻译文本

在任何网页上选中您想要翻译的文本后，您可以通过以下任一方式进行翻译：

- **方法一：使用右键菜单**
  - 右键点击选中的文本，在上下文菜单中选择 **“使用 Foxlate 翻译 '您选中的文本...'”**。
- **方法二：使用快捷键**
  - 按下快捷键 `Alt+S` (在 macOS 上可能为 `Option+S`)。

### 3. 选择显示模式
在设置页面的“通用设置”中，您可以找到“Display Mode”选项，它决定了翻译结果如何呈现：
- **浮窗 (Popup)**: 默认模式，在原文旁显示一个可关闭的浮窗。
- **替换 (Replace)**: 直接用译文替换掉您选择的原文。
- **追加 (Append)**: 在原文后面紧跟着插入译文。

## ⚙️ 高级配置说明

除了基本设置，Foxlate 还提供了强大的高级配置功能，让您完全掌控翻译行为。

### 元素选择器与换行策略 (CSS Selectors)

这是 Foxlate 的核心功能之一，允许您通过 CSS 选择器精确指定页面上需要翻译的元素，并为它们应用不同的换行策略。

在“规则管理”部分，您会看到两个主要的输入框：

-   **行内选择器 (Inline Selector)**:
    -   **用途**: 专为短文本、单行内容设计，如标题 (`h1`, `h2`)、按钮、导航链接 (`a`)、标签 (`label`) 等。
    -   **换行策略**: 翻译后的文本中的所有换行符将被替换为空格，以确保译文保持单行，从而不破坏页面布局。
    -   **示例**: `h1, h2, h3, .button-text, a > span`

-   **块级选择器 (Block Selector)**:
    -   **用途**: 适用于包含多行内容的大段文本，如段落 (`p`)、列表项 (`li`)、文章正文 (`article`) 等。
    -   **换行策略**: 翻译时会保留原文的换行，确保段落结构和格式在翻译后得以维持。
    -   **示例**: `p, div.content, article, li`

### 域名规则 (Domain Rules)

此功能允许您为特定的网站（域名）设置独立的翻译规则，覆盖您的全局默认设置。

- **如何创建规则**: 在“规则管理”部分，点击“添加域名规则”按钮。
- **可配置项**:
  - **域名**: 您想要应用规则的网站域名 (例如 `github.com`)。
  - **应用到子域名**: 规则是否也对所有子域名生效 (例如 `gist.github.com`)。
  - **自动翻译**: 在该网站上是否启用自动翻译功能。
  - **翻译引擎/目标语言**: 为该网站指定不同于全局设置的翻译引擎或目标语言。
  - **行内/块级选择器**: 您可以为该域名单独设置一套行内和块级选择器。
  - **覆盖默认选择器**: 勾选此项后，该域名将**仅**使用您在此处定义的选择器，完全忽略全局选择器。如果未勾选，此处的选择器将与全局选择器**合并**生效。

### 字幕翻译 (Subtitle Translation)

Foxlate 还能实时翻译支持的视频网站的字幕。此功能完全集成在**域名规则**中，让您可以为不同视频网站（如 YouTube, Bilibili）设置专属的字幕翻译行为。

在“添加/编辑域名规则”弹窗中，您会找到“字幕设置”部分：

-   **启用字幕翻译**: 总开关，用于为当前域名开启或关闭字幕翻译功能。
-   **字幕策略**: 选择适配当前网站的策略。例如，为 `youtube.com` 选择 "youtube" 策略。
-   **字幕显示模式**:
    -   **仅译文**: 只显示翻译后的字幕。
    -   **双语**: 同时显示原文和译文字幕。
    -   **关闭**: 注入翻译逻辑但不显示，可用于调试或与其他脚本配合。

### 预检规则 (Pre-check Rules)

预检规则是一个强大的内容过滤器。在文本被发送到翻译引擎之前，它会根据您定义的正则表达式 (Regex) 规则进行检查，以决定是否应该跳过翻译。这对于避免翻译代码、专有名词、URL 等内容非常有用。

## 🤝 开发与贡献

如果您对这个项目感兴趣，并希望进行开发或贡献，请按照以下步骤操作：

1.  请先参照上方的 **安装指南** 完成环境准备。
2.  根据您的目标浏览器，运行相应的 **开发模式** 命令。
3.  在 `src` 目录中修改代码。`esbuild` 会自动将您的更改编译到 `dist` 目录。
4.  在浏览器的扩展管理页面点击“重新加载”按钮，即可看到更改。

欢迎提交 Pull Request 或报告 Bug！

## 📄 许可证

本项目采用 MIT License 许可。

---

**感谢您使用 Foxlate！**
