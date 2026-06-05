import { initializeContentRuntime } from './content-runtime.js';

initializeContentRuntime().catch(error => {
    console.error('[Foxlate] Failed to initialize content runtime:', error);
});
