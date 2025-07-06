// content/strategies/youtube-subtitle-strategy.js
import { VideoSubtitleObserver } from './video-subtitle-observer.js';

class YouTubeSubtitleStrategy {
  constructor(onSubtitleChange) {
    this.onSubtitleChange = onSubtitleChange;
    this.observer = null;
    // 绑定 SPA 导航处理函数，确保 this 上下文正确
    this.spaNavigationHandler = this.spaNavigationHandler.bind(this);
  }

  initialize() {
    // 此方法由管理器调用一次，负责设置所有内容，包括持久的 SPA 监听器
    console.log("[YouTubeStrategy] Initializing for the first time.");
    this.startObserver(); // 在当前页面上启动观察

    // 添加 SPA 导航监听器，此监听器将在此策略的整个生命周期中存在
    document.body.addEventListener('yt-navigate-finish', this.spaNavigationHandler);
  }

  startObserver() {
    // 此方法只处理 MutationObserver 的启动
    if (!YouTubeSubtitleStrategy.isSupportedPage()) return;

    // 在创建新观察器之前，清理任何旧的观察器
    this.stopObserver();

    console.log("[YouTubeStrategy] Starting observer.");
    const observerOptions = {
        targetSelector: '.ytp-caption-window-container',
        segmentSelector: '.ytp-caption-segment',
    };
    this.observer = new VideoSubtitleObserver(this.onSubtitleChange, observerOptions);
    this.observer.start();
  }

  stopObserver() {
    if (this.observer) {
      this.observer.stop();
      this.observer = null;
      console.log("[YouTubeStrategy] Stopped observer.");
    }
  }

  cleanup() {
    // 完全清理，由管理器在不再需要此策略时调用
    this.stopObserver();
    document.body.removeEventListener('yt-navigate-finish', this.spaNavigationHandler);
    console.log("[YouTubeStrategy] Fully cleaned up (observer and SPA listener).");
  }

  getStatus() {
    // isSupported: 页面是否支持此策略（例如，是否为 YouTube 观看页面）。
    const isSupported = YouTubeSubtitleStrategy.isSupportedPage();
    // isEnabled: 功能当前是否已激活（例如，用户是否已打开字幕翻译开关）。
    const isEnabled = !!this.observer;
    return { isSupported, isEnabled };
  }

  spaNavigationHandler() {
    console.log('[YouTubeStrategy] SPA navigation detected. Restarting observer.');
    // 在 SPA 内部导航时，我们只需要重启观察器，而不是整个策略
    setTimeout(() => this.startObserver(), 500);
  }

  static isSupportedPage() {
    // YouTube 视频观看页面的 URL 路径中通常包含 /watch
    return window.location.pathname.includes('/watch');
  }
}

export { YouTubeSubtitleStrategy };

// Self-register with the global manager
if (window.subtitleManager) {
    window.subtitleManager.registerStrategy(YouTubeSubtitleStrategy);
}
