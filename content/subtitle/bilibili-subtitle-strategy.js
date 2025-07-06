import { VideoSubtitleObserver } from './video-subtitle-observer.js';

class BilibiliSubtitleStrategy {
  constructor(onSubtitleChange) {
    this.onSubtitleChange = onSubtitleChange;
    this.observer = null;
  }

  /**
   * 检查当前页面是否支持 Bilibili 字幕（仅域名判断）。
   */
  static isSupportedPage() {
    return window.location.hostname === 'player.bilibili.com';
  }

  /**
   * Bilibili 策略不在任何主框架页面上激活。
   */
  static mainFramePatterns = [];

  /**
   * Bilibili 策略需要在其播放器 iframe 中注入脚本。
   * 此模式将由 service-worker 用来决定是否注入脚本。
   */
  static iframePatterns = ["*://player.bilibili.com/player.html*"];

  initialize() {
    if (!BilibiliSubtitleStrategy.isSupportedPage()) return;

    console.log("[BilibiliStrategy] Initializing.");
    this.startObserver();
    // Bilibili 播放器在切换视频时会重新加载整个 iframe，
    // 因此不需要像 YouTube 那样处理复杂的 SPA 导航事件。
  }

  startObserver() {
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
}

export { BilibiliSubtitleStrategy };