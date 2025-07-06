/**
 * The core manager script that must be injected alongside any strategy.
 */
export const SUBTITLE_MANAGER_SCRIPT = 'content/subtitle/subtitle-manager.js';

/**
 * Subtitle Strategy Manifest
 * This file acts as a central registry for all available subtitle translation strategies.
 * To add support for a new website, simply add a new strategy object to the array.
 * This approach decouples the service worker from the specific strategy implementations.
 */
export const SUBTITLE_STRATEGIES = [
    {
        /** A unique identifier for the strategy. */
        name: 'youtube',
        /** The path to the strategy's content script file. */
        file: 'content/subtitle/youtube-subtitle-strategy.js',
        /** An array of hostnames where this strategy should be applied by default. */
        hosts: ['www.youtube.com', 'm.youtube.com']
    },
    {
        name: 'bilibili',
        file: 'content/subtitle/bilibili-subtitle-strategy.js',
        hosts: ['www.bilibili.com']
    },
    // Example for adding a new site in the future:
    // {
    //   name: 'netflix',
    //   file: 'content/subtitle/netflix-subtitle-strategy.js',
    //   hosts: ['www.netflix.com']
    // }
];