import browser from '../../lib/browser-polyfill.js';
import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';
import { escapeHtml } from '../../common/utils.js';
import { reconstructDOM } from '../dom-reconstructor.js';
import { translatedContentLayoutService } from '../layout/translated-content-layout-service.js';

class ReplaceStrategy {
    /**
     * 将元素的内容恢复为原始状态。
     * @param {HTMLElement} element - 目标元素。
     */
    revert(element) {
        // 从 DisplayManager 获取状态，而不是从 DOM 的 dataset 读取。
        // 这确保了状态的单一来源，并修复了切换模式时丢失原始内容的问题。
        const data = DisplayManager.getElementData(element);
        if (data && data.originalContent !== undefined) {
           element.innerHTML = data.originalContent;
        }
        element.classList.remove(
            'foxlate-replacing',
            'foxlate-error-underline',
            'foxlate-state-loading',
            'foxlate-state-error',
            'foxlate-state-translated',
        );
        element.title = '';
        element.querySelector('.foxlate-inline-loading')?.remove();
    }

   updateUI(element, state) {
       // Clear previous visual state classes without restoring content yet.
       element.classList.remove(
           'foxlate-replacing',
           'foxlate-error-underline',
           'foxlate-state-loading',
           'foxlate-state-error',
           'foxlate-state-translated',
       );
       element.title = '';
       element.querySelector('.foxlate-inline-loading')?.remove();

       switch (state) {
           case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
               this.revert(element);
               break;
            case Constants.DISPLAY_MANAGER_STATES.LOADING:
               // Shared state class + non-destructive spinner.
               element.classList.add('foxlate-state-loading', 'foxlate-replacing');
                if (!element.querySelector('.foxlate-inline-loading')) {
                    const spinner = document.createElement('span');
                    spinner.className = 'foxlate-inline-loading';
                    spinner.setAttribute('aria-hidden', 'true');
                    element.appendChild(spinner);
                }
                break;
            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                const data = DisplayManager.getElementData(element);
                // 检查是否存在格式保留翻译所需的数据
                if (data && data.translatedText && data.translationUnit?.nodeMap) {
                    try {
                        const fragment = reconstructDOM(data.translatedText, data.translationUnit.nodeMap);
                        element.replaceChildren(fragment); // (优化) 使用 replaceChildren 一次性替换所有子节点，比 innerHTML='' + appendChild 更高效、更现代。
                    } catch (e) {
                        console.error("[Replace Strategy] 重建DOM失败，回退到纯文本替换。", e);
                        // 如果重建失败，执行安全的回退方案
                        element.innerHTML = escapeHtml(data.translatedText).replace(/\n/g, '<br>');
                    }
                } else if (data && data.translatedText) {
                    // 如果没有nodeMap，说明是简单文本，执行纯文本替换
                    element.innerHTML = escapeHtml(data.translatedText).replace(/\n/g, '<br>');
                } else {
                    this.revert(element);
                }
                if (data?.translatedText) {
                    element.classList.add('foxlate-state-translated');
                    translatedContentLayoutService.applyReplaceLayout(element, data.translatedText);
                }
                break;
       case Constants.DISPLAY_MANAGER_STATES.ERROR:
            const errorData = DisplayManager.getElementData(element);
            const errorMessage = errorData?.errorMessage || 'Translation Error';
            const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
            // Non-destructive: keep original text, mark error for hover + a11y.
            element.classList.add('foxlate-error-underline', 'foxlate-state-error');
            element.title = `${errorPrefix}: ${errorMessage}`;
            break;
       default:
           console.warn(`[Replace Strategy] Unknown state: ${state}`);
       }
    }
}

// 导出该类的一个实例，以保持单例模式
export default new ReplaceStrategy();
