/**
 * background 消息处理器共享的小工具。
 *
 * 拆分前这些函数散在 519 行的单一模块里；按域拆开后必须有一个共同归属，
 * 否则每个 handler 模块都会各自复制一份。
 */
import { getHostnameFromUrl } from '../../common/url-utils.js';

/**
 * 从消息发送者里取主机名；取不到时返回空串（而不是抛错）。
 * @param {object} sender 消息发送者
 * @returns {string} 主机名；取不到时返回空字符串
 */
export function getHostname(sender) {
    return getHostnameFromUrl(sender?.tab?.url) ?? '';
}

/** 计算耗时（毫秒），用于 provider health 记录。 */
export function getLatency(startedAt) {
    return Math.max(0, Date.now() - startedAt);
}
