import browser from '../lib/browser-polyfill.js';
import { shouldTranslate } from '../common/precheck.js';
import { marked } from '../lib/marked.esm.js';
import { DisplayManager } from './display-manager.js';
import { SettingsManager } from '../common/settings-manager.js';
import { DOMWalker } from './dom-walker.js';
import { SKIPPED_TAGS } from '../common/constants.js';

/**
 * 集中式错误记录器，用于内容脚本。
 * @param {string} context - 错误发生的上下文（例如，函数名）。
 * @param {Error} error - 错误对象。
 */
function logError(context, error) {
    // 过滤掉用户中断的“错误”，因为它不是一个真正的异常
    // AbortError 是一个受控的中断，不是真正的错误。记录它用于调试，但不应视为错误。
    if (error && error.name === 'AbortError') {
        console.log(`[Foxlate] Task was interrupted in ${context}:`, error.message);
        return;
    }
    console.error(`[Foxlate Content Script Error] in ${context}:`, error.message, error.stack);
}

/**
 * 生成一个 v4 UUID。
 * @returns {string} A UUID.
 */
function generateUUID() {
    // crypto.randomUUID() is supported in all modern browsers that support Manifest V3.
    // The fallback is unnecessary and has been removed for clarity and security.
    return self.crypto.randomUUID();
}

/**
 * 获取当前页面生效的设置。
 * 此函数从后台获取原始设置，然后在内容脚本的上下文中编译正则表达式。
 * 这避免了在通过消息传递API发送不可序列化的 RegExp 对象时出现的问题。
 * @returns {Promise<object>} - 合并后的有效配置对象。
 */
async function getEffectiveSettings() {
    // 1. 从后台获取原始（可序列化）的设置
    const rawSettings = await browser.runtime.sendMessage({
        type: 'GET_EFFECTIVE_SETTINGS',
        payload: { hostname: window.location.hostname }
    });

    // 2. 在内容脚本的上下文中预编译正则表达式
    if (rawSettings && rawSettings.precheckRules) {
        rawSettings.precheckRules = SettingsManager.precompileRules(rawSettings.precheckRules);
    }

    return rawSettings;
}


const CSS_FILE_PATH = browser.runtime.getURL("content/style.css");

/**
 * 向指定的根（通常是 Shadow Root）注入 CSS。
 * @param {ShadowRoot} root 要注入CSS的Shadow Root。
 * @param {HTMLElement} host 这个Shadow Root的宿主元素。
 */
function injectCSSIntoRoot(root, host) {
    // 关键检查：在宿主元素上检查标记
    if (!root || !host || host.dataset.foxlateCssInjected === 'true') {
        return;
    }

    try {
        const styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.type = 'text/css';
        styleLink.href = CSS_FILE_PATH;

        root.prepend(styleLink);

        // 在宿主元素上设置标记
        host.dataset.foxlateCssInjected = 'true';
        console.log('[Foxlate] Injected CSS and marked host element:', host);
    } catch (error) {
        console.error('[Foxlate] Failed to inject CSS into a Shadow Root:', error);
    }
}

/**
 * 递归查找并返回页面上所有的搜索根（主文档和所有开放的 Shadow Root）。
 * @param {Node} rootNode - 开始搜索的节点，通常是 document.body。
 * @returns {DocumentFragment[]} 一个包含所有搜索根的数组。
 */
/**
 * (优化版本) 递归查找并返回页面上所有的搜索根（包括初始节点和所有内部的 Shadow Root）。
 * 此函数通过以下优化提高性能：
 * 1. 使用更高效的元素遍历方法
 * 2. 减少不必要的函数调用
 * 3. 优化Shadow DOM查找逻辑
 * @param {Node} rootNode - 开始搜索的节点，例如 document.body 或一个 shadowRoot。
 * @returns {(Document|DocumentFragment|Element)[]} 一个包含所有搜索根的数组。
 */
function findAllSearchRoots(rootNode) {
    if (!rootNode) return [];

    const roots = [rootNode];
    // (优化) 使用 TreeWalker API 代替 querySelectorAll('*')。
    // TreeWalker 是一个高效的、低内存占用的 DOM 遍历迭代器，它避免了
    // 创建一个包含所有子节点的巨大 NodeList，从而在复杂的 DOM 结构中
    // 显著提升性能。
    const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_ELEMENT, // 只访问元素节点
        null,
        false
    );

    let currentNode;
    while (currentNode = walker.nextNode()) {
        if (currentNode.shadowRoot) {
            // 找到了一个宿主元素和它的 shadowRoot
            injectCSSIntoRoot(currentNode.shadowRoot, currentNode);
            // 对新发现的 shadowRoot 进行递归搜索
            roots.push(...findAllSearchRoots(currentNode.shadowRoot));
        }
    }
    return roots;
}

/**
 * (新) 使用“自顶向下”的 CSS 选择器模型查找页面上所有可翻译的元素。
 * 此函数取代了旧的基于CSS选择器的方法。
 * @param {object} effectiveSettings - 设置对象（用于预检查）。
 * @param {Node[]} rootNodes - 要在其中搜索的根节点。
 * @returns {HTMLElement[]} 一个包含最适合翻译的容器元素的数组。
 */
function findTranslatableElements(effectiveSettings, rootNodes = [document.body]) {
    const contentSelector = effectiveSettings?.translationSelector?.content?.trim();

    // 如果没有配置内容选择器，则不进行任何操作。
    if (!contentSelector) {
        return [];
    }

    const allCandidates = new Set();
    for (const root of rootNodes) {
        // 确保根节点是可以执行 querySelectorAll 的节点类型。
        // 这包括元素节点 (Element) 和文档片段节点 (DocumentFragment)，例如 Shadow Root。
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
            continue;
        }

        // 如果根节点本身匹配，也将其加入候选列表。
        // 注意：Shadow Root 本身没有 tagName，不能直接 matches，但它的 host 元素可能匹配。
        // 为简化逻辑，我们主要关注其内部的查询。
        if (root.nodeType === Node.ELEMENT_NODE && root.matches(contentSelector)) {
            allCandidates.add(root);
        }
        // 查询根节点下的所有匹配项。
        // Element 和 DocumentFragment 都支持 querySelectorAll。
        root.querySelectorAll(contentSelector).forEach(el => allCandidates.add(el));
    }

    // (新) 优化：如果根据选择器没有找到任何候选元素，则提前返回，
    // 避免执行后续更复杂的（且不必要的）孤立节点和父节点分析。
    if (allCandidates.size === 0) {
        return [];
    }

    const finalCandidates = new Set();
    const potentialMixedParents = new Set();

    // --- 步骤 1: 识别叶子节点和潜在的混合内容父节点 ---
    for (const el of allCandidates) {
        // 检查当前元素 'el' 是否包含任何其他也匹配选择器的子元素。
        // 使用原生 querySelector 性能远高于在 allCandidates 中循环。
        if (!el.querySelector(contentSelector)) {
            // 如果没有，它就是一个“叶子”节点，直接添加到最终候选列表中。
            finalCandidates.add(el);
        } else {
            // 如果有，它就是一个父节点，可能包含需要翻译的“孤立”文本。
            potentialMixedParents.add(el);
        }
    }

    // 这一步是关键，用于处理像 `<div>Some text <i>and italic</i> <p>More text</p></div>` 这样的结构，
    // 其中 "Some text <i>and italic</i>" 会被旧逻辑遗漏。
    for (const parent of potentialMixedParents) {
        let consecutiveOrphans = []; // 用于收集连续的孤立节点

        const wrapOrphans = () => {
            if (consecutiveOrphans.length === 0) return;

            // (新) 增强版的内容显著性检查。
            // 一个节点序列只有在满足以下条件时才被认为是“重要的”并被包裹：
            // - 包含至少一个包含非空白字符的文本节点。
            // - 或包含至少一个不是被跳过类型（如<script>, <hr>）且自身包含非空白文本的元素节点。
            const hasSignificantContent = consecutiveOrphans.some(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    return node.textContent.trim() !== '';
                }
                if (node.nodeType === Node.ELEMENT_NODE) {
                    return !SKIPPED_TAGS.has(node.tagName.toUpperCase()) && node.textContent.trim() !== '';
                }
                return false; // 忽略注释等其他节点类型
            });

            if (hasSignificantContent) {
                const wrapperElement = document.createElement('foxlate-wrapper');
                wrapperElement.dataset.foxlateGenerated = 'true';
                // 将包裹元素插入到第一个孤立节点之前。
                parent.insertBefore(wrapperElement, consecutiveOrphans[0]);

                // 将所有连续的孤立节点（包括空白文本节点）移动到包裹元素中，以保持原始间距。
                consecutiveOrphans.forEach(node => wrapperElement.appendChild(node));

                // 将新创建的包裹元素添加到候选列表中进行翻译。
                finalCandidates.add(wrapperElement);
            }
            consecutiveOrphans = []; // 重置收集器
        };

        // 遍历父节点的所有直接子节点。
        for (const child of Array.from(parent.childNodes)) {
            // (新) 关键修复：如果子节点本身就是一个由我们生成的包裹器，
            // 那么它就是一个明确的“边界”。我们应该立即处理之前收集的任何孤立节点，
            // 然后跳过这个包裹器，以防止递归包裹。
            if (child.nodeType === Node.ELEMENT_NODE && child.dataset.foxlateGenerated === 'true') {
                wrapOrphans(); // 处理在它之前的所有孤立节点
                continue;      // 跳过这个包裹器本身
            }

            // (新) 重新定义“边界”节点。一个节点如果满足以下任一条件，它就不是孤立的：
            // 1. 它本身匹配翻译选择器。
            // 2. 它已经被翻译或正在被翻译。
            // 3. 它的子孙节点中包含匹配翻译选择器的元素。
            // 这可以防止将包含其他待翻译内容的容器（如 <table>）错误地包裹起来。
            const isBoundary = child.nodeType === Node.ELEMENT_NODE && (
                allCandidates.has(child) || // 子节点本身匹配选择器
                child.dataset.translationId || // 子节点已翻译
                child.querySelector(contentSelector) // (优化) 子节点包含一个匹配的后代
            );

            if (isBoundary) {
                // 遇到一个已选择的元素，意味着之前的孤立节点序列结束了。
                wrapOrphans();
            } else {
                // 这是一个孤立节点（文本节点、未被选择的元素如<i>, <b>等），将它加入收集器。
                consecutiveOrphans.push(child);
            }
        }

        // 处理遍历结束后可能剩余在收集器中的最后一组孤立节点。
        wrapOrphans();
    }

    // 延迟预检查到实际翻译时执行，避免在元素收集阶段进行不必要的预检查
    return Array.from(finalCandidates).filter(el =>
        // 已经被处理或正在处理的元素
        !el.dataset.translationId
    );
}

// --- (新) Summary Manager ---

/**
 * (重构) 管理内容总结功能的类，遵循 MD3 设计模式。
 * 负责创建浮动操作按钮 (FAB)、处理拖动、显示总结对话框，并与后台通信。
 */
class SummaryManager {
    constructor(settings) {
        // (已修复) 直接使用传入的有效设置对象，而不是不存在的 summarySettings 子对象。
        // summarySettings 属性现在直接从顶层设置中获取。
        this.settings = settings;
        this.summarySettings = settings.summarySettings || {}; // 为 summarySettings 提供一个后备空对象
        this.mainBodyElement = null;
        this.fab = null;
        this.dialog = null;

        this.state = 'idle'; // 'idle', 'loading', 'summarized'
        this.conversationHistory = []; // (新) 存储对话历史
        this.isDialogVisible = false;
        this.wasDialogVisibleBeforeDrag = false;

        // 用于在页面滚动/缩放时保持UI同步
        this.visibilityObserver = null;

        // 绑定 this，以便在事件监听器中正确使用
        this.handleFabClick = this.handleFabClick.bind(this);
        this.handleDragStart = this.handleDragStart.bind(this);
        this.handleSendMessage = this.handleSendMessage.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleDialogClose = this.handleDialogClose.bind(this);
        this.handleCopyConversation = this.handleCopyConversation.bind(this);
        this.handleRefreshConversation = this.handleRefreshConversation.bind(this);
        this.handleRegenerateMessage = this.handleRegenerateMessage.bind(this);
    }

    /**
     * 初始化总结功能。
     */
    initialize() {
        if (!this.summarySettings?.enabled || !this.summarySettings.mainBodySelector) {
            return; // 功能未启用或未配置
        }

        this.mainBodyElement = document.querySelector(this.summarySettings.mainBodySelector);
        if (!this.mainBodyElement) {
            console.warn(`[Foxlate Summary] Main body element not found with selector: "${this.summarySettings.mainBodySelector}"`);
            return;
        }

        this.createFab();
        this.positionFab();
        this.setupVisibilityObserver();
    }

    createFab() {
        this.fab = document.createElement('button');
        this.fab.className = 'foxlate-summary-fab';
        this.fab.innerHTML = `
            <span class="icon">
                <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M11.25 3.5H12.75V5H11.25V3.5ZM12 19C11.35 19 10.8 18.8 10.35 18.35C9.9 17.9 9.7 17.35 9.7 16.7C9.7 16.05 9.9 15.5 10.35 15.05C10.8 14.6 11.35 14.4 12 14.4C12.65 14.4 13.2 14.6 13.65 15.05C14.1 15.5 14.3 16.05 14.3 16.7C14.3 17.35 14.1 17.9 13.65 18.35C13.2 18.8 12.65 19 12 19ZM5 12.75V11.25H3.5V12.75H5ZM19 12C19 11.35 18.8 10.8 18.35 10.35C17.9 9.9 17.35 9.7 16.7 9.7C16.05 9.7 15.5 9.9 15.05 10.35C14.6 10.8 14.4 11.35 14.4 12C14.4 12.65 14.6 13.2 15.05 13.65C15.5 14.1 16.05 14.3 16.7 14.3C17.35 14.3 17.9 14.1 18.35 13.65C18.8 13.2 19 12.65 19 12ZM20.5 12.75V11.25H19V12.75H20.5ZM11.25 20.5V19H12.75V20.5H11.25ZM7.05 7.05L6 6L7.05 4.95L8.1 6L7.05 7.05ZM15.9 18.1L14.85 17.05L15.9 16L17 17.05L15.9 18.1ZM15.9 8.1L17 7.05L15.9 6L14.85 7.05L15.9 8.1Z"/></svg>
            </span>
            <span class="label">${browser.i18n.getMessage('summarizeButtonText')}</span>
        `;

        document.body.appendChild(this.fab);

        this.fab.addEventListener('mousedown', this.handleDragStart);
    }

    positionFab() {
        const mainRect = this.mainBodyElement.getBoundingClientRect();
        const fabRect = this.fab.getBoundingClientRect();
        const offset = { x: 16, y: 16 };

        let top = window.scrollY + mainRect.top + offset.y;
        let left = window.scrollX + mainRect.right - fabRect.width + offset.x;

        // 边界检查
        top = Math.max(0, Math.min(top, window.innerHeight - fabRect.height));
        left = Math.max(0, Math.min(left, window.innerWidth - fabRect.width));

        this.fab.style.top = `${top}px`;
        this.fab.style.left = `${left}px`;
    }

    async handleFabClick() {
        if (this.state === 'loading') return;

        if (this.state === 'idle') {
            this.state = 'loading';
            this.setFabLoadingState(true);
            await this.fetchSummary();
            this.setFabLoadingState(false);
            this.state = 'summarized';
            // 首次获取内容后，自动显示对话框
            this.showDialog();
        } else if (this.state === 'summarized') {
            this.toggleDialog();
        }
    }

    async fetchSummary() {
        if (!this.dialog) this.createDialog();

        this.addMessageToConversation('...', 'loading');

        try {
            const textToSummarize = this.mainBodyElement.innerText;
            const response = await browser.runtime.sendMessage({
                type: 'SUMMARIZE_CONTENT',
                payload: {
                    text: textToSummarize,
                    aiModel: this.summarySettings.aiModel,
                    targetLang: this.settings.targetLanguage // (已修复) 从顶层设置获取目标语言
                }
            });

            if (response.success) {
                // (新) 将成功的总结作为对话的开端
                this.conversationHistory = []; // 清空历史
                this.conversationHistory.push({ role: 'assistant', content: response.summary });
                this.updateLastMessage(response.summary, 'ai');
            } else {
                const errorMessage = browser.i18n.getMessage('summaryErrorText') + response.error;
                this.updateLastMessage(errorMessage, 'ai', true);
            }
        } catch (error) {
            logError('fetchSummary', error);
            this.updateLastMessage(browser.i18n.getMessage('summaryErrorText') + error.message, 'ai', true);
        }
    }

    createDialog() {
        this.dialog = document.createElement('div');
        this.dialog.className = 'foxlate-summary-dialog';
        this.dialog.innerHTML = `
            <div class="foxlate-summary-dialog-header">
                <h3 class="foxlate-summary-dialog-title">${browser.i18n.getMessage('summaryModalTitle')}</h3>
                <div class="foxlate-summary-dialog-actions">
                    <button class="foxlate-summary-dialog-refresh-btn foxlate-summary-dialog-icon-btn" aria-label="Refresh Conversation">
                        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                    </button>
                    <button class="foxlate-summary-dialog-copy-btn foxlate-summary-dialog-icon-btn" aria-label="Copy All">
                        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                    </button>
                </div>
            </div>
            <div class="foxlate-summary-dialog-conversation">
                <!-- 消息将在这里动态添加 -->
            </div>
            <div class="foxlate-summary-dialog-footer">
                <textarea class="foxlate-summary-dialog-input" placeholder="${browser.i18n.getMessage('summaryInputPlaceholder')}" rows="1"></textarea>
                <button class="foxlate-summary-dialog-send-btn foxlate-summary-dialog-icon-btn" aria-label="Send">
                    <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
            </div>
        `;
        document.body.appendChild(this.dialog);

        // 绑定事件
        this.dialog.querySelector('.foxlate-summary-dialog-refresh-btn').addEventListener('click', this.handleRefreshConversation);
        this.dialog.querySelector('.foxlate-summary-dialog-copy-btn').addEventListener('click', this.handleCopyConversation);
        this.dialog.querySelector('.foxlate-summary-dialog-send-btn').addEventListener('click', this.handleSendMessage);
        this.dialog.querySelector('.foxlate-summary-dialog-input').addEventListener('keydown', (e) => {
            // 按下 Enter 发送，Shift+Enter 换行
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        // 自动调整 textarea 高度
        const textarea = this.dialog.querySelector('.foxlate-summary-dialog-input');
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        });

        // (新) 使用事件委托处理所有消息动作
        const conversationArea = this.dialog.querySelector('.foxlate-summary-dialog-conversation');
        conversationArea.addEventListener('click', (e) => {
            const copyBtn = e.target.closest('.foxlate-msg-action-copy');
            const regenerateBtn = e.target.closest('.foxlate-msg-action-regenerate');
            const editBtn = e.target.closest('.foxlate-msg-action-edit');
            const saveEditBtn = e.target.closest('.foxlate-msg-action-save');
            const cancelEditBtn = e.target.closest('.foxlate-msg-action-cancel');

            if (copyBtn) {
                const messageEl = copyBtn.closest('.foxlate-summary-message');
                const content = messageEl.querySelector('.message-content')?.innerText || '';
                navigator.clipboard.writeText(content).catch(err => logError('copy single message', err));
            } else if (regenerateBtn) {
                const messageEl = regenerateBtn.closest('.foxlate-summary-message');
                const index = parseInt(messageEl.dataset.messageIndex, 10);
                if (!isNaN(index)) {
                    this.handleRegenerateMessage(index);
                }
            } else if (editBtn) {
                const messageEl = editBtn.closest('.foxlate-summary-message');
                const index = parseInt(messageEl.dataset.messageIndex, 10);
                if (!isNaN(index)) {
                    this.enterEditMode(index);
                }
            } else if (saveEditBtn) {
                const messageEl = saveEditBtn.closest('.foxlate-summary-message');
                const index = parseInt(messageEl.dataset.messageIndex, 10);
                const textarea = messageEl.querySelector('textarea');
                if (!isNaN(index) && textarea) {
                    this.saveEdit(index, textarea.value);
                }
            } else if (cancelEditBtn) {
                const messageEl = cancelEditBtn.closest('.foxlate-summary-message');
                const index = parseInt(messageEl.dataset.messageIndex, 10);
                if (!isNaN(index)) {
                    // 恢复原始UI
                    const originalContent = this.conversationHistory[index].content;
                    this.updateMessageAtIndex(index, originalContent);
                }
            }
        });
    }

    handleDialogClose() {
        this.hideDialog();
    }

    async handleRefreshConversation() {
        const conversationArea = this.dialog.querySelector('.foxlate-summary-dialog-conversation');
        conversationArea.innerHTML = ''; // 清空UI
        this.conversationHistory = []; // 清空历史
        this.state = 'loading';
        await this.fetchSummary();
        this.state = 'summarized';
    }

    handleCopyConversation() {
        const textToCopy = this.conversationHistory.map(msg => {
            const prefix = msg.role === 'user' ? 'User:' : 'AI:';
            return `${prefix}\n${msg.content}`;
        }).join('\n\n');

        navigator.clipboard.writeText(textToCopy).then(() => {
            // (可选) 提供一个复制成功的视觉反馈
            const copyBtn = this.dialog.querySelector('.foxlate-summary-dialog-copy-btn');
            const originalIcon = copyBtn.innerHTML;
            copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
            setTimeout(() => {
                copyBtn.innerHTML = originalIcon;
            }, 1500);
        }).catch(err => logError('handleCopyConversation', err));
    }

    async handleRegenerateMessage(index) {
        if (this.state === 'loading' || index >= this.conversationHistory.length) return;

        const messageToRegenerate = this.dialog.querySelector(`[data-message-index="${index}"]`);
        if (!messageToRegenerate) return;

        // (已修复) 将整条消息置为加载状态，而不是只在按钮上加动画
        messageToRegenerate.innerHTML = ''; // 清空旧内容
        messageToRegenerate.classList.add('loading');
        messageToRegenerate.textContent = '...'; // 显示加载提示

        this.state = 'loading';

        // 截取到当前消息之前的历史作为上下文
        const contextHistory = this.conversationHistory.slice(0, index);

        try {
            const response = await browser.runtime.sendMessage({
                type: 'CONVERSE_WITH_AI',
                payload: {
                    history: contextHistory,
                    aiModel: this.summarySettings.aiModel,
                    targetLang: this.settings.targetLanguage
                }
            });

            if (response.success) {
                // (已修复) 更新历史记录，然后调用 updateMessageAtIndex 更新UI
                this.conversationHistory[index] = { role: 'assistant', content: response.reply };
                this.updateMessageAtIndex(index, response.reply);
            } else {
                // (已修复) 即使失败，也调用 updateMessageAtIndex 来显示错误信息
                this.updateMessageAtIndex(index, browser.i18n.getMessage('summaryErrorText') + (response.error || 'Unknown error'), true);
            }
        } catch (error) {
            // (已修复) 捕获异常时，同样调用 updateMessageAtIndex 显示错误
            this.updateMessageAtIndex(index, browser.i18n.getMessage('summaryErrorText') + error.message, true);
        } finally {
            // (已修复) 恢复全局状态。UI状态由 updateMessageAtIndex 负责
            this.state = 'summarized';
        }
    }

    enterEditMode(index) {
        const messageEl = this.dialog.querySelector(`[data-message-index="${index}"]`);
        if (!messageEl || this.conversationHistory[index].role !== 'user') return;

        const originalContent = this.conversationHistory[index].content;

        messageEl.innerHTML = `
            <div class="foxlate-summary-message-edit-area">
                <textarea rows="3">${originalContent}</textarea>
                <div class="foxlate-summary-message-actions" style="opacity:1; visibility:visible; position:relative; justify-content:flex-end;">
                    <button class="foxlate-msg-action-cancel foxlate-summary-dialog-icon-btn" aria-label="Cancel">
                        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 0 24 24" width="20"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                    <button class="foxlate-msg-action-save foxlate-summary-dialog-icon-btn" aria-label="Save">
                        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 0 24 24" width="20"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    </button>
                </div>
            </div>
        `;

        const textarea = messageEl.querySelector('textarea');
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length); // 光标移到末尾
        // 自动调整高度
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        });
    }

    async saveEdit(index, newContent) {
        if (this.state === 'loading') return;

        // 1. 截断历史记录和UI
        this.conversationHistory = this.conversationHistory.slice(0, index + 1);
        const conversationArea = this.dialog.querySelector('.foxlate-summary-dialog-conversation');
        const messages = conversationArea.querySelectorAll('.foxlate-summary-message');
        messages.forEach(msg => {
            const msgIndex = parseInt(msg.dataset.messageIndex, 10);
            if (msgIndex > index) {
                msg.remove();
            }
        });

        // 2. 更新当前消息的内容和UI
        this.conversationHistory[index].content = newContent;
        this.updateMessageAtIndex(index, newContent);

        // 3. 触发新的AI响应
        this.state = 'loading';
        this.dialog.querySelector('.foxlate-summary-dialog-send-btn').disabled = true;
        this.addMessageToConversation('...', 'loading');

        // 复用 handleSendMessage 的内部逻辑，但不添加用户消息
        await this.getAiResponseForHistory(this.conversationHistory);
    }

    /**
     * (新) 根据消息角色生成对应的操作按钮HTML。
     * @param {string} role - 'user' 或 'ai'。
     * @returns {string} HTML字符串。
     * @private
     */
    #getActionsHTML(role) {
        if (role === 'ai') {
            return `
                <div class="foxlate-summary-message-actions">
                    <button class="foxlate-msg-action-regenerate foxlate-summary-dialog-icon-btn" aria-label="Regenerate">
                        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 0 24 24" width="20"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                    </button>
                    <button class="foxlate-msg-action-copy foxlate-summary-dialog-icon-btn" aria-label="Copy">
                        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 0 24 24" width="20"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                    </button>
                </div>`;
        } else if (role === 'user') {
            return `
                <div class="foxlate-summary-message-actions">
                    <button class="foxlate-msg-action-edit foxlate-summary-dialog-icon-btn" aria-label="Edit">
                        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 0 24 24" width="20"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    </button>
                </div>`;
        }
        return '';
    }

    toggleDialog() {
        if (this.isDialogVisible) {
            this.hideDialog();
        } else {
            this.showDialog();
        }
    }

    showDialog() {
        if (!this.dialog) return;
        this.positionDialog();
        this.dialog.classList.add('visible');
        this.isDialogVisible = true;
        document.addEventListener('keydown', this.handleKeyDown);
        // 对话框显示时，让输入框自动获得焦点
        setTimeout(() => this.dialog.querySelector('.foxlate-summary-dialog-input')?.focus(), 150); // 延迟以等待动画
    }

    hideDialog() {
        if (!this.dialog) return;
        this.dialog.classList.remove('visible');
        this.isDialogVisible = false;
        document.removeEventListener('keydown', this.handleKeyDown);
    }

    handleKeyDown(e) {
        if (e.key === 'Escape') this.hideDialog();
    }

    positionDialog() {
        if (!this.fab || !this.dialog) return;

        const fabRect = this.fab.getBoundingClientRect();
        const dialogRect = this.dialog.getBoundingClientRect();
        const gap = 12; // FAB 和对话框之间的间距

        const positions = {
            top: fabRect.top - dialogRect.height - gap,
            bottom: fabRect.bottom + gap,
            left: fabRect.left,
            right: fabRect.right - dialogRect.width,
            hCenter: fabRect.left + (fabRect.width / 2) - (dialogRect.width / 2),
            vCenter: fabRect.top + (fabRect.height / 2) - (dialogRect.height / 2),
        };

        // 检查可用空间
        const space = {
            top: fabRect.top - gap,
            bottom: window.innerHeight - fabRect.bottom - gap,
            left: fabRect.left - gap,
            right: window.innerWidth - fabRect.right - gap,
        };

        let bestPosition = { top: positions.bottom, left: positions.hCenter };

        // 优先在下方或上方显示
        if (space.bottom >= dialogRect.height) {
            bestPosition = { top: positions.bottom, left: positions.hCenter };
        } else if (space.top >= dialogRect.height) {
            bestPosition = { top: positions.top, left: positions.hCenter };
        } else if (space.right >= dialogRect.width) { // 其次是右侧
            bestPosition = { top: positions.vCenter, left: fabRect.right + gap };
        } else if (space.left >= dialogRect.width) { // 最后是左侧
            bestPosition = { top: positions.vCenter, left: fabRect.left - dialogRect.width - gap };
        }

        // 边界检查，确保对话框不会超出视口
        bestPosition.top = Math.max(gap, Math.min(bestPosition.top, window.innerHeight - dialogRect.height - gap));
        bestPosition.left = Math.max(gap, Math.min(bestPosition.left, window.innerWidth - dialogRect.width - gap));

        this.dialog.style.top = `${bestPosition.top}px`;
        this.dialog.style.left = `${bestPosition.left}px`;
    }

    addMessageToConversation(content, role, isError = false) {
        const conversationArea = this.dialog.querySelector('.foxlate-summary-dialog-conversation');
        const messageEl = document.createElement('div');
        messageEl.className = `foxlate-summary-message ${role}`;
        // (新) 为消息元素添加索引，以便进行精确操作
        const messageIndex = this.conversationHistory.length - 1;
        messageEl.dataset.messageIndex = messageIndex;
        if (isError) messageEl.classList.add('error');

        if (role === 'loading') {
            messageEl.textContent = content;
        } else {
            // (已修改) 为内容和动作创建独立的内部容器
            const contentHTML = `<div class="message-content">${marked.parse(content)}</div>`;
            const actionsHTML = this.#getActionsHTML(role);
            messageEl.innerHTML = contentHTML + actionsHTML;
        }

        conversationArea.appendChild(messageEl);
        // 自动滚动到底部
        conversationArea.scrollTop = conversationArea.scrollHeight;
        return messageEl;
    }

    updateLastMessage(content, role, isError = false) {
        const conversationArea = this.dialog.querySelector('.foxlate-summary-dialog-conversation');
        const lastMessage = conversationArea.lastElementChild;
        if (lastMessage && lastMessage.classList.contains('loading')) {
            lastMessage.className = `foxlate-summary-message ${role}`;
            // (新) 更新消息元素的索引
            const messageIndex = this.conversationHistory.length - 1;
            lastMessage.dataset.messageIndex = messageIndex;
            if (isError) lastMessage.classList.add('error');

            const contentHTML = `<div class="message-content">${marked.parse(content)}</div>`;
            const actionsHTML = this.#getActionsHTML(role);
            lastMessage.innerHTML = contentHTML + actionsHTML;

            conversationArea.scrollTop = conversationArea.scrollHeight;
        } else {
            // 如果最后一条不是 loading，则直接添加新消息
            this.addMessageToConversation(content, role, isError);
        }
    }

    updateMessageAtIndex(index, newContent, isError = false) {
        const messageEl = this.dialog.querySelector(`[data-message-index="${index}"]`);
        if (!messageEl) return;
        
        const role = this.conversationHistory[index]?.role || 'ai';
        messageEl.className = `foxlate-summary-message ${role}`; // 重置类名
        if (isError) messageEl.classList.add('error');

        const contentHTML = `<div class="message-content">${marked.parse(newContent)}</div>`;
        const actionsHTML = this.#getActionsHTML(role);
        messageEl.innerHTML = contentHTML + actionsHTML;

        // 确保滚动条在需要时可见
        const conversationArea = this.dialog.querySelector('.foxlate-summary-dialog-conversation');
        // 如果消息在视口之外，则滚动到该消息
        if (messageEl.offsetTop < conversationArea.scrollTop || messageEl.offsetTop + messageEl.offsetHeight > conversationArea.scrollTop + conversationArea.clientHeight) {
            messageEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }

    async handleSendMessage() {
        const inputEl = this.dialog.querySelector('.foxlate-summary-dialog-input');
        const sendBtn = this.dialog.querySelector('.foxlate-summary-dialog-send-btn');
        const query = inputEl.value.trim();

        if (!query || this.state === 'loading') return;

        // (新) 将用户消息添加到历史记录和UI
        this.conversationHistory.push({ role: 'user', content: query });
        this.addMessageToConversation(query, 'user');
        inputEl.value = '';
        inputEl.style.height = 'auto'; // 重置高度
        inputEl.focus();

        this.state = 'loading';
        sendBtn.disabled = true;
        this.addMessageToConversation('...', 'loading');

        try {
            await this.getAiResponseForHistory(this.conversationHistory);
        } catch (error) {
            // 错误已在 getAiResponseForHistory 中处理
        } finally {
            // 无论成功或失败，都恢复状态
            this.state = 'summarized'; // 恢复到可交互状态
            sendBtn.disabled = false;
        }
    }

    /**
     * (新) 封装的通用方法，用于为给定的历史记录获取AI响应并更新UI
     * @param {Array} history - 要发送给AI的对话历史
     */
    async getAiResponseForHistory(history) {
        const sendBtn = this.dialog.querySelector('.foxlate-summary-dialog-send-btn');
        try {
            const response = await browser.runtime.sendMessage({
                type: 'CONVERSE_WITH_AI', // 新的消息类型，用于通用对话
                payload: {
                    history: history, // (已修改) 发送完整的历史记录
                    aiModel: this.summarySettings.aiModel, // 对话使用的 AI 模型来自总结设置
                    targetLang: this.settings.targetLanguage // (已修复) 对话的目标语言也应遵循全局或域名规则
                }
            });

            if (response.success) {
                // (新) 将AI的回复添加到历史记录
                this.conversationHistory.push({ role: 'assistant', content: response.reply });
                this.updateLastMessage(response.reply, 'ai');
            } else {
                const errorMessage = browser.i18n.getMessage('summaryErrorText') + (response.error || 'Unknown error');
                this.updateLastMessage(errorMessage, 'ai', true);
            }
        } catch (error) {
            logError('handleSendMessage', error);
            const errorMessage = browser.i18n.getMessage('summaryErrorText') + error.message;
            this.updateLastMessage(errorMessage, 'ai', true);
        }
    }

    handleDragStart(e) {
        // 只响应主按钮点击，并防止在点击时选中文本
        if (e.button !== 0) return;
        e.preventDefault();

        const startX = e.clientX;
        const startY = e.clientY;
        const fabStartRect = this.fab.getBoundingClientRect();
        let isDragging = false; // 拖动状态标志

        const handleDragMove = (moveEvent) => {
            moveEvent.preventDefault();
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;

            // 仅当移动超过阈值时，才真正开始拖动
            if (!isDragging && Math.hypot(dx, dy) > 5) {
                isDragging = true;
                // 在拖动开始时，记录对话框的原始可见状态并隐藏它
                this.wasDialogVisibleBeforeDrag = this.isDialogVisible;
                if (this.isDialogVisible) {
                    this.hideDialog();
                }
            }

            if (!isDragging) return;

            let newLeft = fabStartRect.left + dx;
            let newTop = fabStartRect.top + dy;

            // 边界检查
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - fabStartRect.width));
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - fabStartRect.height));

            this.fab.style.left = `${newLeft}px`;
            this.fab.style.top = `${newTop}px`;
        };

        const handleDragEnd = (endEvent) => {
            document.removeEventListener('mousemove', handleDragMove);
            document.removeEventListener('mouseup', handleDragEnd);

            if (!isDragging) {
                // 如果从未进入拖动状态，则视为一次纯粹的点击
                this.handleFabClick();
            } else if (this.wasDialogVisibleBeforeDrag) { // 如果是拖动，则根据拖动前的状态恢复对话框
                // 拖动结束后，如果之前是可见的，则重新显示
                this.showDialog();
            }
        };

        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
    }

    setFabLoadingState(isLoading) {
        const icon = this.fab.querySelector('.icon');
        if (isLoading) {
            this.fab.classList.add('extended');
            icon.classList.add('loading');
        } else {
            this.fab.classList.remove('extended');
            icon.classList.remove('loading');
        }
    }

    setupVisibilityObserver() {
        if (!this.fab) return;
        this.visibilityObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting && this.isDialogVisible) {
                    this.hideDialog();
                }
            });
        }, { threshold: 0.1 });
        this.visibilityObserver.observe(this.fab);
    }

    destroy() {
        this.fab?.remove();
        this.dialog?.remove();
        if (this.visibilityObserver) {
            this.visibilityObserver.disconnect();
        }
        this.fab = null;
        this.dialog = null;
        this.visibilityObserver = null;
        document.removeEventListener('keydown', this.handleKeyDown);
    }
}


/**
 * 使一个元素可拖动。
 * @param {HTMLElement} element - 要使其可拖动的元素。
 * @param {string|null} handleSelector - 用于拖动的句柄的选择器。如果为 null，则整个元素都可拖动。
 * @private
 */
function makeDraggable(element, handleSelector = null) {
    let offsetX = 0, offsetY = 0;
    const handle = handleSelector ? element.querySelector(handleSelector) : element;

    if (!handle) return;
    // CSS 中已设置 cursor: move

    const dragMouseDown = (e) => {
        // 拖动开始时，如果对话框可见，则临时隐藏
        if (this.modal && this.modal.style.display !== 'none') {
            this.modal.style.display = 'none';
        }
        e.preventDefault();
        // 1. 计算鼠标指针在元素内部的初始偏移量
        offsetX = e.clientX - element.getBoundingClientRect().left;
        offsetY = e.clientY - element.getBoundingClientRect().top;

        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    };

    const elementDrag = (e) => {
        e.preventDefault();

        // 2. 直接用当前鼠标位置减去初始偏移量，得到元素的新位置
        let newTop = e.clientY - offsetY;
        let newLeft = e.clientX - offsetX;

        // 边界检查，防止拖出视口
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - element.clientHeight));
        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - element.clientWidth));

        element.style.top = newTop + "px";
        element.style.left = newLeft + "px";
    };

    const closeDragElement = () => {
        // 3. 清理事件监听器
        document.onmouseup = null;
        document.onmousemove = null;

        // 拖动结束后，如果对话框存在，则重新定位并显示它
        if (this.modal) {
            this.positionModal();
            this.modal.style.display = 'block';
        }
    };

    handle.onmousedown = dragMouseDown;
}

/**
 * 销毁并清理所有UI元素和事件监听器。
 */
function destroy() {
    this.container?.remove(); // 只需移除父容器
}

// --- State Management Class ---

let summaryManager = null; // (新) 将总结管理器移至全局作用域
let currentPageJob = null;
let currentSelectionTranslationId = null;


/**
 * 启动页面翻译作业。
 */
class PageTranslationJob {
    constructor(tabId, settings) {
        this.tabId = tabId;
        this.settings = settings;

        this.mutationQueue = new Set();
        this.idleCallbackId = null;
        this.mutationDebounceTimerId = null; // 用于动态内容处理的防抖计时器
        this.DEBOUNCE_DELAY = 300; // 毫秒
        this.intersectionObserver = null;
        this.mutationObserver = null;
        this.activeTranslations = 0; // 只跟踪当前在途的翻译任务数量

        this.state = 'idle'; // 'idle', 'starting', 'translating', 'translated', 'reverting'
    }

    async start() {
        if (this.state !== 'idle') {
            console.warn(`[Foxlate] Job is not idle (state: ${this.state}). Ignoring start request.`);
            return;
        }

        console.log("[Foxlate] Starting page translation process...");
        this.state = 'starting'; // 初始状态，防止重复启动

        // 立即通知后台，UI可以显示加载状态
        browser.runtime.sendMessage({
            type: 'TRANSLATION_STATUS_UPDATE',
            payload: { status: 'loading', tabId: this.tabId }
        }).catch(e => logError('start (sending loading status)', e));

        document.body.dataset.translationSession = 'active';

        try {
            if (!this.settings.targetLanguage) {
                throw new Error(browser.i18n.getMessage('errorMissingTargetLanguage') || 'Target language is not configured.');
            }
            if (!this.settings.translatorEngine) {
                throw new Error(browser.i18n.getMessage('errorMissingEngine') || 'Translation engine is not configured.');
            }
        } catch (error) {
            logError('PageTranslationJob.start (settings validation)', error);
            this.state = 'idle';
            throw error;
        }

        this.#initializeObservers();
        this.#startMutationObserver();

        // 优化：使用requestIdleCallback延迟元素查找，避免阻塞主线程
        requestIdleCallback(() => {
            const allSearchRoots = findAllSearchRoots(document.body);
            const elementsToObserve = findTranslatableElements(this.settings, allSearchRoots);

            console.log(`[Foxlate] Found ${elementsToObserve.length} initial elements to observe across ${allSearchRoots.length} roots.`);
            if (elementsToObserve.length > 0) {
                this.#observeElements(elementsToObserve);
                this.state = 'translating'; // 正式进入翻译中状态
            } else {
                console.warn("[Foxlate] No translatable elements found to observe initially.");
                this.state = 'translated'; // 没有需要翻译的元素，任务直接完成
                browser.runtime.sendMessage({
                    type: 'TRANSLATION_STATUS_UPDATE',
                    payload: { status: 'translated', tabId: this.tabId }
                }).catch(e => logError('start (sending translated status)', e));
            }
        }, { timeout: 2000 });
    }

    async revert() {
        // 添加状态守卫，确保 revert() 方法是幂等的。
        // 如果作业已经在还原中或已处于空闲状态，则忽略后续的还原请求。
        if (this.state === 'reverting' || this.state === 'idle') {
            console.warn(`[Foxlate] Job is already reverting or idle (state: ${this.state}). Ignoring revert request.`);
            return;
        }
        try {
            await browser.runtime.sendMessage({ type: 'STOP_TRANSLATION', payload: { tabId: this.tabId } });
        } catch (e) {
            logError('revert (sending STOP_TRANSLATION)', e);
        }

        try {
            await browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'original', tabId: this.tabId }
            });
        } catch (e) {
            logError('revert (sending original status)', e);
        }

        console.log("[Foxlate] Reverting entire page translation...");
        this.state = 'reverting';

        this.#stopObservers();
        this.activeTranslations = 0;

        try {
            delete document.body.dataset.translationSession;
            DisplayManager.hideAllEphemeralUI();
            // 不再使用 querySelectorAll，而是直接从 DisplayManager 获取所有已注册的元素
            // 注意：DisplayManager.elementRegistry.values() 返回的是一个迭代器
            const registeredWeakRefs = Array.from(DisplayManager.elementRegistry.values());
            let revertedCount = 0;

            for (const weakRef of registeredWeakRefs) {
                const element = weakRef.deref();
                if (element) {
                    // 调用 DisplayManager.revert 会处理所有事情，
                    // 包括从 elementRegistry 中删除自己
                    DisplayManager.revert(element);
                    revertedCount++;
                }
            }
            console.log(`[Foxlate] Reverted ${revertedCount} translated elements.`);

            // (新) 补充清理：查找并还原所有可能被遗漏的、由脚本生成的包裹器。
            // 这种情况可能在以下场景发生：
            // 1. 包裹器被创建，但在进入视口并被翻译之前，用户就点击了“显示原文”。
            // 2. 包裹器进入视口，但其内容未通过后续的翻译预检查，导致它从未被注册到 DisplayManager 中。
            // 此操作确保了无论何种情况，所有对 DOM 的修改都能被完全撤销。
            const leftoverWrappers = document.body.querySelectorAll('foxlate-wrapper[data-foxlate-generated="true"]');
            if (leftoverWrappers.length > 0) {
                console.log(`[Foxlate] Cleaning up ${leftoverWrappers.length} leftover generated wrappers.`);
                leftoverWrappers.forEach(wrapper => {
                    // 检查父节点是否存在，以避免在已分离的节点上操作
                    if (wrapper.parentNode) wrapper.replaceWith(...wrapper.childNodes);
                });
            }

        } catch (error) {
            logError('revert (DOM cleanup)', error);
        }

        currentPageJob = null;
    }

    // --- Private Methods ---

    #initializeObservers() {
        const intersectionOptions = {
            root: null,
            rootMargin: '0px 0px',
            threshold: 0.5
        };
        this.intersectionObserver = new IntersectionObserver(this.#handleIntersection.bind(this), intersectionOptions);
        this.mutationObserver = new MutationObserver(this.#handleMutation.bind(this));
    }

    #startMutationObserver() {
        if (!this.mutationObserver) this.#initializeObservers();
        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        console.log("[Foxlate] Mutation observer started.");
    }

    #stopObservers() {
        if (this.intersectionObserver) this.intersectionObserver.disconnect();
        if (this.mutationObserver) this.mutationObserver.disconnect();
        // (新) 清理所有挂起的计时器和回调，确保在停止时不会有残留的异步任务。
        if (this.mutationDebounceTimerId) {
            clearTimeout(this.mutationDebounceTimerId);
        }
        if (this.idleCallbackId) {
            cancelIdleCallback(this.idleCallbackId);
        }
        this.intersectionObserver = null;
        this.mutationObserver = null;
        console.log("[Foxlate] Observers stopped.");
    }

    #observeElements(elements) {
        if (!this.intersectionObserver) return;
        for (const element of elements) {
            if (element.dataset.translationId) {
                continue;
            }
            this.intersectionObserver.observe(element);
        }
    }

    #handleIntersection(entries) {
        // 优化：批量处理交叉观察条目
        const intersectingElements = [];
        for (const entry of entries) {
            if (entry.isIntersecting) {
                intersectingElements.push(entry.target);
                // 立即取消观察，避免重复处理
                this.intersectionObserver.unobserve(entry.target);
            }
        }

        if (intersectingElements.length === 0) return;

        // 元素已由 findTranslatableElements 预先过滤。
        // 我们可以直接翻译它们，无需再次检查CSS选择器。
        // 优化：使用requestIdleCallback批量处理翻译请求
        requestIdleCallback(() => {
            intersectingElements.forEach(element => {
                // 直接委托给 translateElement，它将处理所有启动逻辑
                translateElement(element, this.settings);
            });
        }, { timeout: 1000 });
    }

    checkCompletion() {
        // 只有在翻译中状态，并且没有在途任务和待处理的DOM变动时，才算“完成”当前批次。
        if (this.state === 'translating' && this.activeTranslations === 0 && this.mutationQueue.size === 0) {
            this.state = 'translated';
            console.log(`[Foxlate] Page translation completed.`);
            browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'translated', tabId: this.tabId }
            }).catch(e => logError('checkCompletion (sending completed status)', e));
        }
    }
    #handleMutation(mutations) {
        let hasNewNodes = false;
        // (优化) 创建一个仅在本次函数调用中有效的本地缓存。
        // 在单次 MutationObserver 回调中，同一个节点可能出现在多个 mutation 记录里。
        // 这个缓存可以避免在同一次处理中对同一个节点重复调用高成本的 getComputedStyle。
        // 使用 Map 而不是 WeakMap，因为它的生命周期很短，不会造成内存泄漏。
        const localStyleCache = new Map();
        const getStyle = (element) => {
            if (localStyleCache.has(element)) {
                return localStyleCache.get(element);
            }
            const style = window.getComputedStyle(element);
            localStyleCache.set(element, style);
            return style;
        };

        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    // 忽略由本扩展自身UI（如 tooltip）或已翻译内容引起的突变。
                    if (node.closest('[data-translation-id], .foxlate-panel')) continue;

                    // (新) 修复：正确跳过由脚本自身生成的包裹元素。
                    if (node.dataset.foxlateGenerated === 'true') continue;

                    // (优化) 使用与 DOMWalker 中相同的、分层且高效的可见性检查模式。
                    // 这是一个快速的预过滤，只执行无重排（reflow）的检查，以避免在处理高频DOM变化时
                    // 引入性能瓶颈。最终的、更昂贵的可见性检查将在 DOMWalker.create 中进行。
                    const style = getStyle(node);
                    if (style.display === 'none' || style.visibility === 'hidden') {
                        continue;
                    }
                    // `offsetParent` 为 null 通常意味着元素是不可见的。
                    if (node.offsetParent === null) {
                        // 但我们需要处理那些 `offsetParent` 为 null 但元素仍然可见的例外情况，
                        // 例如固定/粘性定位的元素。
                        if (style.position !== 'fixed' && style.position !== 'sticky') {
                            continue;
                        }
                    }

                    this.mutationQueue.add(node);
                    hasNewNodes = true;
                }
            }
        }

        if (hasNewNodes) {
            // (新) 使用防抖机制来处理动态内容。
            // (优化) 在设置新的防抖计时器之前，统一取消所有已挂起的处理任务，
            // 包括上一个防抖计时器和任何已安排但尚未执行的空闲回调。
            // 这可以确保只有一个处理流程在等待执行，防止在某些边缘情况下（例如，
            // 在空闲回调等待期间发生新的突变）出现重复或不必要的处理。
            if (this.idleCallbackId) {
                cancelIdleCallback(this.idleCallbackId);
                this.idleCallbackId = null;
            }
            // 这可以防止在无限滚动等场景下，因 DOM 频繁变动而导致的高频处理，
            // 确保只在 DOM 变化暂停一小段时间后才执行处理，从而提升页面流畅性。
            clearTimeout(this.mutationDebounceTimerId);
            this.mutationDebounceTimerId = setTimeout(() => {
                // 使用 requestIdleCallback 进一步优化，确保处理在浏览器空闲时进行。
                // 这结合了防抖和空闲回调的优点。
                this.idleCallbackId = requestIdleCallback(() => this.#processMutationQueue(), { timeout: 1000 });
            }, this.DEBOUNCE_DELAY);
        }
    }

    #processMutationQueue() {
        this.idleCallbackId = null;
        if (this.mutationQueue.size === 0) return;

        const newNodes = Array.from(this.mutationQueue);
        this.mutationQueue.clear();

        if (!this.settings) {
            console.warn("[Foxlate] Mutation observed, but no settings found. Skipping.");
            return;
        }

        // 优化：批量处理节点，减少重复查找
        const allSearchRoots = new Set();

        // 对每个新增的节点，也查找其内部可能存在的 Shadow Root
        for (const node of newNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // 使用扩展的findAllSearchRoots函数查找所有搜索根
                const roots = findAllSearchRoots(node);
                roots.forEach(root => allSearchRoots.add(root));
            }
        }

        // 转换为数组
        const searchRootsArray = Array.from(allSearchRoots);

        const newElements = findTranslatableElements(this.settings, searchRootsArray);
        if (newElements.length > 0) {
            console.log(`[Foxlate] Found ${newElements.length} new dynamic elements to observe.`);
            this.#observeElements(newElements);
        }
        // 即使没有找到新的可翻译元素，也可能清空了 mutationQueue，
        // 这可能是完成翻译的最后一个条件，所以需要检查。
        this.checkCompletion();
    }
}

/**
 * (优化版本) 启动对单个容器元素的翻译过程。
 *
 * 此函数通过以下优化提高性能：
 * 1. 在实际翻译时才执行预检查，避免在元素收集阶段进行不必要的预检查
 * 2. 保留原有的重复翻译防护机制
 * 3. 优化了状态更新逻辑
 */
function translateElement(element, effectiveSettings) {
    if (!element || !(element instanceof HTMLElement)) return;

    // (优化) 检查该元素是否包含任何已经翻译过的子元素。
    // 如果是，则跳过翻译，因为它应该由其子元素处理。
    // 这里假设翻译是"由内向外"进行的。
    if (element.querySelector('[data-translation-id]')) {
        console.log(`[Foxlate] 元素 ${element.tagName} 内部包含已翻译内容，跳过以避免重复。`);
        return;
    }

    // 1. 创建翻译单元并解构结果
    const domWalkerResult = DOMWalker.create(element, effectiveSettings.translationSelector);
    if (!domWalkerResult) {
        return; // 没有可翻译的内容
    }
    // (新) 解构出 sourceText, plainText 和 translationUnit
    const { sourceText, plainText, translationUnit } = domWalkerResult;

    // 3. (优化) 使用纯文本进行预检查
    const { result: shouldTranslateResult } = shouldTranslate(plainText, effectiveSettings);
    if (!shouldTranslateResult) {
        return; // 不翻译，跳过
    }

    // 4. (新) 使用带标签的 sourceText 进行翻译，以保留格式
    const textToTranslate = sourceText;

    // --- 启动翻译的核心逻辑 ---
    // 只有在确定要翻译后，才更新状态和计数器
    if (currentPageJob) {
        // 如果作业已完成，但现在有一个新的元素开始翻译，
        // 我们必须将状态切换回"翻译中"，并通知UI再次显示加载状态。
        // 这确保了即使用户滚动到底部，进度状态也能正确更新。
        if (currentPageJob.state === 'translated') {
            currentPageJob.state = 'translating';
            browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'loading', tabId: currentPageJob.tabId }
            }).catch(e => logError('translateElement (sending loading status)', e));
        }
        currentPageJob.activeTranslations++;
    }

    const elementId = `ut-${generateUUID()}`;
    element.dataset.translationId = elementId;

    const targetLang = effectiveSettings.targetLanguage;
    const translatorEngine = effectiveSettings.translatorEngine;
    const initialState = { originalContent: element.innerHTML, translationUnit };
    // 调用 DisplayManager.displayLoading 之前或之后，进行注册
    DisplayManager.registerElement(elementId, element);
    DisplayManager.displayLoading(element, effectiveSettings.displayMode, initialState);

    console.log(`[Foxlate] Sending text to translate for ${elementId}`, { textToTranslate });
    browser.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        payload: { text: textToTranslate, targetLang, sourceLang: 'auto', elementId, translatorEngine }
    }).catch(e => {
        logError('translateElement (send message)', e);
        // 如果消息发送失败，我们需要手动回滚状态和计数器，
        // 因为 handleTranslationResult 将不会被调用。
        if (currentPageJob) {
            currentPageJob.activeTranslations--;
            currentPageJob.checkCompletion();
        }
        DisplayManager.revert(element);
    });
}


/**
 * (新) 处理单个元素翻译的结果。
 * @param {object} payload - 从后台脚本接收的负载。
 */
function handleTranslationResult(payload) {
    const { elementId, success, translatedText, wasTranslated, error } = payload;

    if (!currentPageJob) {
        // 如果没有当前作业，则无需执行任何操作。
        return;
    }

    // 收到结果后减少计数器
    currentPageJob.activeTranslations--;

    // const wrapper = document.querySelector(`[data-translation-id="${elementId}"]`);
    // 不再使用 querySelector，而是从 DisplayManager 的注册表中查找
    const wrapper = DisplayManager.findElementById(elementId);

    if (!wrapper) {
        // 如果 wrapper 为空，意味着元素已经被垃圾回收了
        console.log(`[Foxlate] Element for translationId ${elementId} no longer exists. Skipping update.`);
        currentPageJob.checkCompletion();
        return;
    }

    if (success && wasTranslated) {
        // 为不使用 DOM 重建的策略（如悬浮提示）准备一个纯文本版本。
        // 这可以防止将内部的 <t_id> 标签泄露到 UI 中。
        const plainText = translatedText.replace(/<(\/)?t\d+>/g, '');
        DisplayManager.displayTranslation(wrapper, { translatedText, plainText });
    } else {
        // 如果翻译失败，显示错误状态而不是直接还原。
        // 这为用户提供了关于翻译失败的明确反馈。
        const errorMessage = error || 'An unknown error occurred during translation.';
        DisplayManager.displayError(wrapper, errorMessage);
    }
    // 无论成功与否，都检查作业是否已完成。
    currentPageJob.checkCompletion();
}
// --- Message Handling & UI ---

const messageHandlers = {
    PING() {
        return Promise.resolve({ status: 'PONG' });
    },

    async SETTINGS_UPDATED() {
        console.log("[Content Script] Received settings update. Updating local cache.");
        const newSettings = await getEffectiveSettings();
        if (currentPageJob) {
            currentPageJob.settings = newSettings;
            console.log("[Foxlate] Updated page translation job settings:", newSettings);
        }
        // 新增：如果页面已翻译，则根据新设置更新显示模式
        if (currentPageJob && (currentPageJob.state === 'translated' || currentPageJob.state === 'translating')) {
            DisplayManager.updateDisplayMode(newSettings.displayMode);
        }

        // 新增：通知字幕管理器设置已更新
        if (window.subtitleManager && typeof window.subtitleManager.updateSettings === 'function') {
            window.subtitleManager.updateSettings(newSettings);
        }
        // (新) 重新初始化总结功能以应用新设置
        await initializeSummaryFeature();

        return { success: true };
    },


    async RELOAD_TRANSLATION_JOB() {
        if (currentPageJob) {
            console.log("[Foxlate] Critical settings changed. Reverting and restarting translation job.");
            const tabId = currentPageJob.tabId; // 在还原前保存 tabId
            await currentPageJob.revert(); // 这会将 currentPageJob 设置为 null

            // 使用新设置启动一个新作业
            const newSettings = await getEffectiveSettings();
            currentPageJob = new PageTranslationJob(tabId, newSettings);
            await currentPageJob.start();

            // (新) 重新初始化总结功能，因为它也依赖于设置
            await initializeSummaryFeature();
        }
        return { success: true };
    },

    async TRANSLATE_PAGE_REQUEST(request) {
        if (currentPageJob) {
            console.warn("[Foxlate] Auto-translate request received, but a job is already active. Ignoring.");
        } else {
            const settings = await getEffectiveSettings();
            currentPageJob = new PageTranslationJob(request.payload.tabId, settings);
            await currentPageJob.start();
        }
        return { success: true };
    },

    async REVERT_PAGE_TRANSLATION() {
        if (currentPageJob) {
            await currentPageJob.revert();
        }
        return { success: true };
    },

    async TOGGLE_TRANSLATION_REQUEST_AT_CONTENT(request) {
        // 使用 currentPageJob 的存在作为判断翻译是否活动的唯一真实来源。
        // 这比依赖 DOM 属性（如 dataset）更健壮，并简化了逻辑。
        const isJobActive = !!currentPageJob;
        const { tabId } = request.payload;

        if (isJobActive) {
            // 如果作业已激活，则执行“还原”操作。
            await currentPageJob.revert();
        } else {
            // 如果没有激活的作业，则执行“翻译”操作。
            // 这也优雅地处理了任何可能由先前崩溃的作业留下的不一致的 DOM 状态。
            const settings = await getEffectiveSettings();
            currentPageJob = new PageTranslationJob(tabId, settings);
            await currentPageJob.start();
        }
        return { success: true };
    },

    TRANSLATE_TEXT_RESULT(request) {
        handleTranslationResult(request.payload);
        return { success: true };
    },

    UPDATE_DISPLAY_MODE(request) {
        const { displayMode } = request.payload;
        if (currentPageJob && currentPageJob.settings) {
            currentPageJob.settings.displayMode = displayMode;
        }
        DisplayManager.updateDisplayMode(displayMode);
        return { success: true };
    },

    REQUEST_TRANSLATION_STATUS() {
        let status = 'original';
        if (currentPageJob) {
            switch (currentPageJob.state) {
                case 'starting':
                case 'translating':
                    status = 'loading';
                    break;
                case 'translated':
                    status = 'translated';
                    break;
            }
        }
        return Promise.resolve({ state: status });
    },

    DISPLAY_SELECTION_TRANSLATION(request) {
        const { translationId, isLoading } = request.payload;
        if (isLoading) {
            currentSelectionTranslationId = translationId;
        } else if (translationId !== currentSelectionTranslationId) {
            console.log(`[Foxlate] 忽略了一个过时的划词翻译结果。ID: ${translationId}`);
            return { success: true, ignored: true };
        }
        DisplayManager.handleEphemeralTranslation(request.payload);
        return { success: true };
    },

    TOGGLE_SUBTITLE_TRANSLATION(request) {
        if (window.subtitleManager?.toggle) {
            window.subtitleManager.toggle(request.payload.enabled);
        } else {
            console.warn("[Content Script] Subtitle manager not available to toggle. This is expected on non-supported pages.");
        }
        return { success: true };
    },

    REQUEST_SUBTITLE_TRANSLATION_STATUS() {
        if (window.subtitleManager?.getStatus) {
            return Promise.resolve(window.subtitleManager.getStatus());
        }
        return Promise.resolve({ isSupported: false, isEnabled: false });
    }
};

async function handleMessage(request, sender) {
    if (__DEBUG__) {
        console.trace(`[Content Script] Received message from sender:`, request);
    }
    const handler = messageHandlers[request.type];

    if (!handler) {
        console.warn(`[Content Script] Unhandled message type: ${request.type}`);
        return Promise.resolve({ success: false, error: `Unhandled message type: ${request.type}` });
    }

    try {
        // The handler itself can be sync or async, await handles both.
        return await handler(request, sender);
    } catch (error) {
        logError(`handleMessage (type: ${request.type})`, error);
        // (新) 始终返回一个解析后的 Promise，并带有错误信息，以避免在浏览器中出现“未捕获的 Promise 拒绝”错误。
        // 这也与消息传递API的预期行为更一致。
        return { success: false, error: error.message };
    }
}

/**
 * (新) 根据当前页面的设置，独立初始化内容总结功能。
 */
async function initializeSummaryFeature() {
    summaryManager?.destroy(); // 如果已存在，先销毁
    summaryManager = null; // 确保旧实例被垃圾回收
    const settings = await getEffectiveSettings();
    summaryManager = new SummaryManager(settings);
    summaryManager.initialize();
}
// --- Initialization ---

/**
 * 初始化内容脚本。
 * 通过检查一个全局标志来确保所有初始化逻辑只运行一次，
 * 从而使脚本的注入变得幂等（即使被多次注入也不会产生副作用）。
 */
function initializeContentScript() {
    if (window.foxlateContentScriptInitialized) {
        console.log("[Foxlate] Content script already initialized. Skipping re-initialization.");
        return;
    }
    window.foxlateContentScriptInitialized = true;
    console.log("[Foxlate] Initializing content script...");

    // (新) 独立初始化总结功能
    initializeSummaryFeature();

    browser.runtime.onMessage.addListener(handleMessage);
    window.getEffectiveSettings = getEffectiveSettings;
    window.__foxlate_css_injected = true; // 标记CSS注入状态
}

initializeContentScript();