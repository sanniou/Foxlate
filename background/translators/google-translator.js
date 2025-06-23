import { BaseTranslator } from './base-translator.js';

export class GoogleTranslator extends BaseTranslator {
  constructor() {
    super('Google');
    this.apiUrl = 'https://translation.googleapis.com/language/translate/v2';
  }

  async translate(text, targetLang, sourceLang = 'auto') {
    const { settings } = await browser.storage.sync.get('settings');
    const apiKey = settings?.googleApiKey;

    if (!apiKey) {
      throw new Error('API Key not set in options');
    }

    const url = new URL(this.apiUrl);
    url.searchParams.append('key', apiKey);

    const body = {
      q: text,
      target: targetLang,
    };

    if (sourceLang && sourceLang !== 'auto') {
      body.source = sourceLang;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data.translations[0].translatedText;
    } catch (error) {
      console.error(`Google Translation Error: ${error.message}`);
      throw new Error(`Google translation failed: ${error.message}`);
    }
  }
}