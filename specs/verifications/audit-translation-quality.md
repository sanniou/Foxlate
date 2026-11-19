# 翻译效果评审（1.7.8）

评审对象：`main` @ `3e080a5`（1.7.8）。方法：抓 19 个真实页面到 `.tmp/corpus/`，用 jsdom 加载后**直接跑仓库源码**
（`findTranslatableElements` → `DOMWalker.create` → `shouldTranslate` → `translateBatch` → `reconstructDOM` → 三个显示策略），
所有数字来自实测；脚本在 `.tmp/tq/`（`run-extract2.mjs` / `run-ai.mjs` / `run-display.mjs` / `run-glossary.mjs` / `run-lang.mjs` 等）。

## 语料库清单

19 页 / 6.8 MB / 22.4 万字符被送进翻译管线。抓取命令 `curl -L --compressed -A "Mozilla/5.0 ... Chrome/131"`；
每页的 url / bytes / 语言 / 页面类型记在 `.tmp/corpus/<slug>/meta.txt`。单页最大 1.4 MB（Guardian），
没有超过 3 MB 的页面，因此**未做裁剪**；`.tmp/corpus` 总计 6.8 MB（限额 80 MB）。

| # | slug | URL | bytes | 类型 | 结果 |
|---|------|-----|-------|------|------|
| 1 | news-cnn-article | https://lite.cnn.com/2026/11/18/investing/anthropic-ipo-price-stock | 64 549 | 新闻正文 | ✅ 2708 字正文 |
| 2 | news-cnn-lite | https://lite.cnn.com/ | 267 034 | 新闻首页 | ✅ |
| 3 | news-npr-text | https://text.npr.org/ | 6 051 | 新闻（纯文本版） | ✅ 体量小 |
| 4 | news-guardian | https://www.theguardian.com/international | 1 431 442 | 新闻首页 | ✅ |
| 5 | news-verge | https://www.theverge.com/tech | 685 716 | 科技新闻首页 | ✅ |
| 6 | docs-mdn | https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API | 202 449 | 文档站 | ✅ |
| 7 | docs-chrome | https://developer.chrome.com/docs/extensions/reference/api/tabs | 354 364 | 文档站（表格+代码） | ✅ |
| 8 | blog-overreacted | https://overreacted.io/a-complete-guide-to-useeffect/ | 752 713 | 技术博客 | ✅ |
| 9 | blog-danluu | https://danluu.com/cache-incidents/ | 51 179 | 技术博客（超长段落） | ✅ |
| 10 | wiki-en | https://en.wikipedia.org/wiki/JavaScript | 701 490 | 百科 EN | ✅ |
| 11 | wiki-zh | https://zh.wikipedia.org/wiki/JavaScript | 454 869 | 百科 ZH | ✅ |
| 12 | th-wiki | https://th.wikipedia.org/wiki/ภาษาไทย | 548 172 | 非拉丁（泰语，无空格分词） | ✅ |
| 13 | ar-aljazeera | https://www.aljazeera.net/news/ | 353 840 | 非拉丁（阿拉伯语，RTL） | ✅ |
| 14 | forum-hn | https://news.ycombinator.com/item?id=8863 | 99 722 | 论坛（HN 评论树） | ✅ 用有效 item id 重抓 |
| 15 | forum-discourse2 | https://meta.discourse.org/t/new-to-discourse-start-here/1 | 601 929 | 论坛（Discourse） | ✅ 需 Googlebot UA |
| 16 | shop-steam | https://store.steampowered.com/app/570/Dota_2/ | 170 244 | 电商商品页 | ✅ |
| 17 | shop-books | https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html | 9 279 | 电商详情页 | ✅ |
| 18 | github-readme | https://github.com/mozilla/readability | 308 245 | README 渲染（表格+徽章） | ✅ |
| 19 | arxiv | https://arxiv.org/abs/1706.03762 | 43 071 | 论文摘要页 | ✅ |

**抓取失败并已替换的真实站点（如实记录）**：

| 目标 | 结果 | 原因 | 替代 |
|------|------|------|------|
| amazon.com/dp/B08N5WRWNW | 200 / 3 781 B | 反爬页（正文只有 “Click the button below to continue shopping”），不是商品页 | shop-steam + shop-books |
| mastodon.social/@Mastodon（普通 UA 与 Googlebot 都试） | 200 / 48 KB / 20 KB | 纯 JS 壳，`<body>` 文本 0 字符 | 无可用替代（twitter/x、reddit 均 403）；社交时间线改由 forum-hn / forum-discourse2 覆盖 |
| lemmy.world | 403 | Cloudflare 拦截 | 同上 |
| old.reddit.com/r/programming | 403 / 1 522 B | 反爬 | 同上 |
| redlib / safereddit 镜像 | TLS 握手被断 | 实例不可用 | 同上 |
| meta.discourse.org/t/… （普通 UA） | 200 / 601 929 B，文本 0 | Discourse 走 JS 渲染 | 换 Googlebot UA 拿到服务端渲染版本 |

**测试环境限制（影响判读，必须说明）**：jsdom 没有布局引擎，`offsetWidth/offsetHeight/offsetParent` 恒为 0；
本审计在 `.tmp/tq/setup-dom.mjs` 里补了「按 CSS display 判定盒子」的替身，并做了两处样式清洗：
1. 去掉 `@media` 块（jsdom 忽略媒体条件、无条件应用，导致 CNN Lite 正文被当成 `display:none`）；
2. 去掉选择器含 `:has(` 的规则（jsdom 的 nwsapi 会「匹配失败即命中」，把整页判成隐藏）。
因此：**抽取/预检/分句/术语表/协议的数字是真实的**；「视觉遮挡类不可见元素」与 RTL 排版效果未在真机验证。

## 结论摘要

1. **非拉丁脚本是硬缺口**：阿拉伯语页面 33 个候选**0 个**被送去翻译，泰语维基 1225 个候选只有 82 个（覆盖率 6.1%）。根因是 `src/common/lang-detect.js` 只认 11 种拉丁/中日韩语言，检测不到就当「不支持」直接跳过。
2. **只在 `<div>` 里的正文永远漏抽**：Steam 商品主描述 1 393 字、HN 全部评论正文（6 条 340–682 字）、Guardian 17 条摘要、The Verge 20 条摘要都没有进入候选。根因：`DEFAULT_TRANSLATION_CONTENT` 不含 `div`，而 `div` 只在「首选选择器一个都没命中」时才作为 fallback 启用。
3. **术语表没有词边界**：`cat` 在 15 万字符真实语料里 72 次命中**全部是假匹配**（`classification`/`concatenate`），`AI` 96.6%、`he` 99.6%；`cat→猫` 实测把 `classifications` 改成 `classifi猫ions`。而且替换是作用在**带 `<tN>` 标签的文本**上的，单字母词条会直接打烂标签（`t→X` 把 `<t0>` 变成 `<X0>` → 重建失败 → replace 退化成纯文本，链接全丢）。
4. **replace 模式会删掉图片和内联代码**：维基信息框 `<td>` 翻译后 `<img>` 1→0；README `<li>` 的 `<code>` 3→0，句子变成 `(中文, 中文 ): a … If , the …`。`append` 模式没有这个问题（原文还在），但会把整段（含 17 个链接）复制一遍。
5. **AI 批量协议只校验「条数」，不校验「对齐」**：3 条同数量但顺序打乱的返回被静默接受；12 条批次里恒缺 1 条时，实测发出 **23 个 HTTP 请求**（1 + 二分 22）才收敛。请求体是原文的 **2.16 倍**（整段文本在 system prompt 与 user message 里各发一次）。

## 一、抽取覆盖率

口径：`候选` = `findTranslatableElements` 返回；`walker 拒` = `DOMWalker.create` 返回 null；`送翻` = 通过 `shouldTranslate`；
`覆盖率` = 主内容区文本节点中被「送翻单元」覆盖的字符占比。目标语言 ZH（wiki-zh 另跑 EN）。

| 站点 | 候选 | walker 拒 | 送翻 | 跳过原因分布 | 覆盖率 | 单元长度 p50/p90/max |
|------|------|-----------|------|--------------|--------|----------------------|
| news-cnn-article | 16 | 1 | 10 | undetectable 5 | 0.626 | 183/469/469 |
| news-cnn-lite | 101 | 0 | 93 | undetectable 8 | 0.920 | 82/107/117 |
| news-npr-text | 24 | 2 | 19 | undetectable 3 | 0.858 | 71/89/93 |
| news-guardian | 208 | 3 | 197 | undetectable 8 | 0.822 | 80/107/147 |
| news-verge | 73 | 15 | 52 | undetectable 6 | 0.517 | 82/282/458 |
| docs-mdn | 196 | 13 | 139 | blacklist 44 | 0.693 | 133/423/816 |
| docs-chrome | 662 | 54 | 522 | blacklist 4 / undetectable 82 | 0.707 | 16/118/339 |
| blog-overreacted | 309 | 14 | 284 | undetectable 11 | 0.746 | 134/301/670 |
| blog-danluu | 215 | 1 | 202 | undetectable 12 | 0.870 | 110/472/1000 |
| wiki-en | 423 | 19 | 297 | blacklist 2 / undetectable 105 | 0.679 | 59/357/831 |
| wiki-zh (→EN) | 376 | 72 | 89 | undetectable 159 / blacklist 36 / already-target 20 | 0.039 | 5/12/30 |
| wiki-zh (→ZH) | 375 | 71 | 20 | undetectable 159 / already-target 89 / blacklist 36 | 0.028 | 15/61/79 |
| th-wiki | 1225 | 179 | 82 | undetectable 922 / blacklist 42 | **0.061** | 8/38/326 |
| ar-aljazeera | 33 | 1 | **0** | undetectable 32 | **0.000** | – |
| forum-hn | 366 | 221 | 62 | undetectable 78 / blacklist 5 | 0.444 | 163/392/937 |
| forum-discourse2 | 23 | 0 | 23 | – | 0.747 | 56/198/650 |
| shop-steam | 155 | 54 | 69 | blacklist 31 / undetectable 1 | **0.308** | 17/64/327 |
| github-readme | 169 | 55 | 114 | – | 0.811 | 15/138/598 |
| arxiv | 42 | 3 | 37 | undetectable 1 / blacklist 1 | 0.516 | 19/97/1146 |
| shop-books | 21 | 1 | 15 | blacklist 5 | 0.867 | 17/23/1017 |

合计：4 636 候选 / 707 被 walker 拒 / 2 237 单元被送翻 / 223 628 字符 / 1 433 次「检测不出语言」跳过。

### 该翻却没被选中的元素（人工抽查，按缺失字符数排序）

| 站点 | 元素 | 缺失 | 原文片段 |
|------|------|------|----------|
| shop-steam | `div#game_area_description` | 1 393 | “The most-played game on Steam. Every day, millions of players worldwide enter battle as…” |
| forum-hn | `td.default > div.comment > div.commtext.c00` | 682 | “+1 on being able to specify a folder inside the dropbox as a "server" folder, wh…” |
| forum-hn | 同上（另外 5 条评论，340–521 字） | 2 055 | “I totally missed that. I just know he was interviewed for this past winter sessi…” |
| news-guardian | `main > div > span > div > div`（17 条摘要） | 1 907 | “It is 40 years since a racially charged attack at a curry house led to Satpal Ram’s conviction…” |
| news-verge | `div._4ine554`（20 条） | 1 681 | “‘Nvidia could end world hunger or provide clean water for everyone, now that it’s making over $200 b…” |
| news-verge | `a._1y5ugvba` | 139 | “SiriusXM and Pandora Agree to Provide High-Quality Podcast Transcripts for Deaf and…” |
| arxiv | `div.dateline` / `div.submission-history` | 374 | “[Submitted on 12 Jun 2017 (v1), last revised 2 Aug 2023 (this version, v7)]” |
| shop-steam | `div.game_area_sys_req_note` | 93 | “Starting January 1st, 2024, the Steam Client will only support Windows 10 and late…” |
| docs-chrome | `aside`（提示框） | — | “Note: The Tabs API can be used by the service worker and extension pages…”（被 `DEFAULT_TRANSLATION_EXCLUDE` 的 `aside` 杀掉） |

**机器化的同类统计**（`.tmp/tq/run-divmiss.mjs`）：「自身含直接文本、且不含 `p/li/td` 等首选标签」的 `<div>`
未被任何候选覆盖：news-guardian 17/30（1 907 字）、news-verge 20/25（1 681 字）、arxiv 3/4（265 字）、
docs-mdn 与 forum-discourse2、blog-overreacted 均为 0。

### 反向问题：过度抽取

- `forum-hn`：366 个候选里 **221 个是空的 `<p>` 占位符**（HN 评论末尾的 `<p>`），全部走完观察器再被 walker 拒。
- `docs-chrome`：`td` 单元 138 个，平均只有 **13 个字符**（表格里的 `3`、`Yes`、`Chrome 88+`），一页 522 次请求。
- 全局标签分布（7 个站点合计 1 513 个单元）：`p:block 605`、`li:block 251`、`h3:block 232`、`td:block 138`、`foxlate-wrapper:block 54`，
  `inline` 只有 1 个 —— 见第四节。
- 反例（值得记下）：维基 `.navbox` 因为带 `role="navigation"`，被 `DEFAULT_TRANSLATION_EXCLUDE` 正确排除（6 个 navbox 全部未入选），
  说明「按 role 排除」这条设计是有效的，可复用到别处。

## 二、切分与协议风险（真实段落实测）

### 2.1 没有任何分句/切分

`src/content/element-translation-controller.js:57-63` 直接把 `DOMWalker` 产出的整段文本当一次请求：

```js
const translationRequest = { elementId, text: sourceText, targetLang, sourceLang: 'auto', translatorEngine };
```

`DOMWalker.create` 的产物是**整个候选元素的全部文本**（`src/content/dom-walker.js:381-382`，`segments.join('')`）。
全文搜索 `split`/`segment`/`sentence`：页面翻译路径上没有任何切分逻辑；`translate-batch-queue.js:6-8` 只做
「12 条 / 10 000 字符」的**打包**上限，不做句子边界。

实测单条单元长度：`blog-danluu` max **1 000 字**、`arxiv` max **1 146 字**、`blog-overreacted` max 670、
`docs-mdn` max 816（p90 423）。这些都是**一个 `<p>`/`<li>` 整段**发出去。

### 2.2 AI 批量协议（`src/background/translators/ai-translator.js`）

用真实单元驱动（`.tmp/tq/run-ai.mjs`，真 `AITranslator` + 真 `TranslationExecutor.executeAiBatchGroup`）：

| 场景 | 实测结果 |
|------|----------|
| 正常回包（3 条） | OK；system prompt 2 338 字符 + user message 2 039 字符，原文 2 029 字符 → **发送量 2.16×**（`#createSystemPrompt` 把 `JSON.stringify(texts)` 塞进 system prompt，`translateBatch` 又发一遍同样的数组） |
| 数量一致但**顺序打乱** | **静默接受**：`['【第二条的译文】','【第一条的译文】','【三】']` 原样返回，`#parseBatchResponse`（`ai-translator.js:56-81`）只校验 `parsed.length !== expectedCount` 和 `typeof item === 'string'` |
| 模型把 2 条并成 1 条 | `AI batch translation failed: AI batch response length mismatch: expected 3, got 2.` |
| 12 条批次恒缺 1 条 | 触发 `translation-executor.js:171-178` 的二分：**23 个 HTTP 请求**，最终 12/12 成功（每单元平均 1.9 次请求） |

风险结论：
1. **错位不可检测**。一旦模型把两条短单元合并、又把另一条拆成两条，「条数相等」这条唯一的护栏就失效，译文会写进错误的 DOM 元素——页面上看不出任何异常。
2. 二分重试只对「条数/JSON 类错误」有效（`isSplittableBatchError`，`translation-executor.js:10-13`）；`Promise<Tab | undefined>` 这类 5 字符单元混在长段落里时，模型倾向输出解释文字，会稳定触发整批二分。
3. `translateBatch` 失败时整批 `success:false`（`translate-text-batch-handler.js:95-110`），页面一次红一片，用户看不出是「哪一条」的问题。

### 2.3 单条路径（Google / DeepLX）

`google-translator.js:44` 把整段塞进 `q=`（POST，无长度切分）；`deeplx-translator.js:21-26` 同理。
实测最长单元 1 146 字（arxiv），未触及 Google 的 ~5 000 字上限，但**没有任何长度保护**：若某站一个 `<li>` 里有 6 000 字，
会被静默截断或 400。

## 三、保真风险（数字/URL/占位符/代码块/emoji）

### 3.1 输出侧零校验

`translation-pipeline.js:11-14` 的 `postProcess` 是恒等函数：

```js
export function postProcess(text) { if (typeof text !== 'string') return ''; return text; }
```

全链路没有任何「数字个数、URL 个数、`<tN>` 标签配对、`{}` 占位符」的比对。把真实单元（`docs-mdn` 的 1 段 + `docs-chrome`
的 1 段带 `<all_urls>` 的段落 + danluu 的 1 段 1 000 字）交给 `translateBatch`，回一份**丢掉所有数字和 URL** 的译文，
管线照单全收、写进缓存、写进页面。这就是「3 个 URL + 2 个数字 + 1 个 `{placeholder}`」场景的真实风险：不是解析器错位，
而是**没有任何一处会告诉你它丢了**。

补充事实：真实语料的可见文本里 **URL 几乎从不出现**——19 个页面 2 237 个单元里只有 1 个含 `http`（arxiv 的 DOI 行
`https://doi.org/10.48550/arXiv.1706.03762\n Focus to learn more ...`），因为链接都在 `href` 属性里。
所以「URL 被翻译坏」的真实风险不在文本，而在第九节的**链接丢失**。

### 3.2 标签（`<tN>`）破坏

`src/content/dom-reconstructor.js:30-40` 是严格栈模型：

| 模型行为 | 真实单元上的结果 |
|----------|------------------|
| 少了 1 个 `</t0>` | `DOM reconstruction finished with unclosed tags: t0` → `replace-strategy.js:67` 捕获 → `innerHTML = escapeHtml(...)`：**链接/加粗/代码全部丢失**，只留纯文本 |
| 把所有 `<tN>` 删掉 | 重建「成功」但退化成纯文本（`"A target element intersects either the device's viewport..."`），无任何告警 |
| 把 `<t0>` 换成 `<b>` | 抛 `Unknown translator tag ID` → 同上回退 |

真实单元示例（wiki-en，3 个 preservable 节点 `t0=STRONG t1=STRONG t2=STRONG`）：只要模型把标签写成 `<strong>`，
加粗全部丢失且用户无感知。

### 3.3 代码块 / 内联代码 → 「文本空洞」

`DEFAULT_TRANSLATION_EXCLUDE` 含 `pre, code, kbd, samp`，`dom-walker.js:223` 对子节点 `matches(exclude)` 直接跳过。
结果送进引擎的文本是**被挖了洞的句子**：

| 站点 | 例子（送翻文本，洞就是被删掉的 `<code>`） | 丢失字符 |
|------|------------------------------------------|----------|
| docs-mdn | `The root intersection rectangle can be adjusted further by setting the root margin, , when creating the .` | 76（`rootMargin`、`IntersectionObserver`） |
| docs-mdn | `The first box has a threshold for each percentage point of visibility; that is, the  array is .` | 68 |
| docs-chrome | `Host permissions allow an extension to read and query a matching tab's four sensitive  properties.` | 99（`tabs.Tab`、`tabs.captureVisibleTab()`、`scripting.executeScript()`） |
| github-readme | `(RegExp, default  ): a regular expression that matches video URLs…If , the  is  .` | 36–68 |
| wiki-en | `Often also mentioned is  resulting in  (number). This is misleading: the  is interpreted as an empty code block` | 34（`{} + []`、`0`、`{}`） |

送翻文本 / 可见文本之比：docs-mdn **94.9%**（183 个单元里 41 个有洞）、docs-chrome **96.4%**（54/608）、
github-readme **90.9%**（29/114）、wiki-en **98.0%**（24/404）、news-verge 100%（无 code）。
→ 模型看到的是残缺句，译文语法必然残缺；`replace` 模式下这些标识符**根本不回到页面上**。

### 3.4 emoji / 符号

`docs-chrome` 有 82 个单元（含 500 字英文整段，因为正文里有 `<all_urls>`）被判「语言不可识别」而跳过；`news-cnn-lite`
8 条英文标题（含 `$`、`’`、`™` 的）同样被跳过。根因见 5.1。

## 四、显示策略对真实排版的影响

用真实 DOM 片段实测（`.tmp/tq/run-display.mjs`）：`elementStates` 注入真实 `translationUnit`，再调三个策略的
`updateUI(element, 'translated')`（与 `DisplayManager.setElementState` 同一路径）。

### 4.1 replace：整段替换会删掉图片与内联代码

| 用例 | 翻译前 | replace（标签完整） | replace（模型丢标签） |
|------|--------|--------------------|----------------------|
| 维基百科正文 `<p>`（17 链接、2 加粗） | a=17(href 17) b=2 | **a=17(href 17) b=2** ✅ | a=0 href=0，b=0 ❌ |
| 维基百科信息框 `<td>`（1 图片 + 2 链接） | a=2 img=1 | a=1 img=**0** ❌ | a=0 img=0 |
| GitHub README `<li>`（1 链接 + 3 代码） | a=1 code=3 | a=1 code=**0** ❌ | a=0 code=0 |

DOM 前后对比（README `<li>`，replace + 标签完整）：

```
翻译前: `<code>allowedVideoRegex</code> (RegExp, default <code>undefined</code> ): a regular expression …`
翻译后: `(中文, 中文 ): a 中文 … If , the 中文 中文 is 中文.`      ← <code> 内容与节点都没了
```

原因：替换走 `element.replaceChildren(fragment)`（`replace-strategy.js:63`），fragment 只由 `segments`（文本）+
`nodeMap`（`A/B/I/EM/STRONG/CODE/U/S/SUB/SUP` 等 preservable）组成；`<img>/<picture>/<svg>/<figure>` 既不是 preservable
也不产生文本节点，于是从重建结果里彻底消失。

replacement 影响面（`.tmp/tq/run-imgloss.mjs`，含媒体节点的单元占比）：github-readme **38.6%**（44/114，表格徽章）、
news-guardian 6.8%（14/205，标题配图）、wiki-en 1.2%、wiki-zh 1.0%、th-wiki 0.5%；其余站点 0%。

### 4.2 append：原文保留，但整段复制 + 缺 `lang`/`dir`

```
原 <p> 链接 17 → append 后元素内链接 34（追加节点自带 17 个 <a href>）
追加节点: <div class="foxlate-appended-text foxlate-appended-block">
```

- 追加节点是 `<div>`（`appendType=block`），落在 `<td>`/`<li>` 里也照样插 `<div>`；实测 1 513 个单元里 `inline` 只有 1 个，
  `li:block 251`、`td:block 138`。表格单元格会因此多出一行高度（原文 13 字 + 译文 13 字垂直堆叠）。
- 追加节点**没有 `lang="zh"`、没有 `dir="rtl"`**，中文译文继承父元素的 `lang="en"`（影响朗读、字重、断行）。
- 图片/代码不丢（原文还在），所以「含媒体/代码的单元」用 append 才安全 —— 但默认 `displayMode` 是全局单一值。

### 4.3 hover：不动正文，但浮层只用 plainText

实测（wiki-en `<p>`）：`mouseenter` 后 `innerHTML` 不变、链接 17 个仍在（只加了 `foxlate-state-translated
foxlate-hover-highlight` 两个 class）；浮层文本取 `data.plainText`（`hover-strategy.js:107-109`），
即**无标签版本**：`"JavaScript (JS)\n[\na\n]\n is a programming language and core technology of the Web, …"` ——
脚注 `[a]` 这种无意义字符原样出现在浮层里，代码标识符位置是空洞。

### 4.4 表格/列表的共性

`td`/`th` 平均 13/12 字、`li` 平均 101 字。对 `td` 这种一格一词的单元：分句无意义（本来就短），
但**没有最小长度门槛** → 138 个 `td` 全部各发一次请求（docs-chrome 一个页面就 522 次请求）。

## 五、语言检测与术语表实测

### 5.1 预检启发式：含 `+ ~ < > | $ € ™ →` 的英文被判「语言不可识别」

`src/common/lang-detect.js:120` 的兜底正则只允许 `[a-zA-Z0-9\s\p{P}]`，**不含 `\p{S}`（数学/货币/符号）**：

```js
} else if (/^[a-zA-Z0-9\s\p{P}]+$/u.test(text)) { return 'eng'; }
```

而 `shouldTranslate`（`precheck.js:44-52`）在 `projectCode === null` 时返回 `false`。真实受害样本：

| 站点 | 被跳过（`shouldTranslate` = false）的真实英文 | 触发的字符 |
|------|-----------------------------------------------|-----------|
| news-cnn-lite | `Anthropic’s $83 IPO price puts it on track for a record-breaking debut on Wall Street.` | `$` |
| docs-chrome | `Captures the visible area … either the <all_urls> permission or the activeTab permission …`（500 字整段） | `<` `>` |
| docs-chrome | `Promise<Tab \| undefined>` / `Promise<string>` | `<` `\|` |
| blog-danluu | `… (90%+ chance) …` / `… ~10% of users …` / `Twitter is currently down for <% = reason %>` | `+` `~` `<` |
| wiki-en | `ActionScript, ArkTS, AssemblyScript, … JS++, Opa, TypeScript` | `+` |

量化（franc 未加载 → 纯启发式；`.tmp/tq/run-franc.mjs`）：

| 站点 | 单元 | 启发式可翻 | franc 就绪后可翻 | 启发式漏掉 |
|------|------|-----------|------------------|-----------|
| wiki-en | 404 | 297 | 402 | **107（26.5%）** |
| docs-chrome | 608 | 522 | 604 | 86（14.1%） |
| news-cnn-lite | 101 | 93 | 101 | 8（7.9%） |
| blog-danluu | 214 | 202 | 214 | 12（5.6%） |
| news-verge | 58 | 52 | 58 | 6（10.3%） |

franc 在 `content-runtime.js:381` 里预热，热路径通常已就绪，所以这是**冷启动竞态**：用户装好扩展第一次点翻译、
或页面刚好在 `import()` 完成前触发首扫，就永久丢掉这部分单元（`element-translation-controller.js:44-48` 跳过即返回，
不会重试，元素也已被 `unobserve`）。

### 5.2 短文本（<20 字符）误判率 20%–40%

franc 就绪状态下，从真实页面抽 `<20` 字符字符串（排除纯数字/符号）：

| 站点 | 样本 | 期望 | 误判 | 误判率 | 例子 |
|------|------|------|------|--------|------|
| news-guardian | 40 | eng | 16 | **40.0%** | `More features`→fra、`Editorials`→spa、`World news`→nld |
| docs-chrome | 99 | eng | 38 | **38.4%** | `Permissions`→fra、`Properties`→spa、`browser.tabs`→por、`background.js:`→deu |
| shop-steam | 37 | eng | 8 | 21.6% | `System Requirements`→fra、`Play Dota 2`→por |
| wiki-zh | 119 | cmn | 27 | 22.7% | `JavaScript源代码截图`→fra、`读写HTML元素；`→und、`Netscape Navigator`→ita |
| th-wiki | 200 | und | 67 | 33.5% | 泰文片段被判 ita/spa/por/deu/nld |

后果（真实数字）：

- `wiki-zh` + 目标 ZH（页面本来就是中文）：仍有 **20 个单元**被判「可翻」送进引擎（p50 只有 15 字符），
  另有 89 个正确判为「已是目标语言」、159 个「不可识别」。
- `wiki-zh` + 目标 EN：**89 个单元**被送翻，p50 = **5 字符**、p90 = 12 —— 即把「历史」「参考」这类 2–5 字碎片
  单独发给模型翻成英文。
- 代码里**没有页面级语言短路**：`grep pageLang/detectPageLanguage/sameLanguage src/` 为空，
  唯一的语言判断就是逐元素的 `shouldTranslate`。

### 5.3 术语表：无词边界 → 假匹配率最高 100%

`src/common/translation-glossary.js:32` 直接 `new RegExp(escapeRegExp(entry.source), flags)`，没有 `\b`/前后约束。
在 **1603 个真实单元 / 150 908 字符**上实测（`.tmp/tq/run-glossary.mjs`）：

| 词条 | 命中总数 | 独立词命中 | 词内假匹配 | 假匹配率 |
|------|---------|-----------|-----------|---------|
| cat | 72 | 0 | 72 | **100.0%** |
| he | 2 230 | 8 | 2 222 | **99.6%** |
| art | 93 | 3 | 90 | 96.8% |
| AI | 236 | 8 | 228 | 96.6% |
| form | 75 | 5 | 70 | 93.3% |
| main | 15 | 2 | 13 | 86.7% |
| in | 2 226 | 390 | 1 836 | 82.5% |
| block | 7 | 3 | 4 | 57.1% |
| text | 9 | 4 | 5 | 55.6% |
| JS | 77 | 38 | 39 | 50.6% |
| not | 148 | 85 | 63 | 42.6% |
| API | 21 | 13 | 8 | 38.1% |
| tab | 308 | 223 | 85 | 27.6% |

真实破坏样本（`cat => 猫`，danluu 段落）：

```
before: … the most severe incident classifications) incidents at Twitter …
after : … the most severe incident classifi猫ions) incidents at Twitter …
```

并且替换发生在**两个方向、且作用在带标签的文本上**（`translation-pipeline.js:74` 源侧、`translation-executor.js:97/151` 输出侧），
标签也会被词条吃掉：

| 词条 | `'<t0>JavaScript</t0> is <t1>fun</t1>'` 替换后 |
|------|-----------------------------------------------|
| `t → X` | `'<X0>JavaScripX</X0> is <X1>fun</X1>'` → 重建抛 `Unknown translator tag ID` → replace 退化为纯文本 |
| `t0 → X` | `'<X>JavaScript</X> is <t1>fun</t1>'` → 同上 |
| `JavaScript → X` | `'<t0>X</t0> is <t1>fun</t1>'` ✅（正常用途） |
| `S → X` | `'<t0>JavaXcript</t0> iX <t1>fun</t1>'` |

补一个正面事实：`$&`/`$'`/`$1` 类替换模式**已被函数式 replacer 避开**（`translation-glossary.js:36`、`ai-translator.js:22`），
`escapeRegExp` 也正确转义了正则元字符——这两处不用改。

## 六、P0/P1/P2 与修复方案

### P0-1 非拉丁脚本（阿拉伯/泰文）正文完全不可译

- 证据：ar-aljazeera 33 候选 → 0 送翻；th-wiki 1225 → 82（覆盖 6.1%）；wiki-zh 也有 159 个「不可识别」。
- 根因：`src/common/language-config.js:14-24` 的 `LANGUAGE_CONFIG` 只映射 11 种语言；`lang-detect.js:174` 用
  `whitelist: SUPPORTED_LANG_CODES` 调 franc，`precheck.js:46` 只要 `projectCode` 为空就放弃。
- 改法（按顺序）：
  1. `lang-detect.js:171-178` 把「**可检测的源语言**」与「**可作为目标的语言**」拆开：`detectProjectLang` 用
     `{ whitelist: [...SUPPORTED_LANG_CODES, 'ara','tha','hin','vie','tur','pol','ukr','heb','fas','ind'] }`；
  2. `precheck.js:44-52` 改成「只要 `rawCode` 不是 `und`、且不等于目标语言对应的代码就翻」，`projectCode` 缺失不再等于「不支持」：
     ```js
     // targetRawCode：从 LANGUAGE_CONFIG 反查目标语言的三字母码（ZH → cmn）
     if (rawCode && rawCode !== 'und' && rawCode !== targetRawCode) {
         return { result: true, reason: '', log };
     }
     ```
  3. `lang-detect.js:99` 的字符集兜底补 `[\u0600-\u06FF]`→`ara`、`[\u0E00-\u0E7F]`→`tha`、`[\u0900-\u097F]`→`hin`
     （顺序放在韩文/假名之后，中日共用汉字之前）。
- 验收：ar-aljazeera 覆盖率 0 → >0.6；th-wiki 0.061 → >0.6；`test/lang-detect*.test.mjs` 加 3 条。

### P0-2 只在 `<div>` 里的正文永远漏抽（含电商主描述、论坛评论）

- 证据：Steam `div#game_area_description` 1 393 字、HN 6 条评论 2 737 字、Guardian 17 条摘要 1 907 字、
  Verge 20 条 1 681 字、arxiv 3 条 265 字；覆盖率 shop-steam 0.308 / forum-hn 0.444 / news-verge 0.517 / arxiv 0.516。
- 根因：`src/common/constants.js:31-36` 首选选择器无 `div`；`src/content/translatable-elements.js:233-247` 的 fallback
  **只在 `allCandidates.size === 0` 时启用**——只要页面上有一个 `<main>`/`<p>`，fallback 就永不触发。
- 改法：保留首选选择器，但**补一轮「文本型 div」候选**（不是整站套 fallback 选择器，否则噪音翻倍）：
  ```js
  // translatable-elements.js，在 finalCandidates 计算完之后
  const textDivs = rootNodes
      .flatMap(root => Array.from(root.querySelectorAll('div')))
      .filter(el =>
          !el.querySelector('p,li,td,th,blockquote,dd,dt,h1,h2,h3,h4,h5,h6,figcaption,pre') &&
          [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim().length >= 20) &&
          el.textContent.trim().length >= 40);
  ```
  再加两条护栏，避免把 wrapper 化的排版容器全收进来：
  - 若 `el` 的祖先里已有候选（被覆盖）就丢弃；
  - `el` 的直接文本长度 / 全部文本长度 < 0.5 的（即文本散在子 div 里）继续下探，不收。
- 验收：shop-steam 0.308 → >0.8；forum-hn 0.444 → >0.85；news-verge 0.517 → >0.8；同时 `news-cnn-lite` /
  `blog-danluu` 的候选数增幅 < 15%（防噪音回归）。

### P0-3 术语表无词边界 + 会打烂 `<tN>` 标签

- 证据：假匹配率 `cat` 100% / `he` 99.6% / `AI` 96.6%；`classifi猫ions`；`t→X` 使 `<t0>` 变 `<X0>`。
- 改法（`src/common/translation-glossary.js:22-38`）：
  1. 按「CJK 与非 CJK」分别加边界：非 CJK 词条用 `(?<![A-Za-z0-9])(?:src)(?![A-Za-z0-9])`，CJK 词条保持无边界；
  2. **切出标签再替换**：用 `/(<t\d+>|<\/t\d+>)/` split 文本，只对非标签片段调用替换；
  3. 单字母/纯数字词条在 UI 保存时警告（或强制 `caseSensitive` + 边界）。
- 验收：`cat` 在 danluu 段落里 0 次替换；`<t0>` 在任何词条下都保持不变（新测试）。

### P0-4 replace 模式删除图片/内联代码

- 证据：wiki 信息框 `<td>` replace 后 `img 1→0`、`a 2→1`；README `<li>` `code 3→0`；含媒体单元占比 github-readme 38.6%、
  news-guardian 6.8%。
- 改法（二选一，推荐 A+B 同时）：
  - **A**：`dom-walker.js:11-36` 把 `IMG/PICTURE/VIDEO/CANVAS/SVG` 变成**自闭合占位标签**（`<tN>` 无内容），
    `nodeMap[tN]` 存 `cloneNode(true)`，重建时原位还原。这样 replace 也能保住图片与徽章。
  - **B**：`replace-strategy.js:60` 之前做一次「失血检查」：若 `nodeMap` 覆盖不到元素内的 media/code 数量，
    就本次降级为 append（或提示「此段含图片，已用追加模式」）。
- 验收：新测试 `replace 保留 <img>`；github-readme 全页 replace 后 `img` 数量不变。

### P1-1 预检启发式把含符号的英文判成「不可识别」

- 证据：`lang-detect.js:120`；wiki-en 冷启动漏 26.5% 单元、docs-chrome 14.1%。
- 改法：`/^[a-zA-Z0-9\s\p{P}\p{S}]+$/u`（加入 `\p{S}`），或改成「拉丁字母占比 ≥ 60% 即 `eng`」：
  ```js
  } else if ((text.match(/[A-Za-z]/g) || []).length / text.length >= 0.6) { return 'eng'; }
  ```
- 验收：`'Anthropic’s $83 IPO price…'` → `eng`；`'Promise<Tab | undefined>'` → `eng`。

### P1-2 短文本语言误判 20%–40%（含「中文页翻译成中文」）

- 证据：第 5.2 节；wiki-zh + 目标 ZH 仍发出 20 个请求；wiki-zh + EN 发出 89 个 p50=5 字符的碎片。
- 改法：
  1. `precheck.js` 增加页面级短路：若 `document.documentElement.lang` 的主语言等于目标语言，**整页不启动**
     （在 `page-translation-job.js:start()` 里报 `alreadyTargetLanguage` 状态，UI 给一行提示）；
  2. `< 12` 字符且不含空格的单元（按钮/标签/单个词）不单独送翻，改为「随最近的长单元一起送」或直接跳过；
  3. `lang-detect.js` 里对 `len < 20` 的文本**不信 franc**（它在这个长度上不可靠），改用「页面 lang 上下文优先、
     字符集次之」。
- 验收：wiki-zh + ZH 送翻数 20 → 0；wiki-zh + EN 的 p50 从 5 提到 >20。

### P1-3 AI 批量「同数量错位」不可检测 + 请求体 2.16×

- 证据：第 2.2 节。
- 改法：
  1. `ai-translator.js:195-205` 不再把 `JSON.stringify(texts)` 塞进 system prompt（用户提示里的 `{textToTranslate}`
     改为占位提示语「见 user message 的 JSON 数组」），请求体 2.16× → ~1.1×；
  2. 每批随机/递增编号并要求回 `{"i":n,"t":"..."}` 或按 `[[0,"..."]]` 二元组返回，条数相等但顺序错乱即可检测；
  3. 校验失败时**不要整批二分**：先尝试「按行切分 + 短单元合并」的修复，再二分（实测 12 条批次 23 次请求的成本）。

### P1-4 输出侧零保真校验

- 改法：`translation-pipeline.js:11` 的 `postProcess` 变成真校验：
  数字串集合、`<tN>` 配对、`http(s)://` 计数与原文对比，不一致时**打标但不拦截**（`result.warnings`），
  并在 `displayError`/HUD 里给出「本段数字/链接可能与原文不一致」的一行提示。
- 验收：构造丢 3 个数字的译文，`warnings` 必须非空。

### P1-5 空/碎片候选浪费请求

- 证据：HN 221/366 空 `<p>`；docs-chrome 138 个 `td` 平均 13 字；单页 522 次请求。
- 改法：`translatable-elements.js` 收尾过滤 `el.textContent.trim().length < 2`（或文本节点为空）；
  `element-translation-controller.js:41` 之前加「同父级短单元合并」（同一 `<tr>`/`<ul>` 内 <12 字符的 `td`/`li` 合成一条）。

### P2 其余

| 项 | 证据 | 改法 |
|----|------|------|
| append 节点缺 `lang`/`dir` | 追加 `<div>` 无属性 | `append-strategy.js:33-40` 写 `wrapper.lang = targetLang`，`dir` 按目标语言；RTL 目标补 `dir="rtl"` |
| `aside` 排除误杀提示框 | docs-chrome `Note: The Tabs API…` | `constants.js:27` 把 `aside` 改为 `aside:not([class*=note]):not(.note)` 或只排除 `[role=complementary]` |
| hover 浮层丢链接/代码 | 5.3 节 | hover 用 `reconstructDOM` 渲染富文本（复用 append 的 fragment） |
| 扫描期即改写 DOM（`foxlate-wrapper`） | 1 513 单元中 54 个 wrapper | 低风险：revert 已能还原（`page-translation-reverter.js:19-26`），但失败路径要保证调用 |

## 七、需要用户决策的取舍

1. **长段落是否切句**：不切（现状）→ 上下文完整、术语一致，但 1 000+ 字段落一旦模型偷懒就整段失真、且单次请求贵；
   切句 → 保真与可校验性大幅提升（可逐句比对数字/标签），但指代与语气会碎。
   *建议*：不切句，但对 `> 600` 字符的单元做「段落内句子锚点」——保留整段一次发送，输出后按句子数校验。
2. **`div` 正文纳入的激进程度**：全站把 `div` 加入内容选择器 → 覆盖率上去，噪音（卡片标题、按钮组）也上去（预估候选数 +40%~80%）；
   只纳入「文本型 div」→ 覆盖率提升有限但噪音可控。
   *需要你选*：客户端默认走「文本型 div」启发式，还是提供「激进模式」开关？
3. **术语表语义**：默认全词匹配（安全，与现有用户预期可能不符——现在的行为是子串匹配，有人可能依赖它匹配词形变化）。
   *需要你选*：默认全词 + 一个「允许子串匹配」的高级开关，还是保持子串但在术语表里高亮显示「本词条会匹配 1 234 处」？
4. **源语言支持范围**：把 `ara/tha/hin/vie/...` 纳入「可翻译源语言」后，UI 的 `SUPPORTED_LANGUAGES`（目标语言）是否同步扩张？
   目标语言每加一个都要验证 prompt 与排版（RTL、泰文断行）。
5. **默认显示模式**：是否对「含图片/内联代码」的单元自动降级为 append（安全但视觉上双语冗余），
   还是保持 replace 的一致性、接受图片被删（现状）。
6. **同语言页面短路**：目标语言 = 页面语言时，是「什么都不做 + 弹一行提示」（推荐），
   还是继续按元素逐个判定（现状会产生 20–89 个碎片请求，且可能把中文翻成中文）？

---

### 复跑方法

```bash
cd .tmp/corpus && ./fetch.sh && ./fetch2.sh        # 抓语料（失败站点会记在 _results.tsv）
cd .tmp/tq && node build.mjs                        # esbuild 打包源码到 .tmp/tq/bundle.mjs（不写 dist）
node run-extract2.mjs news-verge wiki-en th-wiki …  # 抽取覆盖率 → extract2.json
node run-ai.mjs                                     # AI 批量协议（mock fetch + 真 executor 二分）
node run-display.mjs                                # 三种显示策略的真实 DOM 前后对比
node run-glossary.mjs                               # 术语表假匹配率
node run-lang.mjs                                   # 短文本语言误判率
```
