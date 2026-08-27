import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
    computeTask134AcceptanceManifestSha256,
    DEFAULT_TASK_13_4_MANIFEST_PATH,
    DEFAULT_TASK_13_4_REPO_ROOT,
    validateTask134AcceptanceManifest,
} from './task-13-4-feature-acceptance-validator.mjs';

async function loadManifest() {
    return JSON.parse(
        await readFile(DEFAULT_TASK_13_4_MANIFEST_PATH, 'utf8'),
    );
}

function rehash(manifest) {
    manifest.manifestSha256 =
        computeTask134AcceptanceManifestSha256(manifest);
    return manifest;
}

async function validate(manifest) {
    return validateTask134AcceptanceManifest({
        manifest,
        repoRoot: DEFAULT_TASK_13_4_REPO_ROOT,
    });
}

test('current Task 13.4 acceptance binds all seven production paths and remains fail closed', async () => {
    const result = await validate(await loadManifest());
    assert.equal(result.valid, true, result.errors?.join('\n'));
    assert.deepEqual(result.summary, {
        strategyCount: 7,
        domainAcceptancePassedCount: 7,
        adapterAcceptancePassedCount: 7,
        productionWiringConnectedCount: 7,
        enabledFeatureGateCount: 0,
        boundedQuoteSimulationE2ECompleteCount: 0,
        confirmedFillClaimCount: 0,
    });
});
test('manifest tampering is rejected by the canonical self hash', async () => {
    const manifest = await loadManifest();
    manifest.strategies[0].productionWiring = 'not_connected';
    const result = await validate(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('manifest_hash_mismatch'));
    assert.ok(result.errors.includes('strategy_entry_invalid'));
});

test('enabled gates, fabricated E2E, and claimed fills cannot pass offline acceptance', async () => {
    const enabled = await loadManifest();
    enabled.strategies[0].featureGateState = 'enabled';
    const enabledResult = await validate(rehash(enabled));
    assert.equal(enabledResult.valid, false);
    assert.ok(enabledResult.errors.includes('strategy_entry_invalid'));

    const fabricated = await loadManifest();
    fabricated.strategies[1].boundedQuoteSimulationE2E = 'passed';
    fabricated.strategies[1].confirmedFillClaimed = true;
    const fabricatedResult = await validate(rehash(fabricated));
    assert.equal(fabricatedResult.valid, false);
    assert.ok(fabricatedResult.errors.includes('strategy_entry_invalid'));
});

test('scheduled quantity acceptance only passes as a connected fail-closed policy', async () => {
    const manifest = await loadManifest();
    const scheduled = manifest.strategies.find(
        (strategy) => strategy.id === 'scheduled_quantity',
    );
    scheduled.adapterAcceptance = 'passed';
    scheduled.productionWiring = 'connected';
    scheduled.blockers = scheduled.blockers.filter(
        (blocker) => blocker !== 'scheduled_quantity_algorithm_unverified',
    );
    const result = await validate(rehash(manifest));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('strategy_entry_invalid'));
});

test('missing, duplicate, and unknown strategy entries are rejected', async () => {
    const missing = await loadManifest();
    missing.strategies.pop();
    const missingResult = await validate(rehash(missing));
    assert.equal(missingResult.valid, false);
    assert.ok(missingResult.errors.includes('strategy_catalog_not_exact'));

    const duplicate = await loadManifest();
    duplicate.strategies[6] = structuredClone(duplicate.strategies[0]);
    const duplicateResult = await validate(rehash(duplicate));
    assert.equal(duplicateResult.valid, false);
    assert.ok(duplicateResult.errors.includes('strategy_entry_invalid'));
    assert.ok(duplicateResult.errors.includes('strategy_catalog_not_exact'));
});

test('source drift fails currentness even when the manifest itself is unchanged', async () => {
    const manifest = await loadManifest();
    const fixtureRoot = await mkdtemp(
        path.join(tmpdir(), 'task-13-4-source-drift-'),
    );
    try {
        for (const source of manifest.sources) {
            const target = path.join(fixtureRoot, source.path);
            await mkdir(path.dirname(target), { recursive: true });
            const current = await readFile(
                path.join(DEFAULT_TASK_13_4_REPO_ROOT, source.path),
            );
            await writeFile(
                target,
                source.id === 'controller_runtime'
                    ? Buffer.concat([current, Buffer.from('\n// drift\n')])
                    : current,
            );
        }
        const result = await validateTask134AcceptanceManifest({
            manifest,
            repoRoot: fixtureRoot,
        });
        assert.equal(result.valid, false);
        assert.ok(
            result.errors.includes('source_hash_mismatch:controller_runtime'),
        );
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});

test('broker authority and secret-bearing mutations remain fail closed', async () => {
    const authority = await loadManifest();
    authority.scope.brokerWriteAuthority = true;
    const authorityResult = await validate(rehash(authority));
    assert.equal(authorityResult.valid, false);
    assert.ok(authorityResult.errors.includes('scope_not_offline_fail_closed'));

    const secret = await loadManifest();
    secret.strategies[0].blockers = [
        'token=not-a-real-secret-canary',
        'write_unlock_gates_incomplete',
    ];
    const secretResult = await validate(rehash(secret));
    assert.equal(secretResult.valid, false);
    assert.ok(secretResult.errors.includes('sensitive_value_present'));
});
