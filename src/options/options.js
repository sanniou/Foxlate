import { bootstrapOptionsPage } from './options-app.js';

document.addEventListener('DOMContentLoaded', () => {
    bootstrapOptionsPage().catch(error => {
        console.error('Failed to initialize options page:', error);
    });
});
