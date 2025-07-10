import { VideoSubtitleObserver } from './video-subtitle-observer.js';

// 你可以将这个类放在一个新文件，例如 'subtitle-renderer.js'
// 或者直接放在 youtube-subtitle-strategy.js 文件的顶部。

class SubtitleRenderer {
  constructor(options = {}) {
    this.overlayId = 'san-reader-translation-overlay';
    this.styleId = 'san-reader-renderer-styles';
    this.overlay = null;

    // 默认选项，并与传入的选项合并
    this.options = {
      align: 'left', // 默认左对齐，可设置为 'center'
      ...options
    };

    this.injectStyles();
    console.log('[LOG][SubtitleRenderer] Initialized with Dynamic Positioning and Options.');
  }

  injectStyles() {
    if (document.getElementById(this.styleId)) return;

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
        #${this.overlayId} {
            position: absolute;
            display: flex;
            flex-direction: column;
            width: 100%;
            pointer-events: none;
            z-index: 10;
            transition: top 0.1s ease-out, opacity 0.1s ease-out;
        }

        /* [核心改动] 使用 data-align 属性来控制对齐 */
        #${this.overlayId}[data-align="left"] {
            align-items: flex-start; /* 左对齐 */
        }
        #${this.overlayId}[data-align="center"] {
            align-items: center; /* 居中对齐 */
        }

        #${this.overlayId} .translation-line {
            padding: 2px 8px;
            color: #fff;
            background-color: rgba(8, 8, 8, 0.75);
            font-size: 1.8rem;
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

  // 新增一个方法，用于从外部更新选项（例如，用户在设置页面更改了对齐方式）
  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };
    if (this.overlay) {
      this.overlay.dataset.align = this.options.align;
    }
  }
  
  // render 方法基本不变，但增加了对 data-align 属性的设置
  render(translatedLines, captionWindow) {
    const playerContainer = document.querySelector('#movie_player');

    if (!playerContainer || !captionWindow) {
      this.hide();
      return;
    }
    
    // **重要修复**: 确保在原生字幕出现时，我们的字幕也能恢复显示
    const isNativeSubsVisible = captionWindow.style.display !== 'none' && captionWindow.offsetHeight > 0;
    if (!isNativeSubsVisible) {
      this.hide();
      return;
    }
    
    const playerRect = playerContainer.getBoundingClientRect();
    const nativeCaptionRect = captionWindow.getBoundingClientRect();

    if (nativeCaptionRect.height === 0 || nativeCaptionRect.width === 0) {
        this.hide();
        return;
    }

    if (!this.overlay || !playerContainer.contains(this.overlay)) {
      this.overlay = document.getElementById(this.overlayId);
      if (!this.overlay) {
        this.overlay = document.createElement('div');
        this.overlay.id = this.overlayId;
        playerContainer.appendChild(this.overlay);
      } else if (this.overlay.parentElement !== playerContainer) {
        playerContainer.appendChild(this.overlay);
      }
      // [核心改动] 初始化时设置对齐方式
      this.overlay.dataset.align = this.options.align;
    }
    
    const top = (nativeCaptionRect.bottom - playerRect.top) + 6;
    const left = nativeCaptionRect.left - playerRect.left;
    const width = nativeCaptionRect.width;

    this.overlay.style.top = `${top}px`;
    this.overlay.style.left = `${left}px`;
    this.overlay.style.width = `${width}px`;
    // **重要修复**: 主动恢复可见性
    this.overlay.style.opacity = '1';
    this.overlay.style.visibility = 'visible';

    const lines = translatedLines.filter(line => line && line.trim());

    while (this.overlay.children.length > lines.length) {
      this.overlay.lastChild.remove();
    }
    
    lines.forEach((lineText, index) => {
      let lineElement = this.overlay.children[index];
      if (lineElement) {
        if (lineElement.textContent !== lineText) {
          lineElement.textContent = lineText;
        }
      } else {
        lineElement = document.createElement('div');
        lineElement.className = 'translation-line';
        lineElement.textContent = lineText;
        this.overlay.appendChild(lineElement);
      }
    });

    if (lines.length === 0) {
      this.hide();
    }
  }

  hide() {
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      this.overlay.style.visibility = 'hidden';
    }
  }

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
    this.renderer = new SubtitleRenderer(); // 在构造函数中直接实例化
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
    console.log("[YouTubeStrategy] Final Refactor: Processing subtitles with precise sentence splitting.");
    try {
      if (!subtitleContent || subtitleContent.trim() === '') throw new Error("Content is empty.");
      const jsonData = JSON.parse(subtitleContent);
      if (!jsonData || !Array.isArray(jsonData.events)) throw new Error("Invalid JSON format.");

      // 步骤 1: 数据规整（与上一版相同）
      const rawBlocks = [];
      for (const event of jsonData.events) {
        if (!event.segs) continue;
        const text = event.segs.map(s => s.utf8).join('');
        const trimmedText = text.trim();
        if (trimmedText === '' || (trimmedText.startsWith('[') && trimmedText.endsWith(']'))) {
          continue;
        }
        rawBlocks.push({
          text: text.replace(/\n/g, ' ').trim(),
          startTime: event.tStartMs,
          endTime: event.tStartMs + (event.dDurationMs || 3000),
        });
      }

      if (rawBlocks.length === 0) {
        console.warn("[YouTubeStrategy] No valid text blocks found.");
        return;
      }

      // --- 步骤 2 & 3 (核心重构): 使用缓冲区和循环来精确分割句子 ---
      const timedSentences = [];
      let sentenceBuffer = '';
      let sentenceStartTime = -1;
      
      const sentenceBoundaryRegex = /(.*?[.!?。？！])/; // 匹配到第一个句子结束符（非贪婪）

      for (const block of rawBlocks) {
        // 如果缓冲区为空，新句子的起点就是当前 block 的起点
        if (sentenceBuffer.trim() === '') {
          sentenceStartTime = block.startTime;
        }

        sentenceBuffer += block.text + ' ';

        // **核心逻辑**: 循环从缓冲区中提取所有已完成的句子
        while (sentenceBoundaryRegex.test(sentenceBuffer)) {
          const match = sentenceBuffer.match(sentenceBoundaryRegex);
          const sentenceText = match[1].trim();
          
          if (sentenceText) {
            timedSentences.push({
              text: sentenceText,
              startTime: sentenceStartTime,
              // 句子的结束时间是完成该句子的这个 block 的结束时间
              endTime: block.endTime, 
            });
          }

          // 从缓冲区移除已提取的句子
          sentenceBuffer = sentenceBuffer.substring(match[0].length);

          // 为缓冲区中剩余部分（下一句的开头）设定新的开始时间
          // 如果还有剩余文字，新句子的起点就是当前这个 block 的时间点
          if (sentenceBuffer.trim() !== '') {
            sentenceStartTime = block.startTime;
          }
        }
      }

      // 处理循环结束后缓冲区里剩余的最后一句（可能没有标点）
      const remainingText = sentenceBuffer.trim();
      if (remainingText && sentenceStartTime !== -1) {
        timedSentences.push({
          text: remainingText,
          startTime: sentenceStartTime,
          // 结束时间是最后一个 block 的结束时间
          endTime: rawBlocks[rawBlocks.length - 1].endTime,
        });
      }
      
      if (timedSentences.length === 0) {
        console.warn("[YouTubeStrategy] No sentences could be formed.");
        return;
      }

      // --- 步骤 4: 批量翻译并创建最终的字幕脚本 (无变化) ---
      const originalTexts = timedSentences.map(s => s.text);
      const translatedTexts = await this.requestBatchTranslation(originalTexts);
      if (!translatedTexts || originalTexts.length !== translatedTexts.length) {
        throw new Error("Translation failed or returned mismatched results.");
      }

      this.subtitleScript = timedSentences.map((s, i) => ({
        ...s,
        translated: translatedTexts[i],
      }));

      console.log(`[YouTubeStrategy] Final Refactor: Cached ${this.subtitleScript.length} timed sentences.`, this.subtitleScript);
      this.startVideoObserver();

    } catch (error) {
      console.error(`[YouTubeStrategy] Critical failure in final refactor: ${error.message}.`);
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

    const currentSentences = this.subtitleScript.filter(
      s => currentTimeMs >= s.startTime && currentTimeMs <= s.endTime
    );

    const playerContainer = document.querySelector('#movie_player');
    // 如果播放器不存在，什么也做不了
    if (!playerContainer) return;

    // [核心修复] 移除旧的、错误的显示判断逻辑。
    // 我们总是获取 captionWindow，然后把它传递给 renderer。
    // 让 renderer 自己去判断是否应该显示。
    const captionWindow = playerContainer.querySelector('.caption-window');
    
    const translatedLines = currentSentences.map(s => s.translated);
    
    // 无论 captionWindow 是否可见，都调用 render 方法。
    // render 方法内部有足够的逻辑来处理所有情况（显示、隐藏、定位）。
    // console.log(`[YouTubeStrategy] Current time: ${currentTimeMs}ms. Current sentence: `,currentSentences);
    this.renderer.render(translatedLines, captionWindow);
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