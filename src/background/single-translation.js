import { preProcess } from './translation-pipeline.js';

/**
 * 单条翻译的完整入口：预处理 → 读设置 → 准备（词汇表/引擎/缓存键）→
 * 查永久缓存 → 复用在途请求 → 入队执行。
 *
 * 步骤 2 与 3 的顺序有讲究：在途表必须在缓存查之后占用，否则缓存命中的请求
 * 会白白占住一个键、让后来者等一个已经在内存里的结果。
 */
export async function runSingleTranslation(runtime, { text, targetLang, sourceLang = 'auto', engine, tabId, settings }) {
    const { browserApi, settingsManager, cacheStore, scheduler, inFlight, pipeline, executor } = runtime;
    const getMessage = (key, args) => browserApi.i18n.getMessage(key, args);

    const processedText = preProcess(text);
    if (!processedText) {
        return { text: '', translated: false, log: [getMessage('logEntryPrecheckNoTranslation')] };
    }

    const effectiveSettings = settings || await settingsManager.getValidatedSettings();
    const resolutionLog = [];
    let prepared;
    try {
        prepared = await pipeline.prepare(processedText, {
            sourceLang,
            targetLang,
            engine,
            settings: effectiveSettings,
            log: resolutionLog,
        });
    } catch (error) {
        // 引擎配置不可用（例如 AI 引擎已被删除）时，给出与翻译失败一致的结果结构。
        const errorMessage = `Translation failed: ${error.message}`;
        console.error('[TranslatorManager] Failed to prepare translation:', error);
        return {
            text: '',
            translated: false,
            log: [...resolutionLog, getMessage('logEntryTranslationError', errorMessage)],
            error: errorMessage,
        };
    }
    const { cacheKey } = prepared;

    // 1. 检查永久缓存。缓存值即最终文本，直接返回，不再做任何后处理。
    if (cacheStore.has(cacheKey)) {
        const log = [
            getMessage('logEntryStart', [text, sourceLang, targetLang]),
            getMessage('logEntryCacheHit') || '[Cache] Translation served from cache.',
            ...resolutionLog,
        ];
        return { text: cacheStore.touch(cacheKey), translated: true, log };
    }

    // 2. 在途表：同样的请求已经在跑就直接复用（单飞去重）
    const claim = inFlight.claim(cacheKey);
    if (claim.reused) {
        return claim.promise;
    }

    // 3. 创建新的翻译任务，并把任务结果桥接到在途项上。
    //    结算权交给任务本身，在途项只负责“让并发调用者看到同一个 promise”。
    scheduler.run(signal => executor.executeTranslation(prepared, targetLang, sourceLang, signal, tabId))
        .then(
            result => claim.settle(result),
            error => claim.fail(error),
        );

    return claim.promise;
}
