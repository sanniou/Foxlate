import {
    measureLineStats,
    measureNaturalWidth,
    prepareWithSegments,
} from '@chenglou/pretext';
import { textMeasurementService } from '../../common/text-measurement.js';

/**
 * 精确排版引擎（content 侧专用）。
 *
 * `@chenglou/pretext` 体积可观，只有页面翻译 / 摘要这些真正在意断行保真度的
 * 场景才需要它。因此它被隔离在本适配器里，通过 `textMeasurementService.setEngine()`
 * 注入 —— popup、options、service worker 的依赖图中不会出现它。
 *
 * @type {{ name: string, prepare: Function, measureLineStats: Function, measureNaturalWidth: Function }}
 */
const pretextMeasurementEngine = {
    name: 'pretext',

    prepare(text, textStyle) {
        return prepareWithSegments(text, textStyle.font, {
            whiteSpace: textStyle.whiteSpace,
            wordBreak: textStyle.wordBreak,
            letterSpacing: textStyle.letterSpacing,
        });
    },

    measureLineStats(prepared, maxWidth) {
        return measureLineStats(prepared, maxWidth);
    },

    measureNaturalWidth(prepared) {
        return measureNaturalWidth(prepared);
    },
};

/**
 * 在 content runtime 启动的最早阶段调用，之后所有文本测量都走 pretext。
 * @param {import('../../common/text-measurement.js').TextMeasurementService} [service]
 */
export function registerPretextMeasurementEngine(service = textMeasurementService) {
    service.setEngine(pretextMeasurementEngine);
    return service;
}
