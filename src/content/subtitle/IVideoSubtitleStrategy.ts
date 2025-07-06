interface IVideoSubtitleStrategy {
  /**
   * 检查当前页面是否为该策略支持的视频观看页面。
   * @returns boolean
   */
  isSupportedPage(): boolean;

  /**
   * 初始化字幕翻译功能，例如启动字幕观察器。
   */
  initialize(): void;

  /**
   * 清理字幕翻译功能，例如停止字幕观察器。
   */
  cleanup(): void;

  /**
   * 获取字幕翻译功能的初始状态（启用/禁用）。
   * @returns boolean
   */
  getInitialState(): boolean;
}
