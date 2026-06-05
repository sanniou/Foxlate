export function classifySummaryError(error) {
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
        return 'network';
    }
    if (message.includes('timeout') || message.includes('time out')) {
        return 'timeout';
    }
    if (message.includes('unauthorized') || message.includes('auth') || message.includes('401') || message.includes('403')) {
        return 'auth';
    }
    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
        return 'rate_limit';
    }
    if (message.includes('empty') || message.includes('no content') || message.includes('failed to extract')) {
        return 'content_empty';
    }
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('server error')) {
        return 'server_error';
    }

    return 'unknown';
}

export function generateUserFriendlySummaryError(error) {
    const errorType = classifySummaryError(error);
    const baseMessage = error.message || '未知错误';

    switch (errorType) {
        case 'network':
            return `**网络连接错误**\n\n无法连接到服务器。请检查您的网络连接，然后重试。\n\n详细信息：${baseMessage}`;
        case 'timeout':
            return `**请求超时**\n\n服务器响应时间过长。请稍后重试。\n\n详细信息：${baseMessage}`;
        case 'auth':
            return `**认证失败**\n\n请检查您的 API 密钥配置，然后重试。\n\n详细信息：${baseMessage}`;
        case 'rate_limit':
            return `**请求频率限制**\n\n请求过于频繁，请稍等片刻后重试。\n\n详细信息：${baseMessage}`;
        case 'content_empty':
            return `**内容为空**\n\n无法提取到有效内容进行总结。请尝试选择其他文本或刷新页面。\n\n详细信息：${baseMessage}`;
        case 'server_error':
            return `**服务器错误**\n\n服务器暂时无法处理请求。请稍后重试。\n\n详细信息：${baseMessage}`;
        default:
            return `**发生错误**\n\n处理请求时遇到了问题。请重试，如果问题持续存在，请联系支持。\n\n详细信息：${baseMessage}`;
    }
}
