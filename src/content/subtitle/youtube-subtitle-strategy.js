import { VideoSubtitleObserver } from './video-subtitle-observer.js';

// 你可以将这个类放在一个新文件，例如 'subtitle-renderer.js'
// 或者直接放在 youtube-subtitle-strategy.js 文件的顶部。

class SubtitleRenderer {
  constructor(options = {}) {
    this.overlayId = 'san-reader-translation-overlay';
    this.styleId = 'san-reader-renderer-styles';
    this.overlay = null;
    this.lastRenderedState = { lines: null, top: null, left: null }; // <--- 新增缓存属性

    // 默认选项，并与传入的选项合并
    this.options = {
      align: 'left', // 默认左对齐，可设置为 'center'
      fontSize: 1.8, // 单位是 rem
      backgroundColor: 'rgba(8, 8, 8, 0.75)',
      displayMode: 'off', // 新增：'off', 'translated', 'bilingual'
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
    if (this.overlay && newOptions.align) {
      this.overlay.dataset.align = this.options.align;
    }
  }

  // render 方法基本不变，但增加了对 data-align 属性的设置
  render(linesData, captionWindow) {
    const playerContainer = document.querySelector(YouTubeSubtitleStrategy.SELECTORS.PLAYER_CONTAINER);

    if (!playerContainer || !captionWindow) {
      this.hide();
      return;
    }

    // 根据 displayMode 决定是否渲染
    if (this.options.displayMode === 'off') {
      this.hide();
      return;
    }

    // --- 缓存检查 ---
    // linesData 现在是 [{original: '...', translated: '...'}] 格式
    const lines = linesData.filter(line => line.translated && line.translated.trim());
    // 使用更可靠的分隔符来比较缓存
    const linesJoined = lines.map(l => `${l.translated}\n${l.original}`).join('|');

    // **重要修复**: 确保在原生字幕出现时，我们的字幕也能恢复显示
    const isNativeSubsVisible = captionWindow.style.display !== 'none' && captionWindow.offsetHeight > 0;
    if (!isNativeSubsVisible) {
      if (this.lastRenderedState.lines !== null) { // 如果之前在显示，现在需要隐藏
        this.hide();
        this.lastRenderedState = { lines: null, top: null, left: null };
      }
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

    // 如果内容和位置都和上次一样，直接返回，不做任何操作
    if (this.lastRenderedState.lines === linesJoined && this.lastRenderedState.top === top) {
      return;
    }

    // 更新缓存
    this.lastRenderedState = { lines: linesJoined, top, left };

    this.overlay.style.top = `${top}px`;
    this.overlay.style.left = `${left}px`;
    this.overlay.style.width = `${width}px`;
    // **重要修复**: 主动恢复可见性
    this.overlay.style.opacity = '1';
    this.overlay.style.visibility = 'visible';

    while (this.overlay.children.length > lines.length) {
      this.overlay.lastChild.remove();
    }

    lines.forEach((lineData, index) => {
      let lineElement = this.overlay.children[index];
      let lineText;

      if (this.options.displayMode === 'bilingual') {
        lineText = `${lineData.translated}\n${lineData.original}`;
      } else { // 'translated'
        lineText = lineData.translated;
      }

      if (lineElement) {
        if (lineElement.textContent !== lineText) {
          lineElement.textContent = lineText;
        }
      } else {
        lineElement = document.createElement('div');
        lineElement.className = 'translation-line';
        lineElement.textContent = lineText;
        lineElement.style.fontSize = `${this.options.fontSize}rem`;
        lineElement.style.backgroundColor = this.options.backgroundColor;
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

  static SELECTORS = {
    PLAYER_CONTAINER: '#movie_player',
    VIDEO_ELEMENT: 'video',
    CAPTION_WINDOW: '.caption-window',
  };

  constructor(onSubtitleChange) {
    this.onSubtitleChange = onSubtitleChange;
    this.timeUpdateHandler = null;
    this.videoElement = null;
    this.renderer = new SubtitleRenderer(); // 在构造函数中直接实例化
    this.subtitleScript = [];

    // 绑定所有需要正确 `this` 上下文的处理器
    this.spaNavigationHandler = this.spaNavigationHandler.bind(this);
    this.handleInterceptedData = this.handleInterceptedData.bind(this);
  }

  initialize() {
    console.log("[ModernYouTubeStrategy] Initializing...");
    // 异步请求设置，但不阻塞初始化流程
    window.getEffectiveSettings().then(settings => {
        this.settings = settings;
        // 将设置传递给渲染器
        this.renderer.updateOptions({
            displayMode: this.settings?.subtitleSettings?.displayMode || 'off'
        });
        console.log(`[ModernYouTubeStrategy] Settings loaded, display mode set to: ${this.renderer.options.displayMode}`);
         // settings 加载完成后立即启动字幕更新
         if (this.settings?.subtitleSettings?.enabled) {
          this.startVideoObserver();
        }
    }).catch(err => {
        console.error("[ModernYouTubeStrategy] Error loading settings:", err);
    });

    this.injectNetworkInterceptor();

    document.addEventListener(YouTubeSubtitleStrategy.EVENT_NAME, this.handleInterceptedData);
    document.body.addEventListener('yt-navigate-finish', this.spaNavigationHandler);

    console.log("[ModernYouTubeStrategy] Ready and waiting for subtitle network requests.");
  }

  /**
   * (新增) 接收来自 SubtitleManager 的设置更新，并应用它们。
   * @param {object} newSettings - 最新的有效设置对象。
   */
  updateSettings(newSettings) {
    this.settings = newSettings;
    const newMode = this.settings?.subtitleSettings?.displayMode || 'off';

    if (!this.renderer) {
      console.warn('[YouTubeSubtitleStrategy] Renderer not available, cannot update settings.');
      return;
    }

    console.log(`[YouTubeSubtitleStrategy] Updating display mode from "${this.renderer.options.displayMode}" to "${newMode}".`);
    this.renderer.updateOptions({ displayMode: newMode });

    if (this.videoElement) {
      this.updateSubtitleDisplay(this.videoElement.currentTime);
    }
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
      // --- [修复] 保存原始方法，以便将来恢复 ---
      if (!window.__foxlate_originals) {
        console.log('[Interceptor] Storing original network functions.');
        window.__foxlate_originals = {
          fetch: window.fetch,
          xhrOpen: XMLHttpRequest.prototype.open,
          xhrSend: XMLHttpRequest.prototype.send,
        };
      } else {
        // 如果已经存在，说明拦截器已被注入，可能是在SPA导航后。
        // 为确保安全，我们先恢复再重新应用，防止多层包裹。
        window.fetch = window.__foxlate_originals.fetch;
        XMLHttpRequest.prototype.open = window.__foxlate_originals.xhrOpen;
        XMLHttpRequest.prototype.send = window.__foxlate_originals.xhrSend;
      }

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
   * [新增] 移除网络拦截器，恢复原始的 fetch 和 XHR。
   */
  removeNetworkInterceptor() {
    const script = document.createElement('script');
    // 这个ID仅用于调试，脚本执行后会立即移除。
    script.id = `${YouTubeSubtitleStrategy.SCRIPT_ID}-cleanup`;

    const cleanupCode = () => {
      if (window.__foxlate_originals) {
        console.log('[Interceptor] Restoring original network functions.');
        window.fetch = window.__foxlate_originals.fetch;
        XMLHttpRequest.prototype.open = window.__foxlate_originals.xhrOpen;
        XMLHttpRequest.prototype.send = window.__foxlate_originals.xhrSend;
        // 清理存储的对象，释放内存
        delete window.__foxlate_originals;
      }
    };

    script.textContent = `(${cleanupCode.toString()})();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // 立即移除脚本元素
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
      // 确保在翻译前我们有有效的设置。
      if (!this.settings) {
        console.warn("[YouTubeStrategy] Settings not loaded before translation, fetching now.");
        this.settings = await window.getEffectiveSettings();
      }
      const translatedTexts = await this.requestBatchTranslation(originalTexts, this.settings.targetLanguage, this.settings.translatorEngine);
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
      console.error(`[YouTubeStrategy] Critical failure in subtitle processing: ${error.message}.`);
      this.stopVideoObserver();
    }
  }
  
  async requestBatchTranslation(texts, targetLanguage, translatorEngine) {
    try {
      // 直接使用 await，因为 browser.runtime.sendMessage 返回一个 Promise
      // 消息格式与其他处理器保持一致，使用 payload
      const response = await browser.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        payload: { texts, targetLanguage, translatorEngine }
      });
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

    const playerContainer = document.querySelector(YouTubeSubtitleStrategy.SELECTORS.PLAYER_CONTAINER);
    // 如果播放器不存在，什么也做不了
    if (!playerContainer) return;

    // [核心修复] 移除旧的、错误的显示判断逻辑。
    // 我们总是获取 captionWindow，然后把它传递给 renderer。
    // 让 renderer 自己去判断是否应该显示。
    const captionWindow = playerContainer.querySelector(YouTubeSubtitleStrategy.SELECTORS.CAPTION_WINDOW);

    // 创建渲染器期望的数据结构，以支持双语显示
    const linesData = currentSentences.map(s => ({
      original: s.text, // 'text' 字段包含原始文本
      translated: s.translated
    }));

    // 无论 captionWindow 是否可见，都调用 render 方法。
    // render 方法内部有足够的逻辑来处理所有情况（显示、隐藏、定位）。
    // console.log(`[YouTubeStrategy] Current time: ${currentTimeMs}ms. Current sentence: `,currentSentences);
    this.renderer.render(linesData, captionWindow);
  }

  /**
   * 启动对视频播放时间的监听，以实时更新字幕。
   * 此方法是幂等的，会先停止任何已存在的监听器。
   */
  startVideoObserver() {
    this.stopVideoObserver(); // 确保先停止任何旧的观察者

    const playerContainer = document.querySelector(YouTubeSubtitleStrategy.SELECTORS.PLAYER_CONTAINER);
    if (!playerContainer) {
      console.error("[YouTubeStrategy] Cannot start observer: #movie_player not found.");
      return;
    }
    this.videoElement = playerContainer.querySelector(YouTubeSubtitleStrategy.SELECTORS.VIDEO_ELEMENT);
    if (!this.videoElement) {
      console.error("[YouTubeStrategy] Cannot start observer: video element not found.");
      return;
    }

    let isUpdateScheduled = false;
    // 将处理器赋给 this.timeUpdateHandler，以便可以正确地移除它
    this.timeUpdateHandler = () => {
      if (isUpdateScheduled) return;
      isUpdateScheduled = true;
      window.requestAnimationFrame(() => {
        if (this.videoElement) { // 再次检查，以防元素在异步回调执行前被移除
          this.updateSubtitleDisplay(this.videoElement.currentTime);
        }
        isUpdateScheduled = false;
      });
    };

    this.videoElement.addEventListener('timeupdate', this.timeUpdateHandler);
    console.log("[YouTubeStrategy] Throttled subtitle update listener added using requestAnimationFrame.");

    // 立即触发一次更新
    this.timeUpdateHandler();
  }

  stopVideoObserver() {
    if (this.videoElement && this.timeUpdateHandler) {
      this.videoElement.removeEventListener('timeupdate', this.timeUpdateHandler);
      console.log("[YouTubeStrategy] Subtitle update listener removed.");
    }
    this.videoElement = null;
    this.timeUpdateHandler = null;
  }

  /**
   * 在YouTube SPA导航时重置状态。
   */
  spaNavigationHandler() {
    console.log('[ModernYouTubeStrategy] SPA navigation detected. Resetting state.');
    // 停止旧的观察者
    this.stopVideoObserver();
    this.renderer?.hide();
    // [修复] 清理已缓存的字幕脚本
    this.subtitleScript = [];
    // 等待新页面的网络请求来重新初始化所有内容。
  }

  cleanup() {
    console.log("[ModernYouTubeStrategy] Strategy cleaning up...");
    this.stopVideoObserver();
    this.subtitleScript = [];
    // [修复] 销毁 Renderer，移除其注入的 DOM 元素和样式
    this.renderer?.destroy();
    this.renderer = null;
    document.body.removeEventListener('yt-navigate-finish', this.spaNavigationHandler);
    document.removeEventListener(YouTubeSubtitleStrategy.EVENT_NAME, this.handleInterceptedData);
    // [修复] 移除网络拦截器并恢复原生函数
    this.removeNetworkInterceptor();
  }

  getStatus() {
    const isSupported = window.location.pathname.includes('/watch');
    // 状态由是否拥有翻译缓存以及视频观察器是否在运行来决定
    const isEnabled = this.subtitleScript.length > 0 && !!this.videoElement;
    return { isSupported, isEnabled };
  }
}

export { YouTubeSubtitleStrategy };

// Self-register with the global manager
if (window.subtitleManager) {
  window.subtitleManager.registerStrategy(YouTubeSubtitleStrategy);
}