import { VideoSubtitleObserver } from './video-subtitle-observer.js';

class BilibiliSubtitleStrategy {
  constructor(onSubtitleChange) {
    this.onSubtitleChange = onSubtitleChange;
    this.observer = null;
  }

  initialize() {
    console.log("[BilibiliStrategy] Initializing.");
    this.startObserver();
    // Bilibili 播放器在切换视频时会重新加载整个 iframe，
    // 因此不需要像 YouTube 那样处理复杂的 SPA 导航事件。
  }

  startObserver() {
    if (!BilibiliSubtitleStrategy.isSupportedPage()) return;

    this.stopObserver();

    console.log("[BilibiliStrategy] Starting observer.");
    const observerOptions = {
      targetSelector: '.bili-player-subtitle-panel',
      segmentSelector: '.bili-player-subtitle-text > span',
    };
    this.observer = new VideoSubtitleObserver(this.onSubtitleChange, observerOptions);
    this.observer.start();
  }

  stopObserver() {
    this.observer?.stop();
    this.observer = null;
  }

  cleanup() {
    this.stopObserver();
    console.log("[BilibiliStrategy] Cleaned up.");
  }

  getStatus() {
    // isSupported: 页面是否支持此策略（例如，是否为 Bilibili 播放器 iframe）。
    const isSupported = BilibiliSubtitleStrategy.isSupportedPage();
    // isEnabled: 功能当前是否已激活。
    const isEnabled = !!this.observer;
    return { isSupported, isEnabled };
  }

  static isSupportedPage() {
    // Bilibili 播放器页面通常包含一个特定的播放器容器元素。
    // 检查此元素是否存在是判断是否为支持页面的可靠方法。
    return !!document.querySelector('.bpx-player-container, .bilibili-player-video-wrap');
  }
}

export { BilibiliSubtitleStrategy };

// Self-register with the global manager
if (window.subtitleManager) {
    window.subtitleManager.registerStrategy(BilibiliSubtitleStrategy);
}