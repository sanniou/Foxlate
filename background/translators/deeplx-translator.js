import { BaseTranslator } from './base-translator.js';

export class DeepLxTranslator extends BaseTranslator {
  constructor() {
    super('DeepLx');
    // The API URL will now be fetched from settings in the translate method.
  }

  async translate(text, targetLang, sourceLang = 'auto') {
    const { settings } = await browser.storage.sync.get('settings');
    const apiUrl = settings?.deeplxApiUrl;

    if (!apiUrl) {
      throw new Error('API URL not set in options');
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          source_lang: sourceLang,
          target_lang: targetLang,
        }),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      // Note: The structure of data.data depends on the DeepLx API implementation you use.
      return data.data;
    } catch (error) {
      console.error(`DeepLx Translation Error: ${error.message}`);
      throw new Error(`DeepLx translation failed: ${error.message}`);
    }
  }
}
