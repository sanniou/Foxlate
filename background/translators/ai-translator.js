import { BaseTranslator } from './base-translator.js';

export class AITranslator extends BaseTranslator {
  constructor() {
    super('AI');
  }

  async translate(text, targetLang, sourceLang = 'auto') {
    const { settings } = await browser.storage.sync.get('settings');
    const apiKey = settings?.aiApiKey;
    const apiUrl = settings?.aiApiUrl || 'https://api.openai.com/v1/chat/completions';
    const model = settings?.aiModelName || 'gpt-3.5-turbo';

    if (!apiKey) {
      throw new Error('AI API Key not set in options');
    }

    const systemPrompt = `You are a translation assistant. Translate the user's text to ${targetLang}. Output only the translated text, without any additional explanations or context.`;

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
          temperature: 0.1, // Lower temperature for more deterministic translations
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData?.error?.message || `${response.status} ${response.statusText}`;
        throw new Error(`API Error: ${errorMessage}`);
      }

      const data = await response.json();
      
      if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        return data.choices[0].message.content.trim();
      } else {
        throw new Error('Invalid response structure from AI API');
      }

    } catch (error) {
      console.error(`AI Translation Error: ${error.message}`);
      throw new Error(`AI translation failed: ${error.message}`);
    }
  }
}