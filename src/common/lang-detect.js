import { LANGUAGE_CONFIG, SUPPORTED_LANG_CODES } from './language-config.js';

/**
 * franc 语言检测库的运行时懒加载层。
 *
 * 背景：franc 打包后约 240 KB，而它只服务于两个真实场景 ——
 * 朗读（TTS）时的语言判定、以及翻译前的同语言预检。
 * 如果把它静态 import 进来，所有引用 `detectLang` 的产物（content / popup /
 * options / service-worker）都会各自内联 240 KB，而其中三个根本用不到。
 *
 * 因此这里把 franc 拆成「运行时按需加载的独立资源」：
 *   1. 构建期把 `src/lib/franc.bundle.mjs` 复制到 `dist/lib/franc.bundle.mjs`；
 *   2. 运行期用 `import(browser.runtime.getURL(...))` 拉取，esbuild 不会内联；
 *   3. 在 franc 就绪前，`detectLang` 使用下方的高置信度字符集启发式规则，
 *      该规则已覆盖 LANGUAGE_CONFIG 中的全部 11 种语言。
 *
 * 这让 `detectLang` 保持同步语义（热路径 `shouldTranslate` 依赖这一点），
 * 同时把 240 KB 从静态依赖图中彻底移除。
 * @see https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry
 */

const FRANC_ASSET_PATH = 'lib/franc.bundle.mjs';

/** @type {((text: string, options?: object) => string) | null} */
let francDetect = null;
/** @type {Promise<boolean> | null} */
let francLoadPromise = null;

/**
 * 取出扩展运行时的 getURL 能力。不使用 browser-polyfill，避免本模块被迫依赖它。
 * @returns {((path: string) => string) | null}
 */
function resolveGetUrl() {
    const api = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;
    return typeof api?.getURL === 'function' ? api.getURL.bind(api.runtime ?? api) : null;
}

/**
 * franc 是否已就绪。未就绪时 `detectLang` 走启发式规则。
 * @returns {boolean}
 */
function isLanguageDetectorReady() {
    return typeof francDetect === 'function';
}

/**
 * 直接从模块对象中取出可用的 franc 函数。
 * @param {any} mod
 * @returns {((text: string, options?: object) => string) | null}
 */
function extractFranc(mod) {
    const candidate = mod?.franc ?? mod?.default?.franc ?? mod?.default;
    return typeof candidate === 'function' ? candidate : null;
}

/**
 * 按需加载 franc 语言检测库。可安全地并发调用（内部去重）。
 * 加载失败时静默降级为启发式规则，不抛错。
 * @returns {Promise<boolean>} 是否加载成功。
 */
export async function loadLanguageDetector() {
    if (francDetect) return true;
    if (francLoadPromise) return francLoadPromise;

    francLoadPromise = (async () => {
        try {
            const getUrl = resolveGetUrl();
            if (!getUrl) return false;
            // 变量形式的说明符：esbuild 无法静态解析，因此会原样保留这条动态 import。
            const url = getUrl(FRANC_ASSET_PATH);
            const mod = await import(/* @vite-ignore */ url);
            francDetect = extractFranc(mod);
        } catch {
            // 资源缺失 / CSP 拒绝 / 非扩展环境 —— 全部降级为启发式规则。
            francDetect = null;
        }
        return isLanguageDetectorReady();
    })();

    return francLoadPromise;
}

/**
 * 触发一次加载但不等待结果，用于在用户可见的异步起点（如翻译开始）预热。
 * @returns {void}
 */
export function preloadLanguageDetector() {
    if (isLanguageDetectorReady() || francLoadPromise) return;
    void loadLanguageDetector();
}

/**
 * 当 franc 无法确定（或尚未加载）时，基于字符集做补充判断。
 * 规则顺序经过精心设计：高置信度、无歧义的规则（韩文、日文假名、西里尔）前置；
 * 共享字符集的语言优先匹配其独有字符（œ / ì / ß）；英语和纯汉字作为最后的后备。
 * @param {string} text
 * @returns {string} ISO 639-3 代码
 */
function detectByCharacterSet(text) {
    if (/[가-힣]/.test(text)) { // 韩文音节
        return 'kor';
    } else if (/[ぁ-んァ-ン]/.test(text)) { // 日文平假名和片假名
        return 'jpn';
    } else if (/[\u0400-\u04FF]/.test(text)) { // 西里尔字母 (俄语等)
        return 'rus';
    } else if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) { // 阿拉伯字母区（含波斯/乌尔都扩展区）
        return 'ara';
    } else if (/[\u0E00-\u0E7F]/.test(text)) { // 泰文区
        return 'tha';
    } else if (/[\u0590-\u05FF]/.test(text)) { // 希伯来文区
        return 'heb';
    } else if (/[\u0900-\u097F]/.test(text)) { // 天城文区（印地语等）
        return 'hin';
    } else if (/[\u0370-\u03FF]/.test(text)) { // 希腊字母区
        return 'ell';
    } else if (/[ñ]/.test(text)) { // 西班牙语特有字符
        return 'spa';
    } else if (/[æœ]/.test(text)) { // 法语特有字符 (æ, œ 是高置信度标志)
        return 'fra';
    } else if (/[ãõ]/.test(text)) { // 葡萄牙语特有字符 (ã, õ 是高置信度标志)
        return 'por';
    } else if (/[ìò]/.test(text) && !/[áéíóú]/.test(text)) { // 意大利语特征字符 (ì, ò 较独特)
        return 'ita';
    } else if (/[äöüß]/.test(text)) { // 德语特有字符 (ß, ä, ö, ü)
        return 'deu';
    } else if (/\bij\b/i.test(text)) { // 荷兰语特有双字母 (ij)
        return 'nld';
    } else if (/^[\u4e00-\u9fa5\s\p{P}\p{S}]+$/u.test(text)) { // 仅包含汉字、空格、标点和符号
        return 'cmn';
    } else if (/^[a-zA-Z0-9\s\p{P}\p{S}]+$/u.test(text)) {
        // 仅包含基础拉丁字符、数字、空格、标点和符号。
        // 漏掉 `\p{S}` 会让含 `$ + ~ < > |` 的正常英文（价格为 `$5`、副标题、代码片段里的运算符）
        // 落到 `und` → 被当成「不支持的语言」跳过，实测副标题级漏翻 7.9–26.5%。
        return 'eng';
    }
    return 'und';
}

/**
 * 检测给定文本最可能的语言。
 * 同步返回：franc 已就绪时以 franc 结果为准，否则使用字符集启发式规则。
 * @param {string} text - 要检测的文本。
 * @param {object} [options={}] - franc 检测库的选项。
 * @param {string[]} [options.whitelist] - 语言代码白名单 (ISO 639-3)。
 * @returns {string} 三字母 ISO 639-3 语言代码 (例如, 'eng', 'cmn', 'und')。
 */
function detectLang(text, options = {}) {
    if (!text || !text.trim()) {
        return 'und';
    }

    let lang = 'und';
    if (francDetect) {
        try {
            lang = francDetect(text, options) || 'und';
        } catch {
            lang = 'und';
        }
    }

    // 与启发式规则互补：franc 对短文本常常返回 'und'，直接放弃会错失大量可识别短语。
    if (lang === 'und') {
        return detectByCharacterSet(text);
    }

    return lang;
}

/**
 * 检测文本的语言并返回一个适用于 SpeechSynthesis 的 BCP 47 代码。
 * @param {string} text - 要检测的文本。
 * @returns {string} BCP 47 语言代码，如果无法确定则默认为 'en-US'。
 */
export function detectSpeechLang(text) {
    const lang3 = detectLang(text, { whitelist: SUPPORTED_LANG_CODES });
    return LANGUAGE_CONFIG[lang3]?.speechCode || 'en-US'; // 如果未找到映射，则回退到英语
}

/**
 * 检测文本的语言并返回其原始代码和项目特定代码。
 * @param {string} text - 要检测的文本。
 * @param {object} [options={}] - franc 检测库的选项。
 * @returns {{rawCode: string, projectCode: string|null}} 包含原始 ISO 639-3 代码和项目代码的对象。
 */
export function detectProjectLang(text, options = {}) {
    const mergedOptions = {
        whitelist: SUPPORTED_LANG_CODES,
        ...options,
    };
    const rawCode = detectLang(text, mergedOptions);
    const projectCode = LANGUAGE_CONFIG[rawCode]?.projectCode || null;
    return { rawCode, projectCode };
}
