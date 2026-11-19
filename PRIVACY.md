# Privacy Policy for Foxlate

**Last Updated: 2026-11-19**

Foxlate is an open-source browser extension; its code is available for review on [GitHub](https://github.com/sanniou/foxlate).

Foxlate itself runs no servers, has no telemetry and no analytics. It does, however, **send the text you ask it to translate to the translation service you have selected** — that is what a translation extension does. The sections below describe exactly what leaves your browser.

## 1. Data that stays on your device

Stored in your browser's extension storage, never uploaded by Foxlate:

- your settings (engine choice, target language, display mode, domain rules, content selectors, glossary);
- API keys and endpoint URLs you enter for DeepLX / your own AI provider;
- the translation cache and the recent-translation history (clearable in Settings);
- per-tab state (what was translated on which tab).

If your browser syncs extension storage, that sync is performed by the browser vendor under their own policy — Foxlate only writes to the extension storage areas it is given.

## 2. Data that leaves your browser

Foxlate sends data only to endpoints **you can see and change** in Settings:

| Feature | What is sent | Where it goes | Default |
|---|---|---|---|
| Page / selection / input translation | the text being translated | the engine you selected | **Google Translate** (`translate.googleapis.com`) |
| AI translation | the text being translated + your prompt | the AI endpoint you configure | — (must be configured) |
| AI summary & follow-up questions | the page body (or the selected text) + your question | the AI endpoint you configure | — (must be configured) |
| DeepLX translation | the text being translated | the DeepLX URL you enter | — (must be configured) |
| Subtitle translation | subtitle lines | same as page translation | follows your engine |
| Text-to-speech | the text to be read aloud | your operating system's speech engine | on demand |

The page text sent for translation is the part Foxlate selected as translatable; it is not a dump of your full browsing history, and nothing is sent for pages you did not ask it to translate.

Because the default engine is Google, a fresh install that translates a page sends that page's text to Google. You can change or disable the engine at any time in Settings.

## 3. Third-party services

The services above are operated by third parties and are subject to their own privacy policies. Foxlate does not control them, does not proxy them, and does not see their responses beyond what your browser receives.

## 4. Cloud backup (optional, off by default)

When you enable backup, Foxlate writes your **settings** — with API keys and secrets blanked out — into your browser's sync storage so they can follow you to another device. Translated text is never included in a backup.

## 5. What Foxlate does not do

- No analytics, telemetry, crash reporting or usage counters.
- No accounts, no identifiers, no advertising, no selling of data.
- No remote code: all executable code ships inside the extension package.
- No reading of pages you have not asked it to act on.

## 6. Your controls

- Clear the translation cache and history in Settings.
- Change the engine, endpoint, or prompt at any time; set the engine to one you trust.
- Disable individual features (page translation, selection translation, input translation, subtitles, summary) in Settings.
- Uninstalling the extension removes its local storage.

## 7. Contact

Open an issue at <https://github.com/sanniou/foxlate/issues>.
