/**
 * 规划驾驶舱完整性门禁。
 *
 * 背景：specs/ 下的 YAML 是决策驾驶舱（YAML 是 SoT），但历史上它们各自漂移：
 * 同一事实在 state.yaml / release-plan.yaml / execution-status.yaml / SCOPE_LATEST.yaml
 * 四个文件里给出四种答案，且四个文件的**形状**都不符合 bigpowers 框架契约，
 * 导致框架自己的读取器（dashboard/src/loaders/reader.js）读到空集合 —— 驾驶舱静默失明。
 *
 * 本门禁把「唯一 SoT」从口头约定变成可执行不变量：
 *   版本号          → package.json
 *   史诗/故事状态   → execution-status.yaml（release-plan 不得存副本）
 *   路线 / 发布索引 → release-plan.yaml
 *   产品范围        → product/SCOPE_LATEST.yaml
 *   当前会话        → state.yaml（不得含任何版本/状态副本）
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { load } from 'js-yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = join(ROOT, 'specs');

const readYaml = relativePath => load(readFileSync(join(SPECS, relativePath), 'utf8'));
const readJson = relativePath => JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));

const PACKAGE_VERSION = readJson('package.json').version;
const CHANGELOG = readFileSync(join(ROOT, 'changelog.md'), 'utf8');

/** changelog.md 中出现的所有已发布版本号。 */
const shippedVersions = new Set(
    [...CHANGELOG.matchAll(/^##\s+\[(\d+\.\d+\.\d+)\]/gm)].map(match => match[1])
);

describe('规划驾驶舱：state.yaml', () => {
    const state = readYaml('state.yaml');

    it('使用框架契约的顶层键（框架读取器只认这些键）', () => {
        for (const key of [
            'active_flow', 'active_epic_id', 'active_story_id', 'active_bug_id',
            'release', 'epic_cycle', 'bug_cycle', 'git', 'handoff',
        ]) {
            assert.ok(key in state, `state.yaml 缺少框架契约键 "${key}"`);
        }
    });

    it('不复制其他文件的 SoT（anti-pattern: Duplicate Plan）', () => {
        assert.ok(!('product' in state), 'state.yaml 不得持有 product 块；版本 SoT 是 package.json');
        assert.ok(!('session' in state), 'state.yaml 的会话键必须在顶层，不得包在 session: 下');
        assert.ok(!('version' in state.release), 'state.yaml 不得存版本副本');
        assert.equal(state.release.target_version, null,
            'state.yaml 的 release.target_version 由 package.json 决定，必须保持 null');
    });

    it('不手抄 commit hash', () => {
        assert.ok(
            state.git.hash === null || state.git.hash === undefined,
            'state.yaml 不得手抄 git hash；需要时现读 git rev-parse'
        );
    });
});

describe('规划驾驶舱：execution-status.yaml', () => {
    const status = readYaml('execution-status.yaml');

    it('以 development_status 包裹（框架读取器与 Allure 报告都只读这个键）', () => {
        assert.ok(status && typeof status === 'object', 'execution-status.yaml 必须解析为对象');
        assert.ok(
            status.development_status && typeof status.development_status === 'object',
            'execution-status.yaml 必须在 development_status: 下登记状态；'
            + '扁平写法会让 dashboard/src/loaders/reader.js 读到空集合'
        );
    });

    it('状态值限定在框架词汇表内', () => {
        const allowed = new Set(['done', 'todo', 'in_progress', 'pending']);
        for (const [id, value] of Object.entries(status.development_status)) {
            assert.ok(allowed.has(value), `状态 "${id}: ${value}" 不在词汇表内`);
        }
    });

    it('至少登记了一个史诗级状态', () => {
        const epicKeys = Object.keys(status.development_status).filter(key => /^e\d+$/.test(key));
        assert.ok(epicKeys.length > 0, 'development_status 至少要有一个 eNN 史诗条目');
    });
});

describe('规划驾驶舱：release-plan.yaml', () => {
    const plan = readYaml('release-plan.yaml');
    const status = readYaml('execution-status.yaml').development_status;

    it('release.version 与 package.json 一致（版本唯一 SoT）', () => {
        assert.equal(plan.release.version, PACKAGE_VERSION,
            'release-plan.yaml 的 release.version 必须等于 package.json 的 version');
    });

    it('史诗条目不得带 status（anti-pattern: Status in release-plan）', () => {
        const allEpics = [...(plan.epics || []), ...(plan.backlog || [])];
        for (const epic of allEpics) {
            assert.ok(!('status' in epic),
                `史诗 ${epic.id} 不得在 release-plan.yaml 里带 status；`
                + '状态只存在于 execution-status.yaml');
        }
    });

    it('每个史诗都有对应的状态条目', () => {
        const allEpics = [...(plan.epics || []), ...(plan.backlog || [])];
        assert.ok(allEpics.length > 0, 'release-plan.yaml 至少要有 1 个史诗');
        for (const epic of allEpics) {
            assert.ok(epic.id in status, `史诗 ${epic.id} 在 execution-status.yaml 中没有状态条目`);
        }
    });

    it('track 状态与所辖史诗状态不矛盾', () => {
        const tracks = plan.tracks || [];
        assert.ok(tracks.length > 0, 'release-plan.yaml 必须声明产品路线 tracks');

        for (const track of tracks) {
            const owned = (plan.epics || []).filter(epic => epic.track === track.id);
            const unfinished = owned.filter(epic => status[epic.id] !== 'done');

            if (track.status === 'done') {
                assert.deepEqual(
                    unfinished.map(epic => epic.id), [],
                    `轨道 ${track.id} 标为 done，但所辖史诗 ${unfinished.map(e => e.id).join(', ')} 未完成`
                );
            } else {
                assert.ok(unfinished.length > 0,
                    `轨道 ${track.id} 标为 ${track.status}，但所辖史诗全部已完成 —— `
                    + '这正是历史上「声称 active 却早已交付」的漂移形态');
            }
        }
    });

    it('非空 capsule_dir 必须真实存在', () => {
        for (const epic of [...(plan.epics || []), ...(plan.backlog || [])]) {
            if (!epic.capsule_dir) continue;
            assert.ok(existsSync(join(ROOT, epic.capsule_dir)),
                `史诗 ${epic.id} 的 capsule_dir "${epic.capsule_dir}" 不存在`);
        }
    });
});

describe('规划驾驶舱：product/SCOPE_LATEST.yaml', () => {
    const scope = readYaml(join('product', 'SCOPE_LATEST.yaml'));

    it('具备框架 scope-work 要求的必备字段', () => {
        for (const key of [
            'core_value', 'summary', 'in_scope', 'out_of_scope',
            'constraints', 'success_criteria', 'references',
        ]) {
            assert.ok(key in scope, `SCOPE_LATEST.yaml 缺少必备字段 "${key}"（见 skills/scope-work）`);
        }
    });

    it('每个 in_scope 项都映射到史诗或显式 defer', () => {
        for (const entry of scope.in_scope) {
            const mapped = entry.epic ?? entry.deferred;
            assert.ok(mapped, `in_scope 项 "${entry.id}" 既未映射 epic 也未显式 defer`);
        }
    });

    it('每个 out_of_scope 项都写明理由（防 scope creep）', () => {
        for (const entry of scope.out_of_scope) {
            assert.ok(entry.item && entry.reason,
                `out_of_scope 项 "${JSON.stringify(entry)}" 必须同时给出 item 与 reason`);
        }
    });

    it('version_shipped 与 package.json / changelog.md 一致', () => {
        assert.ok(scope.version_shipped.includes(PACKAGE_VERSION),
            `version_shipped 必须包含当前版本 ${PACKAGE_VERSION}`);
        for (const version of scope.version_shipped) {
            assert.ok(shippedVersions.has(version),
                `version_shipped 声称 ${version} 已发布，但 changelog.md 里没有这一版`);
        }
    });

    it('version_target 不是已发布的版本', () => {
        assert.ok(scope.version_target, 'version_target 必须写明下一个目标版本');
        assert.ok(!shippedVersions.has(scope.version_target),
            `version_target "${scope.version_target}" 已经发布过了`);
        assert.ok(!scope.version_shipped.includes(scope.version_target),
            `version_target "${scope.version_target}" 不能在 version_shipped 里`);
    });
});
