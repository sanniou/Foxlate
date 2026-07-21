// story: e01s01
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const baseManifestPath = path.join(projectRoot, 'public', 'manifest.base.json');
const distManifestPath = path.join(projectRoot, 'dist', 'manifest.json');

async function readJson(filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
}

function runBuild(target) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['build.js', `--target=${target}`], {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`build --target=${target} exited ${code}\n${stderr}`));
        });
    });
}

test('manifest.base.json version is a build-time placeholder', async () => {
    const base = await readJson(baseManifestPath);
    assert.equal(
        base.version,
        '0.0.0',
        'base version must be 0.0.0; package.json is the sole source of truth',
    );
});

test('chrome build injects package version and service_worker background', async () => {
    const { version } = await readJson(packageJsonPath);
    await runBuild('chrome');
    await access(distManifestPath);
    const manifest = await readJson(distManifestPath);

    assert.equal(manifest.version, version);
    assert.equal(manifest.background?.service_worker, 'background/service-worker.js');
    assert.equal(manifest.background?.scripts, undefined);
});

test('firefox build injects package version and scripts background', async () => {
    const { version } = await readJson(packageJsonPath);
    await runBuild('firefox');
    await access(distManifestPath);
    const manifest = await readJson(distManifestPath);

    assert.equal(manifest.version, version);
    assert.deepEqual(manifest.background?.scripts, ['background/service-worker.js']);
    assert.equal(manifest.background?.service_worker, undefined);
});
