// story: e01s03
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function readCss(relativePath) {
    return readFile(path.join(projectRoot, relativePath), 'utf8');
}

/**
 * Extract --name: value pairs from a CSS string, optionally limited to a
 * prefers-color-scheme media block. Simple regex parser — good enough for
 * our design-token files.
 */
function extractVars(css, { scheme = 'light' } = {}) {
    let block = css;
    if (scheme === 'dark') {
        const match = css.match(/@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{([\s\S]*)$/i);
        assert.ok(match, 'expected prefers-color-scheme: dark block');
        block = match[1];
    } else {
        // Strip dark media queries so light values are not overwritten by dark ones.
        block = css.replace(/@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{[\s\S]*$/i, '');
    }

    const vars = new Map();
    const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let m;
    while ((m = re.exec(block)) !== null) {
        vars.set(m[1], m[2].trim().toLowerCase());
    }
    return vars;
}

function requireVar(vars, name) {
    assert.ok(vars.has(name), `missing CSS variable ${name}`);
    return vars.get(name);
}

function assertContainsAssignment(css, varName, expectedValue) {
    const re = new RegExp(`${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*${expectedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    assert.match(css, re, `${varName} should be ${expectedValue}`);
}

const CONTENT_FILES = [
    {
        path: 'src/content/style.css',
        map: {
            primary: '--fl-sys-color-primary',
            accent: '--fl-sys-color-accent',
            error: '--fl-sys-color-error',
            text: '--fl-sys-color-on-surface',
        },
    },
    {
        path: 'src/content/enhanced-style.css',
        map: {
            primary: '--fl-color-primary',
            accent: '--fl-color-accent',
            error: '--fl-color-error',
            text: '--fl-color-text-main',
        },
    },
    {
        path: 'src/content/summary/summary.css',
        map: {
            primary: '--fs-primary',
            accent: '--fs-accent',
            error: '--fs-error',
            text: '--fs-text-main',
        },
    },
];

test('content light brand colors match --fox-* tokens', async () => {
    const common = await readCss('src/common/common.css');
    const fox = extractVars(common, { scheme: 'light' });

    const expected = {
        primary: requireVar(fox, '--fox-color-primary'),
        accent: requireVar(fox, '--fox-color-accent'),
        error: requireVar(fox, '--fox-color-error'),
        text: requireVar(fox, '--fox-color-text'),
    };

    for (const file of CONTENT_FILES) {
        const css = await readCss(file.path);
        const lightCss = css.replace(/@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{[\s\S]*$/i, '');
        for (const [key, varName] of Object.entries(file.map)) {
            assertContainsAssignment(lightCss, varName, expected[key]);
        }
    }
});

test('content dark brand colors match --fox-* dark tokens', async () => {
    const common = await readCss('src/common/common.css');
    const foxDark = extractVars(common, { scheme: 'dark' });

    // Dark block in common.css does not override --fox-color-error; only lock colors it sets.
    const expected = {
        primary: requireVar(foxDark, '--fox-color-primary'),
        accent: requireVar(foxDark, '--fox-color-accent'),
        text: requireVar(foxDark, '--fox-color-text'),
    };

    for (const file of CONTENT_FILES) {
        const css = await readCss(file.path);
        const darkMatch = css.match(/@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{([\s\S]*)/i);
        assert.ok(darkMatch, `${file.path} should define a dark media block`);
        const darkCss = darkMatch[1];
        for (const [key, value] of Object.entries(expected)) {
            assertContainsAssignment(darkCss, file.map[key], value);
        }
    }
});
