// video-subtitle-observer.js 应该只包含一个简单的 MutationObserver 包装器，
// 但根据我们最终的实现，这个依赖甚至可以被移除，因为我们直接在策略中创建了 MutationObserver。
// 为了保持接口，我们暂时保留它。
import { VideoSubtitleObserver } from './video-subtitle-observer.js';

/**
 * SubtitleRenderer 负责将翻译字幕渲染到屏幕上。
 * 它处理样式的注入、覆盖层的创建以及文本的更新。
 */
class SubtitleRenderer {
    constructor(containerElement) {
        if (!containerElement) {
            throw new Error("Renderer requires a valid container element.");
        }
        this.container = containerElement;
        this.overlayId = 'san-reader-translation-overlay';
        this.styleId = 'san-reader-renderer-styles';
        this.overlay = null;

        this.injectStyles();
        this.createOverlay();
    }

    /**
     * 向页面注入用于翻译层的CSS样式。
     * 使用 Flexbox 来优雅地处理原文和译文的布局。
     */
    injectStyles() {
        if (document.getElementById(this.styleId)) return;

        const style = document.createElement('style');
        style.id = this.styleId;
        style.textContent = `
            .caption-window {
                /* 覆盖YouTube的内联样式，让高度由内容决定 */
                height: auto !important;
                /* 使用 Flexbox 进行垂直布局 */
                display: flex;
                flex-direction: column;
                align-items: center;
            }

            #${this.overlayId} {
                /* 作为 flex item，自然地排在原始字幕下方 */
                order: 2; /* 确保翻译在原文之后 */
                padding-top: 5px;
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                pointer-events: none;
            }

            .caption-window .captions-text {
                order: 1; /* 确保原文在前 */
            }

            #${this.overlayId} .translation-line {
                padding: 2px 8px;
                color: #fff;
                background-color: rgba(8, 8, 8, 0.75);
                font-size: 1.2em; /* 使用 em 相对于父元素字体大小，适应性更好 */
                line-height: 1.4;
                font-family: "YouTube Noto", Roboto, "Arial Unicode Ms", Arial, sans-serif;
                white-space: pre-wrap;
                text-shadow: 0.05em 0.05em 0.1em rgba(0,0,0,0.9);
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 创建并挂载翻译覆盖层。
     */
    createOverlay() {
        if (!this.container) return;
        this.container.style.position = 'relative'; // 确保定位上下文

        let overlay = this.container.querySelector(`#${this.overlayId}`);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = this.overlayId;
            this.container.appendChild(overlay);
        }
        this.overlay = overlay;
    }

    /**
     * 渲染翻译文本。
     * @param {string[]} translatedLines - 要显示的翻译行文本数组。
     */
    render(translatedLines) {
        if (!this.overlay) this.createOverlay();
        if (!this.overlay) return; // 如果创建失败，则中止

        this.overlay.innerHTML = '';

        if (translatedLines && translatedLines.length > 0) {
            translatedLines.forEach(line => {
                if (line.trim()) {
                    const lineElement = document.createElement('div');
                    lineElement.className = 'translation-line';
                    lineElement.textContent = line;
                    this.overlay.appendChild(lineElement);
                }
            });
        }
    }

    /**
     * 清理资源，移除添加的元素和样式。
     */
    destroy() {
        document.getElementById(this.overlayId)?.remove();
        document.getElementById(this.styleId)?.remove();
        this.overlay = null;
    }
}

/**
 * YouTubeSubtitleStrategy 实现了在 YouTube 上获取和显示双语字幕的核心逻辑。
 * 它采用拦截网络请求、智能解析、批量翻译和精确定位匹配的策略。
 */
class YouTubeSubtitleStrategy {
    static API_URL_FRAGMENT = '/api/timedtext';
    static SEGMENT_SELECTOR = '.ytp-caption-segment';
    static SCRIPT_ID = 'san-reader-network-interceptor';
    static EVENT_NAME = 'san-reader-subtitle-data';

    constructor() {
        this.observer = null;
        this.renderer = null;

        // 核心数据结构
        this.originalSentences = [];
        this.translatedSentences = [];
        this.script = ''; // 由所有原文句子拼接成的“剧本”
        this.sentenceStartIndexes = []; // “剧本”中每句话的起始索引

        // 绑定 this 上下文
        this.spaNavigationHandler = this.spaNavigationHandler.bind(this);
        this.handleInterceptedData = this.handleInterceptedData.bind(this);
        this.updateDisplay = this.updateDisplay.bind(this);
    }

    initialize() {
        console.log("[DualSubs] Initializing YouTube Strategy.");
        this.injectNetworkInterceptor();
        document.addEventListener(YouTubeSubtitleStrategy.EVENT_NAME, this.handleInterceptedData);
        document.body.addEventListener('yt-navigate-finish', this.spaNavigationHandler);
    }

    /**
     * 注入一个脚本以拦截 fetch 和 XMLHttpRequest 请求来捕获字幕数据。
     */
    injectNetworkInterceptor() {
        if (document.getElementById(YouTubeSubtitleStrategy.SCRIPT_ID)) return;
        const script = document.createElement('script');
        script.id = YouTubeSubtitleStrategy.SCRIPT_ID;

        const interceptorCode = (urlFragment, eventName) => {
            const dispatchData = (data) => document.dispatchEvent(new CustomEvent(eventName, { detail: data }));
            // 拦截 XHR
            const xhrOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url) { this._url = url; return xhrOpen.apply(this, arguments); };
            const xhrSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function () {
                if (this._url?.includes(urlFragment)) {
                    this.addEventListener('load', () => dispatchData(this.responseText));
                }
                return xhrSend.apply(this, arguments);
            };
            // 拦截 fetch
            const nativeFetch = window.fetch;
            window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : input.url;
                if (url?.includes(urlFragment)) {
                    return nativeFetch.apply(this, arguments).then(response => {
                        const clone = response.clone();
                        clone.text().then(text => dispatchData(text));
                        return response;
                    });
                }
                return nativeFetch.apply(this, arguments);
            };
        };

        script.textContent = `(${interceptorCode.toString()})('${YouTubeSubtitleStrategy.API_URL_FRAGMENT}', '${YouTubeSubtitleStrategy.EVENT_NAME}');`;
        (document.head || document.documentElement).appendChild(script).remove();
        console.log("[DualSubs] Network interceptor injected.");
    }

    handleInterceptedData(event) {
        console.log("[DualSubs] Subtitle data intercepted.");
        this.processAndTranslateSubtitles(event.detail);
    }

    /**
     * 解析字幕数据，智能地分割成句子，发送翻译，并构建用于匹配的“剧本”。
     * @param {string} subtitleContent - 原始字幕数据 (JSON 格式)。
     */
    async processAndTranslateSubtitles(subtitleContent) {
        try {
            const jsonData = JSON.parse(subtitleContent);
            if (!jsonData?.events) throw new Error("Invalid subtitle JSON format.");

            // 1. 拼接所有文本片段成一个连续的字符串
            let sentenceBuffer = jsonData.events
                .filter(e => e.segs)
                .flatMap(e => e.segs.map(s => s.utf8.replace(/\n/g, ' ')))
                .join('');

            // 2. 使用正则表达式智能地分割成句子
            const sentenceRegex = /[^.!?。？！]+[.!?。？！]?/g;
            const sentences = sentenceBuffer.match(sentenceRegex)?.map(s => s.trim()).filter(s => s && !s.startsWith('[') && !s.endsWith(']')) || [];
            if (sentences.length === 0) throw new Error("No sentences could be parsed.");

            console.log(`[DualSubs] Split into ${sentences.length} sentences for translation.`);

            // 3. 批量翻译
            const translatedSentences = await this.requestBatchTranslation(sentences);
            if (!translatedSentences || sentences.length !== translatedSentences.length) {
                throw new Error("Translation service failed or returned mismatched results.");
            }

            // 4. 存储数据并构建“剧本”和索引
            this.originalSentences = sentences;
            this.translatedSentences = translatedSentences;
            this.script = this.originalSentences.join(' ');
            this.sentenceStartIndexes = [];
            let currentIndex = 0;
            this.originalSentences.forEach(sentence => {
                this.sentenceStartIndexes.push(currentIndex);
                currentIndex += sentence.length + 1; // +1 for the space joiner
            });

            console.log("[DualSubs] Cache and script index built. Activating display observer.");
            this.startObserverForInstantDisplay();
        } catch (error) {
            console.error(`[DualSubs] Failed to process subtitles: ${error.message}`);
            this.stopObserver();
        }
    }

    /**
     * 向后台脚本发送批量翻译请求。
     */
    requestBatchTranslation(texts) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'TRANSLATE_BATCH', payload: { texts } }, response => {
                if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
                if (response?.success) {
                    return resolve(response.translatedTexts);
                }
                reject(new Error(response?.error || "Invalid response from background."));
            });
        });
    }

    /**
     * 启动一个智能的 MutationObserver 来监听字幕变化并触发显示更新。
     */
    startObserverForInstantDisplay() {
        this.stopObserver();
        const playerContainer = document.querySelector('#movie_player');
        if (!playerContainer) {
            console.error("[DualSubs] Player container not found. Cannot start observer.");
            return;
        }

        const mutationCallback = (mutations) => {
            // 忽略由我们自己的渲染器引起的变化，以防止无限循环
            const isSelfMutation = mutations.some(m => m.target.id === this.renderer?.overlayId || m.target.closest(`#${this.renderer?.overlayId}`));
            if (!isSelfMutation) {
                this.updateDisplay();
            }
        };

        this.observer = new MutationObserver(mutationCallback);
        this.observer.observe(playerContainer, { childList: true, subtree: true, characterData: true });
        console.log('[DualSubs] Smart display observer is now active.');
        this.updateDisplay(); // 首次调用以处理已存在的字幕
    }

    /**
     * “剧本匹配”核心算法：根据屏幕上当前的文本，在完整的“剧本”中定位，并显示对应的翻译。
     */
    updateDisplay() {
        const captionWindow = document.querySelector('.caption-window');
        if (!captionWindow) {
            this.stopObserver(); // 如果字幕窗口消失，则停止一切
            return;
        }

        if (!this.renderer) {
            this.renderer = new SubtitleRenderer(captionWindow);
        }

        const segments = Array.from(captionWindow.querySelectorAll(YouTubeSubtitleStrategy.SEGMENT_SELECTOR));
        const screenText = segments.map(el => el.textContent).join(' ').trim();

        if (screenText === '' || this.originalSentences.length === 0) {
            this.renderer.render([]);
            return;
        }

        const matchPos = this.script.indexOf(screenText);
        let bestMatchIndex = -1;

        if (matchPos !== -1) {
            // 从后往前遍历索引，找到第一个小于等于匹配位置的句子起始点
            for (let i = this.sentenceStartIndexes.length - 1; i >= 0; i--) {
                if (this.sentenceStartIndexes[i] <= matchPos) {
                    bestMatchIndex = i;
                    break;
                }
            }
        } else {
            console.warn(`[DualSubs] Direct match failed for: "${screenText}"`);
        }

        const translatedLinesToShow = [];
        if (bestMatchIndex !== -1) {
            translatedLinesToShow.push(this.translatedSentences[bestMatchIndex]);

            // 检查屏幕文本是否跨越到了下一句，如果是，则一起显示
            const matchEndPos = matchPos + screenText.length;
            if (bestMatchIndex + 1 < this.sentenceStartIndexes.length && matchEndPos > this.sentenceStartIndexes[bestMatchIndex + 1]) {
                translatedLinesToShow.push(this.translatedSentences[bestMatchIndex + 1]);
            }
        }

        this.renderer.render(translatedLinesToShow);
    }

    stopObserver() {
        this.observer?.disconnect();
        this.renderer?.destroy();
        this.observer = null;
        this.renderer = null;
    }

    /**
     * 重置所有状态，为新页面做准备。
     */
    resetState() {
        this.stopObserver();
        this.originalSentences = [];
        this.translatedSentences = [];
        this.script = '';
        this.sentenceStartIndexes = [];
    }

    spaNavigationHandler() {
        console.log("[DualSubs] SPA navigation detected. Resetting state.");
        this.resetState();
    }

    cleanup() {
        console.log("[DualSubs] Cleaning up YouTube Strategy.");
        this.resetState();
        document.removeEventListener(YouTubeSubtitleStrategy.EVENT_NAME, this.handleInterceptedData);
        document.body.removeEventListener('yt-navigate-finish', this.spaNavigationHandler);
        document.getElementById(YouTubeSubtitleStrategy.SCRIPT_ID)?.remove();
    }
}

export { YouTubeSubtitleStrategy };

// Self-register with the global manager
if (window.subtitleManager) {
    window.subtitleManager.registerStrategy(YouTubeSubtitleStrategy);
}