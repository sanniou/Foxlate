import { applyGlossaryToText, normalizeGlossary } from '../common/translation-glossary.js';
import { createTranslationCacheKey } from './translation-cache-store.js';

/** 送去引擎之前的规整：非字符串一律视为空。 */
export function preProcess(text) {
    if (typeof text !== 'string') return '';
    return text.trim();
}

/** 引擎返回后的规整。目前是恒等，但两端保持对称，将来要加也只改这里。 */
export function postProcess(text) {
    if (typeof text !== 'string') return '';
    return text;
}

/**
 * 翻译流水线的前缀：源侧词汇表 → 解析引擎 → 算缓存键。
 *
 * 缓存键覆盖了决定最终文本的全部输入（引擎 / 语向 / 词汇表 / 引擎实际收到的文本），
 * 因此缓存里存的就是「最终用户可见文本」——命中路径原样返回即可，
 * 不可能再出现「命中与未命中走了不同后处理」这类不对称。
 */
export class TranslationPipeline {
    #engineResolver;

    constructor({ engineResolver }) {
        this.#engineResolver = engineResolver;
    }

    /**
     * 词汇表指纹。缓存里存的是最终文本（已过词汇表替换），所以词汇表一变就必须失效，
     * 不能只看它是否改写了源文本（新增的词条可能命中引擎输出里的词）。
     * 归一化后按顺序拼接：词汇表是逐条 reduce 应用的，顺序会影响结果。
     */
    glossaryFingerprint(glossary) {
        const normalized = normalizeGlossary(glossary);
        if (!normalized.enabled || normalized.entries.length === 0) {
            return 'none';
        }
        return normalized.entries
            .map(entry => `${entry.caseSensitive ? 'S' : 'I'}${entry.source}\u0001${entry.target}`)
            .join('\u0002');
    }

    /**
     * @param {string} text - 已经 `preProcess` 过的文本。
     * @param {{sourceLang: string, targetLang: string, engine?: string, settings: object, log?: string[]}} options
     */
    async prepare(text, { sourceLang, targetLang, engine, settings, log = [] }) {
        const glossary = settings.glossary;
        const textForTranslation = applyGlossaryToText(text, glossary);
        const resolution = await this.#engineResolver.resolveTranslatorForText(
            textForTranslation,
            engine,
            log,
            settings,
        );
        const cacheKey = createTranslationCacheKey(
            resolution.engine,
            sourceLang,
            targetLang,
            textForTranslation,
            this.glossaryFingerprint(glossary),
        );
        return { cacheKey, glossary, processedText: text, resolution, textForTranslation };
    }
}
