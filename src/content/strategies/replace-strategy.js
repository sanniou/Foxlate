import browser from '../../lib/browser-polyfill.js';
import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';
import { escapeHtml } from '../../common/utils.js';
import { reconstructDOM } from '../dom-reconstructor.js';

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
        // 确保移除所有此策略可能添加的视觉效果
        element.classList.remove('foxlate-replacing', 'foxlate-error-underline');
        element.title = ''; // 清理可能存在的错误提示
        element.querySelector('.foxlate-inline-loading')?.remove();
    }

   updateUI(element, state) {
       // 在应用新状态前，先清理掉旧状态的视觉效果（但不恢复内容）。
       // 这样可以避免在状态切换时残留旧的样式。
       element.classList.remove('foxlate-replacing', 'foxlate-error-underline');
       element.title = '';
       element.querySelector('.foxlate-inline-loading')?.remove();

       switch (state) {
           case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
               this.revert(element);
               break;
            case Constants.DISPLAY_MANAGER_STATES.LOADING:
               // 添加一个 class 来改变文本样式（例如，变暗），而不是替换它。
               element.classList.add('foxlate-replacing');
                // 附加一个加载指示器，而不是替换全部内容
                if (!element.querySelector('.foxlate-inline-loading')) {
                    const spinner = document.createElement('span');
                    spinner.className = 'foxlate-inline-loading';
                    element.appendChild(spinner);
                }
                break;
            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                const data = DisplayManager.getElementData(element);
                // 检查是否存在格式保留翻译所需的数据
                if (data && data.translatedText && data.translationUnit?.nodeMap) {
                    try {
                        const fragment = reconstructDOM(data.translatedText, data.translationUnit.nodeMap);
                        element.innerHTML = '';
                        element.appendChild(fragment);
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
                break;
       case Constants.DISPLAY_MANAGER_STATES.ERROR:
            const errorData = DisplayManager.getElementData(element);
            const errorMessage = errorData?.errorMessage || 'Translation Error';
            const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
            // 非破坏性地显示错误：添加下划线，并将错误信息放入 title 属性，以便悬停查看。
            // 这保留了原始内容，使用户能够看到是哪个文本翻译失败了。
            element.classList.add('foxlate-error-underline');
            element.title = `⚠️ ${errorPrefix}: ${errorMessage}`;
            break;
       default:
           console.warn(`[Replace Strategy] Unknown state: ${state}`);
       }
    }
}

// 导出该类的一个实例，以保持单例模式
export default new ReplaceStrategy();