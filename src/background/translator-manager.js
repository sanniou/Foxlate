import browser from '../lib/browser-polyfill.js';
import { createTranslationRuntime } from './translation-runtime.js';
import { runSingleTranslation } from './single-translation.js';
import { runTranslationBatch } from './translation-batch-runner.js';

/**
 * 翻译对外门面。
 *
 * 这一类**只做三件事**：持有单例运行时、在启动时引导它、把公开静态 API 转成
 * 对运行时部件的调用。所有真正的逻辑（并发调度、在途去重、引擎解析、流水线
 * 准备、执行与重试、批量编排）都在 `translation-runtime.js` 组装的模块里。
 *
 * 之所以仍然保持全静态：调用方（`service-worker.js`、各 handler）把它当作一个
 * 进程级单例使用，`translatorManager` 这个对象本身还会被注入进 handler 工厂。
 * 替换它意味着改动所有注入点，收益却只是把 static 换成 module 级 const。
 */
export class TranslatorManager {
    static #runtime = createTranslationRuntime({ browserApi: browser });

    static {
        (async () => {
            try {
                await TranslatorManager.#runtime.cacheStore.load();
                await TranslatorManager.updateConcurrencyLimit();
                await TranslatorManager.updateCacheSize();
            } catch (e) {
                console.error("[TranslatorManager] Failed to set initial concurrency limit.", e);
            }
        })();

        // 监听存储变化，以便在用户更改设置时动态更新配置。
        browser.storage.onChanged.addListener((changes, area) => {
            // 确保是 sync 存储区域且 settings 对象发生了变化
            if (area === 'sync' && changes.settings) {
                // 无需等待这些 promise，因为它们是后台更新，不阻塞其他操作。
                TranslatorManager.updateConcurrencyLimit();
                TranslatorManager.updateCacheSize();
            }
        });
    }

    /**
     * 根据已解析的引擎ID，同步获取一个翻译器实例。
     * 此方法不处理默认引擎的解析逻辑。
     * @param {string} resolvedEngine - 一个明确的引擎ID (例如, 'deeplx', 'ai:12345')。
     * @returns {object|undefined} 翻译器实例。
     */
    static getTranslator(resolvedEngine) {
        return TranslatorManager.#runtime.engineResolver.getTranslator(resolvedEngine);
    }

    /**
     * 翻译单条文本（含缓存与在途去重）。
     * @param {string} text
     * @param {string} targetLang
     * @param {string} [sourceLang='auto']
     * @param {string} [engine] - 指定引擎；省略则由设置解析
     * @param {number} [tabId] - 用于提取 AI 上下文
     */
    static translateText(text, targetLang, sourceLang = 'auto', engine, tabId) {
        return runSingleTranslation(TranslatorManager.#runtime, { text, targetLang, sourceLang, engine, tabId });
    }

    /**
     * 批量翻译。AI 引擎会合并成一次付费请求，其余条目走单条路径并行推进。
     */
    static translateBatch(texts, targetLang, sourceLang = 'auto', engine, tabId) {
        return runTranslationBatch(TranslatorManager.#runtime, { texts, targetLang, sourceLang, engine, tabId });
    }

    /** 使用 AI 执行内容总结。 */
    static async summarize(text, aiModel, targetLang, tabId) {
        return TranslatorManager.#runtime.aiTaskRunner.summarize(text, aiModel, targetLang, tabId);
    }

    /** 与 AI 进行对话。 */
    static async converse(history, aiModel, targetLang, tabId) {
        return TranslatorManager.#runtime.aiTaskRunner.converse(history, aiModel, targetLang, tabId);
    }

    /** 使用 AI 推断后续对话建议。 */
    static async inferSuggestions(history, aiModel, targetLang, tabId) {
        return TranslatorManager.#runtime.aiTaskRunner.inferSuggestions(history, aiModel, targetLang, tabId);
    }

    /** 中断所有待处理与正在进行的翻译任务。 */
    static interruptAll() {
        TranslatorManager.#runtime.scheduler.interruptAll();
    }

    /**
     * 只中断某个标签页的任务。
     * 页面上的「还原」只能停自己的那批——中断全部会把其它标签页在途（可能已付费）
     * 的翻译一起 abort，而那里没有任何用户动作。
     * @param {number} tabId
     */
    static interruptTab(tabId) {
        TranslatorManager.#runtime.scheduler.interruptTab(tabId);
    }

    static async updateConcurrencyLimit() {
        const settings = await TranslatorManager.#runtime.settingsManager.getValidatedSettings();
        TranslatorManager.#runtime.scheduler.setMaxConcurrent(settings.parallelRequests);
    }

    static async updateCacheSize() {
        const settings = await TranslatorManager.#runtime.settingsManager.getValidatedSettings();
        TranslatorManager.#runtime.cacheStore.updateLimit(settings.cacheSize);
    }

    /** 获取当前缓存的信息（条数 / 上限）。 */
    static async getCacheInfo() {
        const { cacheStore } = TranslatorManager.#runtime;
        return { count: cacheStore.size, limit: cacheStore.limit };
    }

    static async clearCache() {
        await TranslatorManager.#runtime.cacheStore.clear();
    }
}
