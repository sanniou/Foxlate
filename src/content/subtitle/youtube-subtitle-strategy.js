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
    this.videoElement = null;
    this.renderer = null; // 初始化渲染器为空
    // 这是新的核心数据结构，存储带有时间戳的完整字幕信息
    this.subtitleScript = [];

    // 绑定所有需要正确 `this` 上下文的处理器
    this.spaNavigationHandler = this.spaNavigationHandler.bind(this);
    this.handleInterceptedData = this.handleInterceptedData.bind(this);
  }

  initialize() {
    console.log("[ModernYouTubeStrategy] Initializing...");
    this.injectNetworkInterceptor();

    document.addEventListener(YouTubeSubtitleStrategy.EVENT_NAME, this.handleInterceptedData);
    document.body.addEventListener('yt-navigate-finish', this.spaNavigationHandler);

    // 尝试在初始化时就找到视频元素并启动观察者
    this.startVideoObserver();
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
    console.log("[YouTubeStrategy] Processing subtitles with new time-based strategy.");
    try {
      if (!subtitleContent || subtitleContent.trim() === '') throw new Error("Content empty.");
      const jsonData = JSON.parse(subtitleContent);
      if (!jsonData || !Array.isArray(jsonData.events)) throw new Error("Invalid JSON.");

      // --- 1. 将事件分组为带时间戳的句子 ---
      const timedSentences = [];
      let sentenceBuffer = '';
      let sentenceStartTime = -1;

      for (const event of jsonData.events) {
        if (!event.segs) continue;
        const segmentText = event.segs.map(s => s.utf8.replace(/\n/g, ' ')).join('');

        if (sentenceStartTime === -1) {
          sentenceStartTime = event.tStartMs;
        }
        sentenceBuffer += segmentText;

        // 当句子以标点符号结尾时，将其视为一个完整的句子
        if (/[.!?。？！]$/.test(sentenceBuffer.trim())) {
          const text = sentenceBuffer.trim();
          // 过滤掉YouTube的自动生成提示，如 "[音乐]"
          if (text && !text.startsWith('[') && !text.endsWith(']')) {
            timedSentences.push({
              text: text,
              startTime: sentenceStartTime,
              // 句子的结束时间是最后一个事件的结束时间
              endTime: event.tStartMs + (event.dDurationMs || 2000)
            });
          }
          // 为下一句重置
          sentenceBuffer = '';
          sentenceStartTime = -1;
        }
      }
      // 将缓冲区中剩余的任何文本作为最后一句
      if (sentenceBuffer.trim() && sentenceStartTime !== -1) {
        const lastEvent = jsonData.events[jsonData.events.length - 1];
        timedSentences.push({
          text: sentenceBuffer.trim(),
          startTime: sentenceStartTime,
          endTime: lastEvent.tStartMs + (lastEvent.dDurationMs || 5000)
        });
      }

      if (timedSentences.length === 0) throw new Error("No timed sentences could be formed.");

      // --- 2. 批量翻译并创建最终的字幕脚本 ---
      const originalTexts = timedSentences.map(s => s.text);
      const translatedTexts = await this.requestBatchTranslation(originalTexts);
      if (!translatedTexts || originalTexts.length !== translatedTexts.length) {
        throw new Error("Translation failed or returned mismatched results.");
      }

      this.subtitleScript = timedSentences.map((s, i) => ({ ...s, translated: translatedTexts[i] }));

      console.log(`[YouTubeStrategy] Cached ${this.subtitleScript.length} timed sentences. Activating display.`);
      this.startVideoObserver();

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

  /**
   * 根据视频当前播放时间更新字幕显示。
   * @param {number} currentTimeInSeconds - 视频的 `currentTime` 属性。
   */
  updateSubtitleDisplay(currentTimeInSeconds) {
    const currentTimeMs = currentTimeInSeconds * 1000;

    // 1. 找到当前时间点应该显示的句子
    const currentSentence = this.subtitleScript.find(
      s => currentTimeMs >= s.startTime && currentTimeMs <= s.endTime
    );

    // 2. 确保渲染器已准备就绪
    const playerContainer = document.querySelector('#movie_player');
    if (!playerContainer) return;

    const realCaptionWindow = playerContainer.querySelector('.caption-window');
    if (!realCaptionWindow) {
      // 如果字幕窗口消失，销毁渲染器以清理资源
      if (this.renderer) {
        this.renderer.destroy();
        this.renderer = null;
      }
      return;
    }

    if (!this.renderer) {
      this.renderer = new SubtitleRenderer(realCaptionWindow);
    }

    // 3. 渲染找到的句子或清空显示
    console.log(`[YouTubeStrategy] Current time:`,this.subtitleScript);
    console.log(`[YouTubeStrategy] Current time: ${currentTimeMs}ms. Current sentence: ${currentSentence?.text}`);
    if (currentSentence) {
      this.renderer.render([currentSentence.translated]);
    } else {
      this.renderer.render([]); // 如果当前时间没有对应句子，则清空
    }
  }

  startVideoObserver() {
    this.stopObserver();
    // 1. 获取视频播放器容器
    const playerContainer = document.querySelector('#movie_player');
    if (!playerContainer) {
      console.error("[YouTubeStrategy] Cannot start observer: #movie_player not found.");
      return;
    }
    // 2. 获取视频元素
    this.videoElement = playerContainer.querySelector('video');
    if (!this.videoElement) {
      console.error("[YouTubeStrategy] Cannot start observer: video element not found.");
      return;
    }

    // 3. 定义并启动新的时间监听器
    const timeUpdateHandler = () => {
      if (this.videoElement) {
        this.updateSubtitleDisplay(this.videoElement.currentTime);
      }
    };
    this.videoElement.addEventListener('timeupdate', timeUpdateHandler);
    console.log("[YouTubeStrategy] Time-based subtitle update listener added.");

    // 4. (可选) 立即触发一次更新，以处理初始字幕
    timeUpdateHandler();

    // 5. (重要) 重写 stopObserver 以移除事件监听器
    const originalStopObserver = this.stopObserver.bind(this);
    this.stopObserver = () => {
      originalStopObserver(); // 调用原来的清理逻辑
      if (this.videoElement) {
        this.videoElement.removeEventListener('timeupdate', timeUpdateHandler);
        this.videoElement = null; // 清除引用
        console.log("[YouTubeStrategy] Time-based subtitle update listener removed.");
      }
    };

    console.log('[YouTubeStrategy] Time-based subtitle synchronization is now active.');

    // 首次启动时，手动调用一次更新，以确保初始状态正确
    this.updateSubtitleDisplay(this.videoElement.currentTime);
  }

  // stopObserver, spaNavigationHandler, cleanup 等方法保持不变
  // 但要确保 stopObserver 能正确停止新的观察者
  stopObserver() {
    if (this.observer) {
      this.observer.disconnect();
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