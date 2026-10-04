import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    importIntradayMonitorRuntimeArtifactBundle,
    resolveIntradayMonitorRuntimeArtifactBundle,
} from './runtime-artifact-bundle.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))));

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'intraday-artifact-bundle-'));
    roots.push(root);
    const repo = path.join(root, 'repo');
    const appSupport = path.join(root, 'app-support');
    const active = path.join(repo, 'openspec', 'changes', 'example', 'acceptance');
    await mkdir(active, { recursive: true });
    const sources = {
        cohort: path.join(active, 'cohort.json'),
        plan: path.join(active, 'plan.json'),
        baseline: path.join(active, 'baseline.json'),
        prerequisite: path.join(active, 'prerequisite.json'),
    };
    for (const [role, file] of Object.entries(sources)) {
        await writeFile(file, `${JSON.stringify({ schemaVersion: `${role}/1`, role })}\n`);
    }
    const artifacts = Object.entries(sources).map(([role, sourcePath]) => ({
        role,
        path: sourcePath,
        schema: `${role}/1`,
        dependencies: role === 'plan' ? ['cohort'] : [],
    }));
    return { root, repo, appSupport, active, sources, artifacts };
}

describe('archive-stable runtime artifact bundle', () => {
    it('匯入 content-addressed bundle，來源歸檔後仍可解析相同內容', async () => {
        const value = await fixture();
        const imported = await importIntradayMonitorRuntimeArtifactBundle({
            appSupportRoot: value.appSupport,
            repoDirectory: value.repo,
            sourceIdentity: 'openspec-change:example',
            artifacts: value.artifacts,
            createdAt: '2026-09-22T08:00:00+08:00',
        });
        expect(imported.valid).toBe(true);
        const archived = path.join(value.repo, 'openspec', 'changes', 'archive', 'example');
        await mkdir(path.dirname(archived), { recursive: true });
        await rename(path.dirname(value.active), archived);
        const resolved = await resolveIntradayMonitorRuntimeArtifactBundle({
            appSupportRoot: value.appSupport,
            bundleHash: imported.bundleHash,
        });
        expect(resolved).toMatchObject({ valid: true, bundleHash: imported.bundleHash });
        expect(JSON.parse(await readFile(resolved.files.cohort, 'utf8'))).toMatchObject({ role: 'cohort' });
    });

    it('缺檔或內容遭竄改時 fail closed', async () => {
        const value = await fixture();
        const imported = await importIntradayMonitorRuntimeArtifactBundle({
            appSupportRoot: value.appSupport,
            repoDirectory: value.repo,
            sourceIdentity: 'openspec-change:example',
            artifacts: value.artifacts,
        });
        await writeFile(imported.files.plan, '{"tampered":true}\n');
        await expect(resolveIntradayMonitorRuntimeArtifactBundle({
            appSupportRoot: value.appSupport,
            bundleHash: imported.bundleHash,
        })).resolves.toMatchObject({ valid: false, reason: 'artifact_bundle_hash_mismatch', role: 'plan' });
    });

    it('拒絕 symlink source，不做 basename 或最近檔案 fallback', async () => {
        const value = await fixture();
        const link = path.join(value.active, 'linked.json');
        await symlink(value.sources.cohort, link);
        await expect(importIntradayMonitorRuntimeArtifactBundle({
            appSupportRoot: value.appSupport,
            repoDirectory: value.repo,
            sourceIdentity: 'openspec-change:example',
            artifacts: [{ role: 'cohort', path: link, schema: 'cohort/1', dependencies: [] }],
        })).rejects.toThrow('runtime_artifact_source_invalid');
    });

    it('匯入時拒絕宣告 schema 與檔案 schemaVersion 不一致', async () => {
        const value = await fixture();
        await expect(importIntradayMonitorRuntimeArtifactBundle({
            appSupportRoot: value.appSupport,
            repoDirectory: value.repo,
            sourceIdentity: 'openspec-change:example',
            artifacts: [{ role: 'cohort', path: value.sources.cohort,
                schema: 'cohort/2', dependencies: [] }],
        })).rejects.toThrow('runtime_artifact_schema_invalid');
    });

    it('publish 前中斷不會留下可解析的半成品 bundle', async () => {
        const value = await fixture();
        let hash;
        await expect(importIntradayMonitorRuntimeArtifactBundle({
            appSupportRoot: value.appSupport,
            repoDirectory: value.repo,
            sourceIdentity: 'openspec-change:example',
            artifacts: value.artifacts,
            beforePublish: ({ bundleHash }) => { hash = bundleHash; throw new Error('simulated_interrupt'); },
        })).rejects.toThrow('simulated_interrupt');
        await expect(resolveIntradayMonitorRuntimeArtifactBundle({
            appSupportRoot: value.appSupport,
            bundleHash: hash,
        })).resolves.toMatchObject({ valid: false, reason: 'artifact_bundle_missing' });
    });
});
