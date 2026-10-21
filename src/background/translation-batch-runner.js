import { preProcess } from './translation-pipeline.js';
import { runSingleTranslation } from './single-translation.js';

/**
 * 批量翻译编排。
 *
 * 一批文本会被拆成三条路：
 *  1. **单条路径**（非 AI、或 AI 但拿不到批量配置）——直接复用 `runSingleTranslation`，
 *     它自带缓存与在途去重，因此这里**不能再提前查一次缓存**（重复查表不但浪费，
 *     `touch()` 还会重排 LRU 进而改变淘汰顺序），也**不能 await**（逐条 await 会把
 *     整批退化成串行，白白浪费 `parallelRequests` 并发额度）。
 *  2. **AI 批量路径**——按解析出的引擎分组，每组一次付费请求。
 *  3. **命中缓存**——缓存值即最终文本，直接返回。
 *
 * 两个关键不变量：
 *  * 批量路径必须与单条路径**共用同一张在途表**，否则两个标签页同时翻译
 *    同一段文本会各调一次付费 AI 接口；
 *  * 必须先把所有批量任务**全部下发**再统一等待——在途项之间可能互相等待
 *    （同批内的重复文本），提前 await 会死锁。
 */
export async function runTranslationBatch(runtime, { texts, targetLang, sourceLang = 'auto', engine, tabId }) {
    const { browserApi, settingsManager, cacheStore, scheduler, inFlight, executor } = runtime;
    const getMessage = (key, args) => browserApi.i18n.getMessage(key, args);

    if (!Array.isArray(texts)) {
        throw new Error("Invalid payload: 'texts' must be an array.");
    }
    if (texts.length === 0) {
        return [];
    }

    const results = new Array(texts.length);
    /** 需要走 AI 批量接口的候选项（每个唯一缓存键一个） @type {{index: number, prepared: object, claim: object}[]} */
    const candidates = [];
    /** 复用了他人在途请求的候选项：必须等批量任务下发后才能安全等待，否则死锁 */
    const waiters = [];
    /** 非 AI 条目：交给单条路径（它自带缓存与在途去重） */
    const singleTasks = [];
    // 整批只读一次设置：逐条读取会重复 structuredClone 整个设置对象。
    const settings = await settingsManager.getValidatedSettings();

    for (let index = 0; index < texts.length; index++) {
        const originalText = texts[index];
        const processedText = preProcess(originalText);

        if (!processedText) {
            results[index] = { text: '', translated: false, log: [getMessage('logEntryPrecheckNoTranslation')] };
            continue;
        }

        if (sourceLang !== 'auto' && sourceLang === targetLang) {
            results[index] = { text: processedText, translated: false, log: [getMessage('logEntryPrecheckNoTranslation')] };
            continue;
        }

        const resolutionLog = [];
        let prepared;
        try {
            prepared = await runtime.pipeline.prepare(processedText, {
                sourceLang,
                targetLang,
                engine,
                settings,
                log: resolutionLog,
            });
        } catch (error) {
            const errorMessage = `Translation failed: ${error.message}`;
            console.error('[TranslatorManager] Failed to prepare translation:', error);
            results[index] = {
                text: '',
                translated: false,
                log: [...resolutionLog, getMessage('logEntryTranslationError', errorMessage)],
                error: errorMessage,
            };
            continue;
        }
        const { cacheKey, resolution } = prepared;
        const { translator, engine: resolvedEngine, config } = resolution;
        const isAiBatchCandidate = Boolean(
            translator?.name === 'AI' && resolvedEngine?.startsWith('ai:') && config,
        );

        if (!isAiBatchCandidate) {
            singleTasks.push(
                runSingleTranslation(runtime, {
                    text: processedText,
                    targetLang,
                    sourceLang,
                    engine: resolvedEngine,
                    tabId,
                    settings,
                }).then(result => { results[index] = result; }),
            );
            continue;
        }

        // AI 批量路径无法复用单条路径的缓存/去重逻辑，因此自己处理：
        if (cacheStore.has(cacheKey)) {
            results[index] = {
                text: cacheStore.touch(cacheKey),
                translated: true,
                log: [
                    getMessage('logEntryStart', [originalText, sourceLang, targetLang]),
                    getMessage('logEntryCacheHit') || '[Cache] Translation served from cache.',
                    ...resolutionLog,
                ],
            };
            continue;
        }

        // 同一段文本可能同时来自批量路径与单条路径，也可能在同一批内重复：
        // 占用同一张在途表，保证付费接口只被调用一次。
        const claim = inFlight.claim(cacheKey);
        if (claim.reused) {
            waiters.push({ index, claim });
        } else {
            candidates.push({ index, prepared, claim });
        }
    }

    const aiGroups = new Map();
    for (const candidate of candidates) {
        const resolvedEngine = candidate.prepared.resolution.engine;
        if (!aiGroups.has(resolvedEngine)) {
            aiGroups.set(resolvedEngine, []);
        }
        aiGroups.get(resolvedEngine).push(candidate);
    }

    const batchTasks = [];
    for (const [resolvedEngine, items] of aiGroups.entries()) {
        const config = items[0].prepared.resolution.config;
        const batchPromise = scheduler.run(signal => executor.executeAiBatchGroup(
            items,
            targetLang,
            sourceLang,
            resolvedEngine,
            config,
            signal,
            tabId,
        ));

        // 批量任务的结果按 index 摊回每个候选项的在途项。
        // 摊回而不是直接 resolve：同一批里的重复文本共享同一个在途项，
        // 而并发进来的单条请求也在等它。
        batchPromise.then(
            groupResults => {
                const byIndex = new Map(groupResults.map(result => [result.index, result]));
                for (const item of items) {
                    const { index: _ignored, ...publicResult } = byIndex.get(item.index)
                        ?? { text: '', translated: false, log: [] };
                    item.claim.settle(publicResult);
                }
            },
            error => {
                for (const item of items) {
                    item.claim.fail(error);
                }
            },
        );

        batchTasks.push(batchPromise);
    }

    // 等待所有路径结算。在途项之间可能互相等待（例如同批内的重复文本），
    // 因此必须先把批量任务全部下发，再统一等待。
    const claims = [...candidates, ...waiters];
    const taskOutcomes = await Promise.allSettled([...batchTasks, ...singleTasks]);

    const claimOutcomes = await Promise.allSettled(claims.map(entry => entry.claim.promise));
    for (let position = 0; position < claims.length; position++) {
        const { index } = claims[position];
        const outcome = claimOutcomes[position];
        if (outcome.status === 'fulfilled') {
            results[index] = outcome.value;
        } else {
            const reason = outcome.reason?.message ?? outcome.reason;
            const errorMessage = `AI batch translation failed: ${reason}`;
            results[index] = {
                text: '',
                translated: false,
                log: [getMessage('logEntryTranslationError', errorMessage)],
                error: errorMessage,
            };
        }
    }

    // 非 AI 条目的失败（典型是用户中断产生的 AbortError）必须继续向上传播，
    // 不能因为改成并行推进就把它吞掉——更早的实现里这个异常会直接冒出 translateBatch。
    for (const outcome of taskOutcomes.slice(batchTasks.length)) {
        if (outcome.status === 'rejected') {
            throw outcome.reason;
        }
    }

    return results;
}
