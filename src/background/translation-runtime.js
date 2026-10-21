import browser from '../lib/browser-polyfill.js';
import { SettingsManager } from '../common/settings-manager.js';
import { DeepLxTranslator } from './translators/deeplx-translator.js';
import { GoogleTranslator } from './translators/google-translator.js';
import { AITranslator } from './translators/ai-translator.js';
import { TranslationCacheStore } from './translation-cache-store.js';
import { TranslationRetryController } from './translation-retry-controller.js';
import { TranslatorEngineResolver } from './translator-engine-resolver.js';
import { AiTaskRunner } from './ai-task-runner.js';
import { TranslationPipeline } from './translation-pipeline.js';
import { TranslationExecutor } from './translation-executor.js';
import { InFlightRegistry } from './in-flight-registry.js';
import { TranslationTaskScheduler } from './translation-task-scheduler.js';

/** 默认引擎套件。顺序与 `defaultEngineOrder` 无关，解析由引擎解析器负责。 */
export function createDefaultTranslators() {
    return {
        deeplx: new DeepLxTranslator(),
        google: new GoogleTranslator(),
        ai: new AITranslator(),
    };
}

/**
 * 组装翻译运行时：把翻译链路上各司其职的部件接起来。
 *
 * 存在的意义是让这些部件**各自可注入、可替换**：`TranslatorManager` 原先是一个
 * 550 行、全部状态都是 static 的类，缓存、并发、在途去重、引擎解析、批量编排
 * 全写在里面，导致任何一处都无法单独拿去做测试。现在每块逻辑都在自己的模块里，
 * 这里只负责连线。
 */
export function createTranslationRuntime({
    browserApi = browser,
    settingsManager = SettingsManager,
    translators = createDefaultTranslators(),
} = {}) {
    const cacheStore = new TranslationCacheStore({ browserApi });
    const retryController = new TranslationRetryController({ browserApi });
    const engineResolver = new TranslatorEngineResolver({ settingsManager, translators });
    const aiTaskRunner = new AiTaskRunner({ settingsManager, aiTranslator: translators.ai });
    const pipeline = new TranslationPipeline({ engineResolver });
    const executor = new TranslationExecutor({ browserApi, cacheStore, retryController, engineResolver });
    const inFlight = new InFlightRegistry();
    const scheduler = new TranslationTaskScheduler();

    return {
        browserApi,
        settingsManager,
        translators,
        cacheStore,
        retryController,
        engineResolver,
        aiTaskRunner,
        pipeline,
        executor,
        inFlight,
        scheduler,
    };
}
