// content/strategies/youtube-subtitle-strategy.js
import { VideoSubtitleObserver } from '../video-subtitle-observer.js';

class YouTubeSubtitleStrategy {
  constructor(onSubtitleChange) {
    this.onSubtitleChange = onSubtitleChange;
    this.observer = null;
  }

  isSupportedPage() {
    return window.location.hostname.includes('youtube.com') && window.location.pathname.startsWith('/watch');
  }

  initialize() {
    if (!this.isSupportedPage()) return;

    console.log("[SanReader] YouTube watch page detected. Initializing subtitle observer.");
    this.observer = new VideoSubtitleObserver(this.onSubtitleChange);
    this.observer.start();
  }

  cleanup() {
    this.observer?.stop();
    this.observer = null;
  }

  getInitialState() {
    // 假设默认启用，具体逻辑可根据需求调整
    return true;
  }

  getStatus() {
    const canHaveSubtitles = this.isSupportedPage();
    const isEnabled = !!this.observer; // 如果观察器实例存在，则功能为“已启用”。
    return { enabled: isEnabled, disabled: !canHaveSubtitles };
  }
}

export { YouTubeSubtitleStrategy };
