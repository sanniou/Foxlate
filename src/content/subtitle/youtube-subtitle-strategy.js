import { VideoSubtitleObserver } from './video-subtitle-observer.js';

// 你可以将这个类放在一个新文件，例如 'subtitle-renderer.js'
// 或者直接放在 youtube-subtitle-strategy.js 文件的顶部。

class SubtitleRenderer {
  constructor(containerElement) {
    if (!containerElement) {
      throw new Error("Renderer requires a valid container element.");
    }
    this.container = containerElement;
    this.overlayId = 'san-reader-translation-overlay';
    this.styleId = 'san-reader-renderer-styles';
    this.overlay = null;
    console.log('[LOG][SubtitleRenderer] Constructor called.')
    this.injectStyles();
    this.createOverlay();
  }

  /**
   * 向页面注入用于翻译层的CSS样式。
   */


  injectStyles() {
    if (document.getElementById(this.styleId)) return;

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
        /*
         * 终极策略:
         * 1. 挂载点是真正的 .caption-window。
         * 2. 我们让 .caption-window 的高度自动适应内容。
         * 3. 原始字幕和翻译字幕在其中自然地垂直排列。
         */
        .caption-window {
            /* 强制覆盖YouTube的内联样式，让高度由内容决定！ */
            height: auto !important;
            /* 让内容垂直排列 */
            display: flex;
            flex-direction: column;
            align-items: center; /* 居中对齐 */
        }

        #${this.overlayId} {
            /* 作为一个 flex item，它会自然地排在原始字幕下方 */
            order: 2; /* 确保翻译在原始字幕之后 */
            padding-top: 4px; /* 在原文和译文之间留出一点空隙 */
            
            /* 其他样式保持，但不再需要 position: absolute */
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            pointer-events: none;
        }

        /* 原始字幕的容器也需要设置 order */
        .caption-window .captions-text {
            order: 1;
        }

        #${this.overlayId} .translation-line {
            /* 样式保持不变 */
            padding: 2px 8px;
            color: #fff;
            background-color: rgba(8, 8, 8, 0.75);
            font-size: 35.6889px; /* 尝试与原始字幕的字体大小匹配 */
            line-height: 1.4;
            font-family: "YouTube Noto", Roboto, "Arial Unicode Ms", Arial, sans-serif;
            white-space: pre-wrap;
            text-shadow: 
                0.05em 0.05em 0.1em rgba(0,0,0,0.9),
                -0.05em -0.05em 0.1em rgba(0,0,0,0.9),
                0.05em -0.05em 0.1em rgba(0,0,0,0.9),
                -0.05em 0.05em 0.1em rgba(0,0,0,0.9);
        }
    `;
    document.head.appendChild(style);
  }

  createOverlay() {
    // this.container 就是在构造函数中传入的 .caption-window
    if (!this.container) {
      console.error("Renderer's container (.caption-window) is null.");
      return;
    }

    // 关键：确保父容器（.caption-window）是相对定位，虽然新CSS下可能不是必须，但这是好习惯
    this.container.style.position = 'relative';

    let overlay = document.getElementById(this.overlayId);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = this.overlayId;
      // 直接添加到真正的“舞台”内部
      this.container.appendChild(overlay);
      console.log('[LOG][SubtitleRenderer] Overlay appended to the REAL caption window:', this.container);
    }
    this.overlay = overlay;
  }

  /**
   * 渲染翻译文本。
   * @param {string[]} translatedLines - 一个包含要显示的翻译行文本的数组。
   */
  render(translatedLines) {
    console.log(`[LOG][SubtitleRenderer.render] A. Render called with`, translatedLines);
    if (!this.overlay) this.createOverlay();

    // 清空旧的翻译
    this.overlay.innerHTML = '';
    console.log('[LOG][SubtitleRenderer.render] C. Cleared old translation content.');

    if (translatedLines && translatedLines.length > 0) {
      translatedLines.forEach((line, index) => {
        if (line.trim()) {
          const lineElement = document.createElement('div');
          lineElement.className = 'translation-line';
          lineElement.textContent = line;
          this.overlay.appendChild(lineElement);
          console.log(`[LOG][SubtitleRenderer.render] D. Appended translated line ${index + 1}: "${line}"`);
        }
      });
    }
  }

  /**
   * 清理资源，移除添加的元素和样式。
   */
  destroy() {
    console.log('[LOG][SubtitleRenderer.destroy] Destroying renderer resources.');
    document.getElementById(this.overlayId)?.remove();
    document.getElementById(this.styleId)?.remove();
    this.overlay = null;
  }
}

class YouTubeSubtitleStrategy {
  // 将关键选择器和配置定义为静态常量，便于维护
  static API_URL_FRAGMENT = '/api/timedtext';
  static CONTAINER_SELECTOR = '.ytp-caption-window-container';
  static SEGMENT_SELECTOR = '.ytp-caption-segment';
  static SCRIPT_ID = 'san-reader-network-interceptor';
  static EVENT_NAME = 'san-reader-subtitle-data';

  constructor(onSubtitleChange) {
    this.onSubtitleChange = onSubtitleChange;
    this.observer = null;
    this.renderer = null; // 初始化渲染器为空
    this.translatedSubtitles = new Map();
    this.originalSentences = [];
    this.translatedSentences = [];
    this.currentSentenceIndex = -1; // 跟踪当前正在显示的句子索引
    this.script = '';
    this.sentenceStartIndexes = [];
    // 绑定所有需要正确 `this` 上下文的处理器
    this.spaNavigationHandler = this.spaNavigationHandler.bind(this);
    this.handleInterceptedData = this.handleInterceptedData.bind(this);
  }

  initialize() {
    console.log("[ModernYouTubeStrategy] Initializing...");
    this.injectNetworkInterceptor();

    document.addEventListener(YouTubeSubtitleStrategy.EVENT_NAME, this.handleInterceptedData);
    document.body.addEventListener('yt-navigate-finish', this.spaNavigationHandler);

    // 初始化时，我们不启动任何观察者，而是完全依赖网络拦截。
    // 观察者只作为解析或翻译失败后的最终备用方案。
    console.log("[ModernYouTubeStrategy] Ready and waiting for subtitle network requests.");
  }

  /**
   * 注入一个能同时拦截 window.fetch 和 XMLHttpRequest 的强大脚本。
   * 这是目前在不使用侵入式 API 的情况下，最可靠的内容脚本拦截方案。
   */
  injectNetworkInterceptor() {
    if (document.getElementById(YouTubeSubtitleStrategy.SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = YouTubeSubtitleStrategy.SCRIPT_ID;

    // 这个函数将被转换为字符串并注入页面。
    // 它不依赖外部作用域，所有参数都通过函数调用传入。
    const interceptorCode = (urlFragment, eventName) => {
      const dispatchData = (data) => {
        document.dispatchEvent(new CustomEvent(eventName, { detail: data }));
      };

      // 1. 拦截 XMLHttpRequest
      const originalXhrOpen = XMLHttpRequest.prototype.open;
      const originalXhrSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url, ...args) {
        this._requestURL = url; // 在实例上存储 URL
        return originalXhrOpen.apply(this, [method, url, ...args]);
      };

      XMLHttpRequest.prototype.send = function (...args) {
        if (this._requestURL && typeof this._requestURL === 'string' && this._requestURL.includes(urlFragment)) {
          console.log('[Interceptor] XHR request detected:', this._requestURL);
          this.addEventListener('load', () => {
            if (this.readyState === 4) {
              console.log('[Interceptor] XHR request finished. Dispatching data.');
              dispatchData(this.responseText);
            }
          });
        }
        return originalXhrSend.apply(this, args);
      };

      // 2. 拦截 fetch
      const originalFetch = window.fetch;
      window.fetch = function (...args) {
        const url = args[0] instanceof Request ? args[0].url : args[0];

        if (typeof url === 'string' && url.includes(urlFragment)) {
          console.log('[Interceptor] Fetch request detected:', url);
          return originalFetch.apply(this, args).then(response => {
            const clonedResponse = response.clone();
            clonedResponse.text().then(text => {
              console.log('[Interceptor] Fetch request finished. Dispatching data.');
              dispatchData(text);
            }).catch(err => console.error('[Interceptor] Error reading fetch response:', err));
            return response;
          });
        }
        return originalFetch.apply(this, args);
      };
    };

    script.textContent = `(${interceptorCode.toString()})('${YouTubeSubtitleStrategy.API_URL_FRAGMENT}', '${YouTubeSubtitleStrategy.EVENT_NAME}');`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    console.log("[ModernYouTubeStrategy] Universal network interceptor injected.");
  }

  /**
   * 处理从拦截器收到的数据。
   * @param {CustomEvent} event 
   */
  handleInterceptedData(event) {
    console.log('[ModernYouTubeStrategy] Received subtitle data from interceptor.');
    this.processAndTranslateSubtitles(event.detail);
  }

  /**
   * 解析、翻译并缓存字幕。这是核心处理流程。
   * 这个版本专门为处理分段的、带有 aAppend 标志的字幕格式进行了优化。
   * @param {string} subtitleContent 
   */

  async processAndTranslateSubtitles(subtitleContent) {
    console.log("[ModernYouTubeStrategy] Processing with REFINED SENTENCE SPLITTING.");
    try {
      if (!subtitleContent || subtitleContent.trim() === '') throw new Error("Content empty.");
      const jsonData = JSON.parse(subtitleContent);
      if (!jsonData || !Array.isArray(jsonData.events)) throw new Error("Invalid JSON.");

      // --- 精细句子分割逻辑开始 ---
      const sentences = [];
      let sentenceBuffer = ''; // 使用一个缓冲区来累积文本

      // 1. 将所有事件的文本片段拼接成一个巨大的字符串
      for (const event of jsonData.events) {
        if (!event.segs) continue;
        const segmentText = event.segs.map(s => s.utf8.replace(/\n/g, ' ')).join('');
        sentenceBuffer += segmentText;
      }

      // 2. 使用正则表达式来分割这个巨大的字符串为句子
      // 这个正则表达式会匹配一个或多个非句末标点的字符，后跟一个句末标点。
      // 它能正确处理 "Hello world. How are you?" -> ["Hello world.", " How are you?"]
      const sentenceRegex = /[^.!?。？！]+[.!?。？！]/g;
      let match;
      while ((match = sentenceRegex.exec(sentenceBuffer)) !== null) {
        const cleanedSentence = match[0].trim();
        if (cleanedSentence && !cleanedSentence.startsWith('[') && !cleanedSentence.endsWith(']')) {
          sentences.push(cleanedSentence);
        }
      }

      // 检查是否有剩余的、不以标点结尾的文本（通常是最后一句）
      // 通过上一次匹配结束的位置来获取剩余部分
      const lastMatchEnd = sentenceRegex.lastIndex;
      if (lastMatchEnd < sentenceBuffer.length) {
        const remainingText = sentenceBuffer.substring(lastMatchEnd).trim();
        if (remainingText && !remainingText.startsWith('[') && !remainingText.endsWith(']')) {
          sentences.push(remainingText);
        }
      }
      // --- 精细句子分割逻辑结束 ---

      if (sentences.length === 0) {
        // 如果正则分割失败（例如字幕完全没有标点），回退到旧的简单逻辑
        const plainText = sentenceBuffer.trim();
        if (plainText) sentences.push(plainText);
      }

      if (sentences.length === 0) throw new Error("No sentences formed after splitting.");

      console.log(`[ModernYouTubeStrategy] Split into ${sentences.length} sentences for high-quality translation.`);
      // 打印第一句和最后一句作为样本
      console.log(`Sample First: "${sentences[0]}"`);
      console.log(`Sample Last: "${sentences[sentences.length - 1]}"`);

      // 后续的翻译和存储逻辑保持不变
      const translatedSentences = await this.requestBatchTranslation(sentences);
      if (!translatedSentences || sentences.length !== translatedSentences.length) {
        throw new Error("Translation failed or returned mismatched results.");
      }

      this.originalSentences = sentences;
      this.translatedSentences = translatedSentences;

      // --- 核心修改：创建“剧本”和索引 ---
      this.script = this.originalSentences.join(' '); // 用空格连接所有句子
      this.sentenceStartIndexes = [];
      let currentIndex = 0;
      for (const sentence of this.originalSentences) {
        this.sentenceStartIndexes.push(currentIndex);
        currentIndex += sentence.length + 1; // +1 是因为 join 时加的空格
      }
      // --- 修改结束 ---

      console.log(`[ModernYouTubeStrategy] Cached ${sentences.length} translated sentences. Activating display.`);
      this.startObserverForInstantDisplay();

    } catch (error) {
      console.error(`[ModernYouTubeStrategy] Critical failure in subtitle processing: ${error.message}.`);
      this.stopObserver();
    }
  }

  async requestBatchTranslation(texts) {
    try {
      // 直接使用 await，因为 browser.runtime.sendMessage 返回一个 Promise
      // 消息格式与其他处理器保持一致，使用 payload
      const response = await browser.runtime.sendMessage({ type: 'TRANSLATE_BATCH', payload: { texts } });
      if (response && response.success) {
        return response.translatedTexts;
      }
      throw new Error(response?.error || "从后台脚本收到的批量翻译响应无效。");
    } catch (error) {
      console.error("[YouTubeStrategy] 批量翻译请求失败:", error);
      throw error; // 重新抛出错误，以便调用者可以捕获它
    }
  }

  updateDisplay() {
    // 1. 查找必要的元素
    const playerContainer = document.querySelector('#movie_player');
    if (!playerContainer) return;

    const realCaptionWindow = playerContainer.querySelector('.caption-window');
    if (!realCaptionWindow) {
      if (this.renderer) {
        this.renderer.destroy();
        this.renderer = null;
        this.currentSentenceIndex = -1;
      }
      return;
    }

    // 2. 按需初始化渲染器
    if (!this.renderer) {
      this.renderer = new SubtitleRenderer(realCaptionWindow);
    }

    // 3. 获取原文
    const segmentElements = Array.from(realCaptionWindow.querySelectorAll(YouTubeSubtitleStrategy.SEGMENT_SELECTOR));
    const currentScreenText = segmentElements.map(el => el.textContent).join(' ').trim();

    // 4. 匹配翻译
    if (currentScreenText === '' || this.originalSentences.length === 0) {
      if (this.renderer) this.renderer.render([]);
      return;
    }

    // --- 最终的“剧本匹配”算法 ---
    const screenText = currentScreenText;

    // 1. 在整个“剧本”中查找当前屏幕文本的位置
    const matchPos = this.script.indexOf(screenText);

    let bestMatchIndex = -1;

    if (matchPos !== -1) {
      // 2. 如果找到了，就反向查找这个位置属于哪一句
      // 我们从后往前遍历句子起始索引，第一个小于等于 matchPos 的就是我们的句子
      for (let i = this.sentenceStartIndexes.length - 1; i >= 0; i--) {
        if (this.sentenceStartIndexes[i] <= matchPos) {
          bestMatchIndex = i;
          break;
        }
      }
    }

    // 如果直接匹配失败（可能因为 YouTube 文本有微小差异），使用模糊搜索作为备用
    if (bestMatchIndex === -1) {
      // (这里的备用逻辑可以是你之前的评分算法，但我们先专注于主逻辑)
      console.warn(`[ModernYouTubeStrategy] Direct match failed for "${screenText}". Fuzzy search can be added here.`);
    }

    const translatedLinesToShow = [];
    if (bestMatchIndex !== -1) {
      // 我们找到了当前屏幕文本对应的句子
      translatedLinesToShow.push(this.translatedSentences[bestMatchIndex]);

      // 如果屏幕文本跨越了两句话，我们可以把下一句也显示出来
      const matchEndPos = matchPos + screenText.length;
      if (bestMatchIndex + 1 < this.sentenceStartIndexes.length && matchEndPos > this.sentenceStartIndexes[bestMatchIndex + 1]) {
        translatedLinesToShow.push(this.translatedSentences[bestMatchIndex + 1]);
      }

      // 日志
      const bestOriginal = this.originalSentences[bestMatchIndex];
      console.log(`[Screen] "${screenText}" -> [Match in Script at pos ${matchPos}] -> [Sentence ${bestMatchIndex}] "${bestOriginal}"`);
    }

    this.renderer.render(translatedLinesToShow);
  }

  // 将评分逻辑提取为一个独立的辅助函数
  calculateMatchScore(screenText, sentenceText) {
    let score = 0;
    const index = sentenceText.indexOf(screenText);

    if (index === 0) { // 开头完全匹配 (最高优先级)
      score = 1000 + screenText.length * 2 - (sentenceText.length - screenText.length);
    } else if (index > 0) { // 包含，但不在开头
      // 分数基于匹配长度和它在句子中的位置 (越靠前越好)
      score = 500 + screenText.length - index;
    }
    return score;
  }

  startObserverForInstantDisplay() {
    this.stopObserver();

    const playerContainer = document.querySelector('#movie_player');
    if (!playerContainer) {
      console.error("[ModernYouTubeStrategy] Player container (#movie_player) not found.");
      return;
    }

    // 定义观察者回调
    const mutationCallback = (mutations, observer) => {
      let shouldUpdate = false;
      for (const mutation of mutations) {
        // 检查这个变化是否是我们自己引起的
        if (mutation.target.id === this.renderer?.overlayId || mutation.target.closest(`#${this.renderer?.overlayId}`)) {
          // 如果变化发生在我们的 overlay 内部，则忽略它
          continue;
        }
        // 只要有一个变化不是我们自己引起的，就说明需要更新
        shouldUpdate = true;
        break;
      }

      if (shouldUpdate) {
        // console.log("[ModernYouTubeStrategy] Legitimate change detected, triggering update.");
        this.updateDisplay();
      }
    };

    this.observer = new MutationObserver(mutationCallback);
    this.observer.observe(playerContainer, {
      childList: true,
      subtree: true,
      characterData: true, // 监听文本变化也很重要
    });
    console.log('[ModernYouTubeStrategy] Smart observer is now active on #movie_player.');

    // 首次启动时，手动调用一次更新，以处理已存在的字幕
    this.updateDisplay();
  }

  // stopObserver, spaNavigationHandler, cleanup 等方法保持不变
  // 但要确保 stopObserver 能正确停止新的观察者
  stopObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
  }

  /**
   * 在YouTube SPA导航时重置状态。
   */
  spaNavigationHandler() {
    console.log('[ModernYouTubeStrategy] SPA navigation detected. Resetting state.');
    this.stopObserver();
    this.translatedSubtitles.clear();
    this.currentSentenceIndex = -1;
    // 无需做其他事，等待新页面的网络请求即可。
  }

  cleanup() {
    this.stopObserver();
    this.originalSentences = [];
    this.translatedSentences = [];
    this.script = '';
    this.sentenceStartIndexes = [];
    document.body.removeEventListener('yt-navigate-finish', this.spaNavigationHandler);
    document.removeEventListener(YouTubeSubtitleStrategy.EVENT_NAME, this.handleInterceptedData);
    document.getElementById(YouTubeSubtitleStrategy.SCRIPT_ID)?.remove();
    console.log("[ModernYouTubeStrategy] Strategy cleaned up.");
  }

  getStatus() {
    const isSupported = window.location.pathname.includes('/watch');
    // 状态现在由是否拥有翻译缓存来决定更为准确
    const isEnabled = this.translatedSubtitles.size > 0 && !!this.observer;
    return { isSupported, isEnabled };
  }
}

export { YouTubeSubtitleStrategy };

// Self-register with the global manager
if (window.subtitleManager) {
  window.subtitleManager.registerStrategy(YouTubeSubtitleStrategy);
}