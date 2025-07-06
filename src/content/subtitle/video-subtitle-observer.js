/**
 * @class VideoSubtitleObserver
 * 观察视频播放器的字幕变化，并提取文本进行翻译。
 * 目前是一个通用框架，可以扩展以支持特定网站（如 YouTube）。
 */
class VideoSubtitleObserver {
    /**
     * @param {function(string, HTMLElement): void} onSubtitleChange - 当检测到新字幕时的回调函数。
     * @param {object} options - 观察器的配置。
     * @param {string} options.targetSelector - 要观察的字幕容器的 CSS 选择器。
     * @param {string} options.segmentSelector - 包含单个字幕片段的元素的 CSS 选择器。
     * @param {function(NodeListOf<Element>): string} [options.textJoiner] - (可选) 一个用于从字幕片段中提取并组合文本的函数。
     */
    constructor(onSubtitleChange, { targetSelector, segmentSelector, textJoiner }) {
        this.onSubtitleChange = onSubtitleChange;
        this.targetSelector = targetSelector;
        this.segmentSelector = segmentSelector;
        // 如果未提供自定义的文本组合函数，则使用默认实现。
        this.textJoiner = textJoiner || ((segments) => Array.from(segments).map(el => el.textContent).join(' ').trim());

        this.observer = null;
        this.observedTarget = null;
        this.lastProcessedText = '';
    }

    /**
     * 启动观察器，开始监听特定网站的字幕变化。
     */
    start() {
        // 等待字幕容器出现
        const interval = setInterval(() => {
            const targetNode = document.querySelector(this.targetSelector);
            if (targetNode) {
                clearInterval(interval);
                this.observedTarget = targetNode;
                this.startMutationObserver(targetNode);
                console.log(`Subtitle observer started for target: ${this.targetSelector}`);
            }
        }, 1000); // 每秒检查一次
    }

    /**
     * 创建并启动一个 MutationObserver。
     * @param {HTMLElement} targetNode - 要观察的 DOM 节点。
     */
    stop() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
            console.log('Subtitle observer stopped.');
        }
    }

    /**
     * 创建并启动一个 MutationObserver。
     * @param {HTMLElement} targetNode - 要观察的 DOM 节点。
     */
    startMutationObserver(targetNode) {
        this.observer = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                // 我们关心子节点的变化（字幕行出现/消失）或字符数据的变化
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    this.processSubtitles(targetNode);
                }
            }
        });

        const config = { childList: true, subtree: true, characterData: true };
        this.observer.observe(targetNode, config);
    }

    /**
     * 从字幕容器中处理和提取文本。
     * @param {HTMLElement} container - 包含字幕段落的容器元素。
     */
    processSubtitles(container) {
        const segments = container.querySelectorAll(this.segmentSelector);
        if (!segments || segments.length === 0) return;

        const fullText = this.textJoiner(segments);

        if (fullText && fullText !== this.lastProcessedText) {
            this.lastProcessedText = fullText;
            // 调用回调，将完整的句子和容器（或第一个 segment 的父元素）传递出去
            this.onSubtitleChange(fullText, segments[0].parentElement);
        }
    }
}
export { VideoSubtitleObserver };