/**
 * This script acts as a loader to dynamically import the main content script as a module.
 * This is necessary because `scripting.executeScript` does not directly support injecting ES modules.
 */
(async () => {
  const src = browser.runtime.getURL('content/content-script.js');
  try {
    await import(src);
  } catch (e) {
    console.error('Error loading content script module:', e);
  }
})();