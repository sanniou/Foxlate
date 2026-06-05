import browser from '../../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../../common/message-types.js';
import { logContentError } from '../content-logger.js';
import { YouTubeSubtitleRenderer } from './youtube-subtitle-renderer.js';
import { parseYouTubeTimedSentences } from './youtube-subtitle-parser.js';

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
    this.renderer = new YouTubeSubtitleRenderer({
      playerContainerSelector: YouTubeSubtitleStrategy.SELECTORS.PLAYER_CONTAINER,
    });
    this.subtitleScript = [];

    // 绑定所有需要正确 `this` 上下文的处理器
    this.spaNavigationHandler = this.spaNavigationHandler.bind(this);
    this.handleInterceptedData = this.handleInterceptedData.bind(this);
  }

  initialize() {
    window.getEffectiveSettings().then(settings => {
        this.settings = settings;
        this.renderer.updateOptions({
            displayMode: this.settings?.subtitleSettings?.displayMode || 'off'
        });
         if (this.settings?.subtitleSettings?.enabled) {
          this.startVideoObserver();
        }
    }).catch(err => {
        logContentError('YouTubeSubtitleStrategy.initialize', err);
    });

    this.injectNetworkInterceptor();

    document.addEventListener(YouTubeSubtitleStrategy.EVENT_NAME, this.handleInterceptedData);
    document.body.addEventListener('yt-navigate-finish', this.spaNavigationHandler);
  }

  /**
   * (新增) 接收来自 SubtitleManager 的设置更新，并应用它们。
   * @param {object} newSettings - 最新的有效设置对象。
   */
  updateSettings(newSettings) {
    this.settings = newSettings;
    const newMode = this.settings?.subtitleSettings?.displayMode || 'off';

    if (!this.renderer) {
      return;
    }

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
          this.addEventListener('load', () => {
            if (this.readyState === 4) {
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
          return originalFetch.apply(this, args).then(response => {
            const clonedResponse = response.clone();
            clonedResponse.text().then(text => {
              dispatchData(text);
            }).catch(() => {});
            return response;
          });
        }
        return originalFetch.apply(this, args);
      };
    };

    script.textContent = `(${interceptorCode.toString()})('${YouTubeSubtitleStrategy.API_URL_FRAGMENT}', '${YouTubeSubtitleStrategy.EVENT_NAME}');`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
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
    this.processAndTranslateSubtitles(event.detail);
  }

  /**
   * 解析、翻译并缓存字幕。这是核心处理流程。
   * 这个版本专门为处理分段的、带有 aAppend 标志的字幕格式进行了优化。
   * @param {string} subtitleContent 
   */

  async processAndTranslateSubtitles(subtitleContent) {
    try {
      const timedSentences = parseYouTubeTimedSentences(subtitleContent);

      if (timedSentences.length === 0) {
        return;
      }

      // --- 步骤 4: 批量翻译并创建最终的字幕脚本 (无变化) ---
      const originalTexts = timedSentences.map(s => s.text);
      // 确保在翻译前我们有有效的设置。
      if (!this.settings) {
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

      this.startVideoObserver();

    } catch (error) {
      logContentError('YouTubeSubtitleStrategy.processAndTranslateSubtitles', error);
      this.stopVideoObserver();
    }
  }
  
  async requestBatchTranslation(texts, targetLanguage, translatorEngine) {
    try {
      // 直接使用 await，因为 browser.runtime.sendMessage 返回一个 Promise
      // 消息格式与其他处理器保持一致，使用 payload
      const response = await browser.runtime.sendMessage({
        type: MESSAGE_TYPES.TRANSLATE_BATCH,
        payload: { texts, targetLanguage, translatorEngine }
      });
      if (response && response.success) {
        return response.translatedTexts;
      }
      throw new Error(response?.error || "从后台脚本收到的批量翻译响应无效。");
    } catch (error) {
      logContentError('YouTubeSubtitleStrategy.requestBatchTranslation', error);
      throw error;
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
      return;
    }
    this.videoElement = playerContainer.querySelector(YouTubeSubtitleStrategy.SELECTORS.VIDEO_ELEMENT);
    if (!this.videoElement) {
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

    // 立即触发一次更新
    this.timeUpdateHandler();
  }

  stopVideoObserver() {
    if (this.videoElement && this.timeUpdateHandler) {
      this.videoElement.removeEventListener('timeupdate', this.timeUpdateHandler);
    }
    this.videoElement = null;
    this.timeUpdateHandler = null;
  }

  /**
   * 在YouTube SPA导航时重置状态。
   */
  spaNavigationHandler() {
    this.stopVideoObserver();
    this.renderer?.hide();
    // [修复] 清理已缓存的字幕脚本
    this.subtitleScript = [];
    // 等待新页面的网络请求来重新初始化所有内容。
  }

  cleanup() {
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
