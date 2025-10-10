import { escapeHtml } from '../common/utils.js';
import browser from '../lib/browser-polyfill.js';

/**
 * EnhancedTooltipManager
 * 增强版工具提示管理器，支持语音朗读功能和更美观的界面
 */
class EnhancedTooltipManager {
    #tooltipEl = null;
    #activeHideHandler = null;
    #speechSynthesis = window.speechSynthesis;
    #currentUtterance = null;
    #isPlaying = false;
    #currentLanguage = 'auto'; // 'auto', 'source', 'target'
    
    #createTooltip() {
        if (this.#tooltipEl) return;
        
        this.#tooltipEl = document.createElement('div');
        this.#tooltipEl.className = 'foxlate-enhanced-panel';
        document.body.appendChild(this.#tooltipEl);
    }

    #updatePosition({ coords, targetElement }) {
        if (!this.#tooltipEl) return;

        const tooltipRect = this.#tooltipEl.getBoundingClientRect();
        let x, y;

        if (coords) { // Context Menu positioning
            x = coords.clientX - tooltipRect.width / 2;
            y = coords.clientY + 10; // 稍微向下偏移，避免遮挡选中文本

            // 边界检查
            if (y + tooltipRect.height > window.innerHeight - 20) {
                y = coords.clientY - tooltipRect.height - 10;
            }
        } else if (targetElement) { // Hover positioning
            const targetRect = targetElement.getBoundingClientRect();
            x = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
            y = targetRect.top - tooltipRect.height - 8;

            if (y < 10) {
                y = targetRect.bottom + 8;
            }
        }

        // 确保工具提示在视口内
        if (x + tooltipRect.width > window.innerWidth - 20) {
            x = window.innerWidth - tooltipRect.width - 20;
        }
        if (x < 20) {
            x = 20;
        }

        this.#tooltipEl.style.left = `${x}px`;
        this.#tooltipEl.style.top = `${y}px`;
    }

    hide() {
        if (this.#tooltipEl) {
            this.#tooltipEl.classList.remove('visible');
        }
        this.#stopSpeech();
        this.#removeHideListeners();
    }

    #removeHideListeners() {
        if (this.#activeHideHandler) {
            document.removeEventListener('click', this.#activeHideHandler, true);
            window.removeEventListener('scroll', this.#activeHideHandler, true);
            this.#activeHideHandler = null;
        }
    }

    #stopSpeech() {
        if (this.#speechSynthesis.speaking) {
            this.#speechSynthesis.cancel();
        }
        this.#isPlaying = false;
        this.#currentUtterance = null;
        this.#updateSpeechButtons();
    }

    #speakText(text, language = 'auto') {
        this.#stopSpeech();
        
        if (!text || !text.trim()) return;
        
        this.#currentUtterance = new SpeechSynthesisUtterance(text);
        
        // 根据语言设置语音
        if (language === 'source') {
            // 尝试检测源语言并设置相应语音
            this.#currentUtterance.lang = this.#detectLanguage(text);
        } else if (language === 'target') {
            // 使用目标语言（通常是中文）
            this.#currentUtterance.lang = 'zh-CN';
        } else {
            // 自动检测
            this.#currentUtterance.lang = this.#detectLanguage(text);
        }
        
        // 设置事件监听器
        this.#currentUtterance.onstart = () => {
            this.#isPlaying = true;
            this.#updateSpeechButtons();
        };
        
        this.#currentUtterance.onend = () => {
            this.#isPlaying = false;
            this.#updateSpeechButtons();
        };
        
        this.#currentUtterance.onerror = (event) => {
            console.error('[EnhancedTooltipManager] Speech synthesis error:', event);
            this.#isPlaying = false;
            this.#updateSpeechButtons();
        };
        
        this.#speechSynthesis.speak(this.#currentUtterance);
    }

    #detectLanguage(text) {
        // 简单的语言检测逻辑
        const chineseRegex = /[\u4e00-\u9fff]/;
        const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff]/;
        const koreanRegex = /[\uac00-\ud7af]/;
        
        if (chineseRegex.test(text)) {
            return 'zh-CN';
        } else if (japaneseRegex.test(text)) {
            return 'ja-JP';
        } else if (koreanRegex.test(text)) {
            return 'ko-KR';
        } else {
            return 'en-US'; // 默认为英语
        }
    }

    #updateSpeechButtons() {
        if (!this.#tooltipEl) return;
        
        const sourcePlayBtn = this.#tooltipEl.querySelector('.source-speech-btn');
        const targetPlayBtn = this.#tooltipEl.querySelector('.target-speech-btn');
        
        if (sourcePlayBtn) {
            if (this.#isPlaying && this.#currentLanguage === 'source') {
                sourcePlayBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h12v12H6z"/>
                    </svg>
                `;
                sourcePlayBtn.title = '停止朗读';
            } else {
                sourcePlayBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                `;
                sourcePlayBtn.title = '朗读原文';
            }
        }
        
        if (targetPlayBtn) {
            if (this.#isPlaying && this.#currentLanguage === 'target') {
                targetPlayBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h12v12H6z"/>
                    </svg>
                `;
                targetPlayBtn.title = '停止朗读';
            } else {
                targetPlayBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                `;
                targetPlayBtn.title = '朗读译文';
            }
        }
    }

    #createTooltipContent(sourceText, translatedText, options = {}) {
        const { isLoading = false, isError = false } = options;
        
        let content = '<div class="foxlate-panel-content">';
        
        // 头部区域 - 更紧凑
        content += '<div class="foxlate-panel-header">';
        content += '<div class="foxlate-panel-title">Foxlate</div>';
        content += '<button class="foxlate-close-btn" title="关闭">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>' +
            '</svg>' +
        '</button>';
        content += '</div>';
        
        // 内容区域
        content += '<div class="foxlate-panel-body">';
        
        if (isLoading) {
            content += '<div class="foxlate-loading-container">';
            content += '<div class="foxlate-spinner"></div>';
            content += '<div class="foxlate-loading-text">翻译中...</div>';
            content += '</div>';
        } else if (isError) {
            content += `<div class="foxlate-error-message">${escapeHtml(sourceText)}</div>`;
        } else {
            // 原文区域 - 默认完全隐藏
            content += '<div class="foxlate-text-section source-section collapsed">';
            content += '<div class="foxlate-text-header">';
            content += '<span class="foxlate-text-label">原文</span>';
            content += '<div class="foxlate-text-actions">';
            content += '<button class="foxlate-icon-btn toggle-source-btn" title="展开原文">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                    '<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>' +
                '</svg>' +
            '</button>';
            content += '<button class="foxlate-icon-btn source-speech-btn" title="朗读原文" disabled>' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                    '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>' +
                '</svg>' +
            '</button>';
            content += '<button class="foxlate-icon-btn copy-source-btn" title="复制原文" disabled>' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                    '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>' +
                '</svg>' +
            '</button>';
            content += '</div>';
            content += '</div>';
            content += `<div class="foxlate-text-content source-text">${escapeHtml(sourceText).replace(/\n/g, '<br>')}</div>`;
            content += '</div>';
            
            // 译文区域 - 默认显示
            content += '<div class="foxlate-text-section target-section">';
            content += '<div class="foxlate-text-header">';
            content += '<span class="foxlate-text-label">译文</span>';
            content += '<div class="foxlate-text-actions">';
            content += '<button class="foxlate-icon-btn toggle-target-btn" title="收起译文">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                    '<path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z"/>' +
                '</svg>' +
            '</button>';
            content += '<button class="foxlate-icon-btn target-speech-btn" title="朗读译文">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                    '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>' +
                '</svg>' +
            '</button>';
            content += '<button class="foxlate-icon-btn copy-target-btn" title="复制译文">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                    '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>' +
                '</svg>' +
            '</button>';
            content += '</div>';
            content += '</div>';
            content += `<div class="foxlate-text-content target-text">${escapeHtml(translatedText).replace(/\n/g, '<br>')}</div>`;
            content += '</div>';
        }
        
        content += '</div>';
        
        content += '</div>';
        
        return content;
    }

    show(sourceText, translatedText, options = {}) {
        const { coords, targetElement, isLoading = false, isError = false, onHide } = options;
        
        this.#createTooltip();
        if (!this.#tooltipEl) return;

        // 清理之前的状态
        this.hide();
        
        // 设置内容
        this.#tooltipEl.innerHTML = this.#createTooltipContent(sourceText, translatedText, { isLoading, isError });
        
        // 添加事件监听器
        this.#attachEventListeners(sourceText, translatedText, onHide);
        
        // 更新位置并显示
        this.#updatePosition({ coords, targetElement });
        this.#tooltipEl.classList.add('visible');
        
        // 设置自动隐藏监听器
        if (onHide) {
            this.#activeHideHandler = (e) => {
                if (!this.#tooltipEl || this.#tooltipEl.contains(e.target)) return;
                onHide();
            };
            setTimeout(() => {
                document.addEventListener('click', this.#activeHideHandler, true);
                window.addEventListener('scroll', this.#activeHideHandler, true);
            }, 0);
        }
    }

    #attachEventListeners(sourceText, translatedText, onHide) {
        if (!this.#tooltipEl) return;
        
        // 关闭按钮
        const closeBtn = this.#tooltipEl.querySelector('.foxlate-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (onHide) onHide();
            });
        }
        
        // 原文展开/收起按钮
        const toggleSourceBtn = this.#tooltipEl.querySelector('.toggle-source-btn');
        const sourceSection = this.#tooltipEl.querySelector('.source-section');
        if (toggleSourceBtn && sourceSection) {
            toggleSourceBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isCollapsed = sourceSection.classList.contains('collapsed');
                if (isCollapsed) {
                    sourceSection.classList.remove('collapsed');
                    toggleSourceBtn.innerHTML =
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                            '<path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z"/>' +
                        '</svg>';
                    toggleSourceBtn.title = '收起原文';
                    // 启用原文的按钮
                    const sourceBtns = sourceSection.querySelectorAll('.source-speech-btn, .copy-source-btn');
                    sourceBtns.forEach(btn => btn.disabled = false);
                } else {
                    sourceSection.classList.add('collapsed');
                    toggleSourceBtn.innerHTML =
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                            '<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>' +
                        '</svg>';
                    toggleSourceBtn.title = '展开原文';
                    // 禁用原文的按钮
                    const sourceBtns = sourceSection.querySelectorAll('.source-speech-btn, .copy-source-btn');
                    sourceBtns.forEach(btn => btn.disabled = true);
                }
            });
        }
        
        // 译文展开/收起按钮
        const toggleTargetBtn = this.#tooltipEl.querySelector('.toggle-target-btn');
        const targetSection = this.#tooltipEl.querySelector('.target-section');
        if (toggleTargetBtn && targetSection) {
            toggleTargetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isCollapsed = targetSection.classList.contains('collapsed');
                if (isCollapsed) {
                    targetSection.classList.remove('collapsed');
                    toggleTargetBtn.innerHTML =
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                            '<path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z"/>' +
                        '</svg>';
                    toggleTargetBtn.title = '收起译文';
                } else {
                    targetSection.classList.add('collapsed');
                    toggleTargetBtn.innerHTML =
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                            '<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>' +
                        '</svg>';
                    toggleTargetBtn.title = '展开译文';
                }
            });
        }
        
        // 语音按钮
        const sourceSpeechBtn = this.#tooltipEl.querySelector('.source-speech-btn');
        if (sourceSpeechBtn) {
            sourceSpeechBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.#isPlaying && this.#currentLanguage === 'source') {
                    this.#stopSpeech();
                } else {
                    this.#currentLanguage = 'source';
                    this.#speakText(sourceText, 'source');
                }
            });
        }
        
        const targetSpeechBtn = this.#tooltipEl.querySelector('.target-speech-btn');
        if (targetSpeechBtn) {
            targetSpeechBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.#isPlaying && this.#currentLanguage === 'target') {
                    this.#stopSpeech();
                } else {
                    this.#currentLanguage = 'target';
                    this.#speakText(translatedText, 'target');
                }
            });
        }
        
        // 复制按钮
        const copySourceBtn = this.#tooltipEl.querySelector('.copy-source-btn');
        if (copySourceBtn) {
            copySourceBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(sourceText).then(() => {
                    this.#showCopyFeedback(copySourceBtn);
                }).catch(err => {
                    console.error('[EnhancedTooltipManager] Failed to copy source text:', err);
                });
            });
        }
        
        const copyTargetBtn = this.#tooltipEl.querySelector('.copy-target-btn');
        if (copyTargetBtn) {
            copyTargetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(translatedText).then(() => {
                    this.#showCopyFeedback(copyTargetBtn);
                }).catch(err => {
                    console.error('[EnhancedTooltipManager] Failed to copy target text:', err);
                });
            });
        }
    }

    #showCopyFeedback(button) {
        const originalHTML = button.innerHTML;
        button.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
                '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>' +
            '</svg>';
        button.classList.add('copied');
        
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('copied');
        }, 1500);
    }
}

export default new EnhancedTooltipManager();