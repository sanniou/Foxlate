/**
 * 网页上下文提取工具
 * 用于从网页中提取标题、URL等上下文信息，供AI翻译使用
 */

import browser from '../lib/browser-polyfill.js';

/**
 * 从标签页中提取上下文信息
 * @param {number} tabId - 标签页ID
 * @returns {Promise<{title: string, url: string, hostname: string}>}
 */
export async function extractTabContext(tabId) {
    try {
        const tab = await browser.tabs.get(tabId);
        
        if (!tab || !tab.url) {
            return { title: '', url: '', hostname: '' };
        }
        
        // 对于特殊页面，返回基本信息
        if (tab.url.startsWith('about:') || tab.url.startsWith('chrome:') || tab.url.startsWith('moz-extension:')) {
            return { 
                title: tab.title || '', 
                url: '', 
                hostname: '' 
            };
        }
        
        const url = new URL(tab.url);
        const hostname = url.hostname;
        let title = tab.title || '';
        
        // 如果标题为空或太短，尝试从内容脚本获取
        if (!title || title.length < 3) {
            try {
                const results = await browser.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        // 尝试多种方式获取页面标题
                        const titleElement = document.querySelector('title');
                        if (titleElement && titleElement.textContent.trim()) {
                            return titleElement.textContent.trim();
                        }
                        
                        // 尝试获取h1标签
                        const h1Element = document.querySelector('h1');
                        if (h1Element && h1Element.textContent.trim()) {
                            return h1Element.textContent.trim();
                        }
                        
                        // 尝试获取meta property="og:title"
                        const ogTitle = document.querySelector('meta[property="og:title"]');
                        if (ogTitle && ogTitle.content) {
                            return ogTitle.content.trim();
                        }
                        
                        return '';
                    }
                });
                
                if (results && results[0] && results[0].result) {
                    title = results[0].result;
                }
            } catch (error) {
                console.warn('[ContextExtractor] Failed to extract title from content:', error);
            }
        }
        
        return {
            title: title || '',
            url: tab.url,
            hostname: hostname
        };
        
    } catch (error) {
        console.error('[ContextExtractor] Failed to extract tab context:', error);
        return { title: '', url: '', hostname: '' };
    }
}

/**
 * 格式化上下文信息为字符串
 * @param {Object} context - 上下文对象
 * @param {string} context.title - 页面标题
 * @param {string} context.url - 页面URL
 * @param {string} context.hostname - 主机名
 * @returns {string} 格式化的上下文字符串
 */
export function formatContextString(context) {
    const parts = [];
    
    if (context.title) {
        parts.push(`标题：${context.title}`);
    }
    
    if (context.hostname) {
        parts.push(`网站：${context.hostname}`);
    }
    
    if (context.url) {
        parts.push(`链接：${context.url}`);
    }
    
    return parts.join('\n');
}

/**
 * 创建包含上下文的翻译提示词
 * @param {string} basePrompt - 基础提示词
 * @param {Object} context - 上下文对象
 * @returns {string} 包含上下文的提示词
 */
export function createPromptWithContext(basePrompt, context) {
    if (!context || (!context.title && !context.hostname && !context.url)) {
        return basePrompt;
    }
    
    const contextString = formatContextString(context);
    
    // 如果基础提示词已经包含{context}占位符，则不额外添加
    if (basePrompt.includes('{context}')) {
        return basePrompt;
    }
    
    // 在基础提示词前添加上下文信息
    return `上下文信息：
${contextString}

${basePrompt}`;
}