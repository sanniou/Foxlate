import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');
let bundledModules;

async function loadSettingsDomain() {
    if (bundledModules) return bundledModules;

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-settings-domain-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');

    await writeFile(entryPath, `
        export {
            generateDomainTimestamp,
            removeAiEngineFromSettings,
            resolveEffectiveSettings,
            setDomainRuleProperty,
            upsertAiEngine,
            validateSettings,
        } from ${JSON.stringify(path.join(projectRoot, 'src/common/settings-domain.js'))};
    `);

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
    });

    bundledModules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return bundledModules;
}

function createBaseSettings() {
    return {
        autoTranslate: true,
        translatorEngine: 'google',
        targetLanguage: 'zh',
        sourceLanguage: 'auto',
        displayMode: 'append',
        aiEngines: [{ id: 'one', name: 'One' }],
        translationSelector: {
            default: {
                content: 'main, article',
                exclude: '.skip',
            },
        },
        domainRules: {},
    };
}

test('validateSettings deep-merges selector defaults and adds stable domain timestamps', async () => {
    const { generateDomainTimestamp, validateSettings } = await loadSettingsDomain();
    const stored = {
        translationSelector: {
            default: {
                content: '.post',
            },
        },
        domainRules: {
            'example.com': {
                translatorEngine: 'deeplx',
                cssSelector: { content: '.legacy', exclude: '.ad' },
                cssSelectorOverride: true,
            },
        },
    };

    const validated = validateSettings(stored);

    assert.equal(validated.translationSelector.default.content, '.post');
    assert.equal(typeof validated.translationSelector.default.exclude, 'string');
    assert.equal(validated.domainRules['example.com'].addedAt, generateDomainTimestamp('example.com'));
    assert.equal(stored.domainRules['example.com'].addedAt, undefined);
    assert.deepEqual(validated.domainRules['example.com'].translationSelector, {
        content: '.legacy',
        exclude: '.ad',
    });
    assert.equal(validated.domainRules['example.com'].translationSelectorOverride, true);
});

test('resolveEffectiveSettings applies the longest eligible domain rule and resolves default values', async () => {
    const { resolveEffectiveSettings } = await loadSettingsDomain();
    const settings = createBaseSettings();
    settings.domainRules = {
        'example.com': {
            applyToSubdomains: true,
            translatorEngine: 'default',
            targetLanguage: 'ja',
            displayMode: 'replace',
            cssSelector: {
                content: '.article-body',
                exclude: '.ad',
            },
        },
        'blocked.example.com': {
            applyToSubdomains: false,
            translatorEngine: 'deeplx',
        },
    };

    const effective = resolveEffectiveSettings(settings, 'news.example.com');
    assert.equal(effective.source, 'example.com');
    assert.equal(effective.translatorEngine, 'google');
    assert.equal(effective.targetLanguage, 'ja');
    assert.equal(effective.displayMode, 'replace');
    assert.deepEqual(effective.translationSelector, {
        content: 'main, article, .article-body',
        exclude: '.skip, .ad',
    });

    const blockedSubdomain = resolveEffectiveSettings(settings, 'child.blocked.example.com');
    assert.equal(blockedSubdomain.source, 'default');
    assert.equal(blockedSubdomain.translatorEngine, 'google');
});

test('resolveEffectiveSettings applies default subtitle strategies without domain rules', async () => {
    const { resolveEffectiveSettings } = await loadSettingsDomain();
    const effective = resolveEffectiveSettings(createBaseSettings(), 'www.youtube.com');

    assert.deepEqual(effective.subtitleSettings, {
        enabled: true,
        strategy: 'youtube',
        displayMode: 'off',
    });
});

test('resolveEffectiveSettings only merges whitelisted domain rule fields', async () => {
    const { resolveEffectiveSettings } = await loadSettingsDomain();
    const settings = createBaseSettings();
    settings.aiEngines = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
    settings.glossary = { enabled: true, entries: [{ source: 'a', target: 'b' }] };
    settings.domainRules = {
        'example.com': {
            displayMode: 'hover',
            // Pollution: must not wipe globals when flattened into effective.
            aiEngines: [],
            glossary: { enabled: false, entries: [] },
            junkField: 'nope',
        },
    };

    const effective = resolveEffectiveSettings(settings, 'example.com');
    assert.equal(effective.displayMode, 'hover');
    assert.equal(effective.aiEngines.length, 2);
    assert.equal(effective.glossary.enabled, true);
    assert.equal(effective.junkField, undefined);
});

test('resolveEffectiveSettings accepts translationSelector alias on domain rules', async () => {
    const { resolveEffectiveSettings } = await loadSettingsDomain();
    const settings = createBaseSettings();
    settings.domainRules = {
        'example.com': {
            translationSelector: {
                content: '.post-body',
                exclude: '.promo',
            },
            translationSelectorOverride: true,
        },
    };

    const effective = resolveEffectiveSettings(settings, 'www.example.com');
    assert.deepEqual(effective.translationSelector, {
        content: '.post-body',
        exclude: '.promo',
    });
});

test('settings domain mutators update AI engines and rule properties immutably', async () => {
    const {
        removeAiEngineFromSettings,
        setDomainRuleProperty,
        upsertAiEngine,
    } = await loadSettingsDomain();
    const settings = createBaseSettings();
    settings.translatorEngine = 'ai:one';

    const added = upsertAiEngine(settings, { name: 'Two' }, null, () => 'two');
    assert.deepEqual(added.aiEngines.map(engine => engine.id), ['one', 'two']);
    assert.equal(settings.aiEngines.length, 1);

    const removed = removeAiEngineFromSettings(added, 'one');
    assert.equal(removed.translatorEngine, 'ai:two');
    assert.deepEqual(added.aiEngines.map(engine => engine.id), ['one', 'two']);

    const updatedRule = setDomainRuleProperty(settings, 'example.com', 'subtitleDisplayMode', 'bilingual');
    assert.deepEqual(updatedRule.domainRules['example.com'].subtitleSettings, {
        enabled: true,
        displayMode: 'bilingual',
    });
    assert.deepEqual(settings.domainRules, {});

    const ignored = setDomainRuleProperty(settings, 'example.com', 'aiEngines', []);
    assert.equal(ignored, settings);
    assert.equal(ignored.domainRules['example.com'], undefined);
});
