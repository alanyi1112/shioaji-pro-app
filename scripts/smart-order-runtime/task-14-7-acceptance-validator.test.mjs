import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
    DEFAULT_TASK_14_7_MANIFEST_PATH,
    DEFAULT_TASK_14_7_REPO_ROOT,
    computeTask147AcceptanceManifestSha256,
    validateTask147AcceptanceManifest,
} from './task-14-7-acceptance-validator.mjs';

async function loadManifest() {
    return JSON.parse(
        await readFile(DEFAULT_TASK_14_7_MANIFEST_PATH, 'utf8'),
    );
}

function clone(value) {
    return structuredClone(value);
}

function rehash(manifest) {
    manifest.manifestSha256 =
        computeTask147AcceptanceManifestSha256(manifest);
    return manifest;
}

async function validate(manifest) {
    return validateTask147AcceptanceManifest({
        manifest,
        repoRoot: DEFAULT_TASK_14_7_REPO_ROOT,
    });
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function validateWithMutatedMatrix(manifest, mutate) {
    const fixtureRoot = await mkdtemp(
        path.join(tmpdir(), 'task-14-7-acceptance-'),
    );
    try {
        for (const source of manifest.sources) {
            const target = path.join(fixtureRoot, source.path);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(
                target,
                await readFile(
                    path.join(DEFAULT_TASK_14_7_REPO_ROOT, source.path),
                ),
            );
        }
        const matrixPath = path.join(
            fixtureRoot,
            manifest.companionMatrix.path,
        );
        await mkdir(path.dirname(matrixPath), { recursive: true });
        const currentMatrix = await readFile(
            path.join(
                DEFAULT_TASK_14_7_REPO_ROOT,
                manifest.companionMatrix.path,
            ),
            'utf8',
        );
        const mutatedMatrix = mutate(currentMatrix);
        await writeFile(matrixPath, mutatedMatrix);
        manifest.companionMatrix.sha256 = sha256(mutatedMatrix);
        return await validateTask147AcceptanceManifest({
            manifest: rehash(manifest),
            repoRoot: fixtureRoot,
        });
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
}

async function validateWithMutatedSource(manifest, sourceId, mutate) {
    const fixtureRoot = await mkdtemp(
        path.join(tmpdir(), 'task-14-7-source-'),
    );
    try {
        for (const source of manifest.sources) {
            const target = path.join(fixtureRoot, source.path);
            await mkdir(path.dirname(target), { recursive: true });
            const original = await readFile(
                path.join(DEFAULT_TASK_14_7_REPO_ROOT, source.path),
                'utf8',
            );
            const content = source.id === sourceId ? mutate(original) : original;
            await writeFile(target, content);
            if (source.id === sourceId) source.sha256 = sha256(content);
        }
        const matrixPath = path.join(
            fixtureRoot,
            manifest.companionMatrix.path,
        );
        await mkdir(path.dirname(matrixPath), { recursive: true });
        await writeFile(
            matrixPath,
            await readFile(
                path.join(
                    DEFAULT_TASK_14_7_REPO_ROOT,
                    manifest.companionMatrix.path,
                ),
            ),
        );
        return await validateTask147AcceptanceManifest({
            manifest: rehash(manifest),
            repoRoot: fixtureRoot,
        });
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
}

test('current offline acceptance manifest covers every requirement and remains fail closed', async () => {
    const result = await validate(await loadManifest());
    assert.equal(result.valid, true, result.errors?.join('\n'));
    assert.deepEqual(result.summary, {
        requirementCount: 67,
        normalScenarioCount: 67,
        failureScenarioCount: 67,
        raceScenarioCount: 67,
        currentEligibleSimulationEvidenceCount: 0,
        enabledFeatureGateCount: 0,
        manualRouteCoverageComplete: true,
    });
});

test('manifest content tampering is detected by its canonical self hash', async () => {
    const manifest = clone(await loadManifest());
    manifest.requirements[0].title = '遭竄改的 Requirement';
    const result = await validate(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('manifest_hash_mismatch'));
});

test('source digest drift fails currentness even if the manifest is rehashed', async () => {
    const manifest = clone(await loadManifest());
    manifest.sources[0].sha256 = `sha256:${'0'.repeat(64)}`;
    const result = await validate(rehash(manifest));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('source_hash_mismatch:SPEC-DURABLE'));
});

test('companion matrix digest drift fails currentness', async () => {
    const manifest = clone(await loadManifest());
    manifest.companionMatrix.sha256 = `sha256:${'1'.repeat(64)}`;
    const result = await validate(rehash(manifest));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('companion_matrix_hash_mismatch'));
});

test('a missing requirement or scenario reference cannot pass coverage', async () => {
    const missingRequirement = clone(await loadManifest());
    missingRequirement.requirements.pop();
    missingRequirement.summary.requirementCount -= 1;
    missingRequirement.summary.normalScenarioCount -= 1;
    missingRequirement.summary.failureScenarioCount -= 1;
    missingRequirement.summary.raceScenarioCount -= 1;
    const missingResult = await validate(rehash(missingRequirement));
    assert.equal(missingResult.valid, false);
    assert.ok(missingResult.errors.includes('requirement_missing:SOP-018'));

    const unknownScenario = clone(await loadManifest());
    unknownScenario.requirements[0].scenarios.race.sourceScenario =
        '不存在的競態 Scenario';
    const scenarioResult = await validate(rehash(unknownScenario));
    assert.equal(scenarioResult.valid, false);
    assert.ok(
        scenarioResult.errors.includes(
            'requirement_race_scenario_invalid:DSR-001',
        ),
    );
});

test('feature gates cannot be enabled while evidence and route coverage are missing', async () => {
    const manifest = clone(await loadManifest());
    manifest.featureGates.find((gate) => gate.id === 'trailing_exit').state =
        'enabled';
    const result = await validate(rehash(manifest));
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('feature_gate_entry_invalid'));
    assert.ok(result.errors.includes('feature_gate_not_disabled:trailing_exit'));
});

test('fabricated live simulation evidence is rejected instead of unlocking the snapshot', async () => {
    const manifest = clone(await loadManifest());
    manifest.simulationEvidence[0] = {
        id: 'SIM-CURRENT-NONE',
        evidenceClass: 'live_simulation',
        eligibility: 'eligible',
        sha256: `sha256:${'2'.repeat(64)}`,
        reason: 'caller_claimed_eligible',
    };
    const result = await validate(rehash(manifest));
    assert.equal(result.valid, false);
    assert.ok(
        result.errors.includes('live_simulation_evidence_must_remain_absent'),
    );
});

test('manual coverage cannot drift from its current completed source projection', async () => {
    const manifest = clone(await loadManifest());
    manifest.manualRouteCoverage.coverageComplete = false;
    manifest.manualRouteCoverage.automationAccountEligibility = 'enabled';
    const result = await validate(rehash(manifest));
    assert.equal(result.valid, false);
    assert.ok(
        result.errors.includes(
            'manual_coverage_projection_mismatch:coverageComplete',
        ),
    );
});

test('broker authority, production, CA and secret-bearing data always fail closed', async () => {
    const authority = clone(await loadManifest());
    authority.scope.brokerWriteAuthority = true;
    authority.scope.productionAuthorized = true;
    authority.scope.caAuthorized = true;
    authority.scope.realOrderAuthorized = true;
    const authorityResult = await validate(rehash(authority));
    assert.equal(authorityResult.valid, false);
    assert.ok(
        authorityResult.errors.includes(
            'scope_safety_flag_not_false:brokerWriteAuthority',
        ),
    );

    const secret = clone(await loadManifest());
    secret.simulationEvidence[0].reason =
        '-----BEGIN PRIVATE KEY-----not-real-test-canary';
    const secretResult = await validate(rehash(secret));
    assert.equal(secretResult.valid, false);
    assert.ok(secretResult.errors.includes('sensitive_value_present'));
});

test('self-rehashed account references and authorization material still fail closed', async () => {
    const accountReference = clone(await loadManifest());
    accountReference.manifestId =
        'smart-order-task-14-7/offline/account-1234567890';
    const accountResult = await validate(rehash(accountReference));
    assert.equal(accountResult.valid, false);
    assert.ok(accountResult.errors.includes('manifest_id_invalid'));
    assert.ok(accountResult.errors.includes('sensitive_value_present'));

    const bearer = clone(await loadManifest());
    bearer.scenarioRoleDefinitions.failure =
        'Bearer super-secret-credential-for-adversarial-test';
    const bearerResult = await validate(rehash(bearer));
    assert.equal(bearerResult.valid, false);
    assert.ok(
        bearerResult.errors.includes('scenario_role_definitions_invalid'),
    );
    assert.ok(bearerResult.errors.includes('sensitive_value_present'));

    const forbiddenField = clone(await loadManifest());
    forbiddenField.requirements[0].accountId = 'opaque-reference';
    const forbiddenFieldResult = await validate(rehash(forbiddenField));
    assert.equal(forbiddenFieldResult.valid, false);
    assert.ok(forbiddenFieldResult.errors.includes('sensitive_field_present'));

    const commonCredential = clone(await loadManifest());
    commonCredential.scenarioRoleDefinitions.race =
        'AWS_SECRET_ACCESS_KEY=not-a-real-secret-canary';
    const commonCredentialResult = await validate(rehash(commonCredential));
    assert.equal(commonCredentialResult.valid, false);
    assert.ok(
        commonCredentialResult.errors.includes('sensitive_value_present'),
    );
});

test('source and matrix authority paths are canonical even after self rehash', async () => {
    const sourcePath = clone(await loadManifest());
    sourcePath.sources.find((source) => source.id === 'SPEC-DURABLE').path =
        'openspec/changes/add-durable-smart-order-panel-and-protective-exits/specs/durable-smart-order-runtime/./spec.md';
    const sourcePathResult = await validate(rehash(sourcePath));
    assert.equal(sourcePathResult.valid, false);
    assert.ok(
        sourcePathResult.errors.includes(
            'source_path_mismatch:SPEC-DURABLE',
        ),
    );

    const matrixPath = clone(await loadManifest());
    matrixPath.companionMatrix.path =
        'openspec/changes/add-durable-smart-order-panel-and-protective-exits/./task-14-7-acceptance-matrix.md';
    const matrixPathResult = await validate(rehash(matrixPath));
    assert.equal(matrixPathResult.valid, false);
    assert.ok(
        matrixPathResult.errors.includes('companion_matrix_path_mismatch'),
    );
});

test('requirement feature gates and projected matrix cells cannot be semantically swapped', async () => {
    const wrongGate = clone(await loadManifest());
    wrongGate.requirements.find(
        (requirement) => requirement.id === 'SOP-011',
    ).featureGateIds = ['runtime_core', 'quick'];
    const wrongGateResult = await validate(rehash(wrongGate));
    assert.equal(wrongGateResult.valid, false);
    assert.ok(
        wrongGateResult.errors.includes(
            'requirement_feature_gate_binding_invalid:SOP-011',
        ),
    );

    const wrongMatrixCell = clone(await loadManifest());
    const matrixResult = await validateWithMutatedMatrix(
        wrongMatrixCell,
        (matrix) =>
            matrix
                .split('\n')
                .map((line) =>
                    line.startsWith('| `SOP-011` |')
                        ? line.replace('`trailing_exit`', '`quick`')
                        : line,
                )
                .join('\n'),
    );
    assert.equal(matrixResult.valid, false);
    assert.ok(
        matrixResult.errors.includes('matrix_requirement_row_invalid:SOP-011'),
    );


    const extraMatrixRow = clone(await loadManifest());
    const extraRowResult = await validateWithMutatedMatrix(
        extraMatrixRow,
        (matrix) =>
            `${matrix}| \`SOP-011\` | 誤導列 | \`SOP-011-N\` | \`SOP-011-F\` | \`SOP-011-R\` | \`SIM-CURRENT-NONE\`／hash=null | \`MRC-2026-08-11.1\`／incomplete | \`runtime_core\`＋\`quick\`／disabled |\n`,
    );
    assert.equal(extraRowResult.valid, false);
    assert.ok(
        extraRowResult.errors.includes('matrix_requirement_catalog_invalid'),
    );
});

test('normal failure and race roles bind exact scenario variants and outcomes', async () => {
    const borrowedRole = clone(await loadManifest());
    const requirement = borrowedRole.requirements.find(
        (entry) => entry.id === 'DSR-002',
    );
    requirement.scenarios.race.sourceScenario =
        requirement.scenarios.normal.sourceScenario;
    const borrowedRoleResult = await validate(rehash(borrowedRole));
    assert.equal(borrowedRoleResult.valid, false);
    assert.ok(
        borrowedRoleResult.errors.includes(
            'requirement_race_scenario_invalid:DSR-002',
        ),
    );

    const wrongInjection = clone(await loadManifest());
    wrongInjection.requirements.find(
        (entry) => entry.id === 'PET-011',
    ).scenarios.failure.injection = 'none';
    const wrongInjectionResult = await validate(rehash(wrongInjection));
    assert.equal(wrongInjectionResult.valid, false);
    assert.ok(
        wrongInjectionResult.errors.includes(
            'requirement_failure_scenario_invalid:PET-011',
        ),
    );
});

test('self-rehashed companion artifacts cannot append secrets or contradictory authority', async () => {
    const bearerManifest = clone(await loadManifest());
    const bearer = await validateWithMutatedMatrix(
        bearerManifest,
        (matrix) => `${matrix}\nAuthorization: Bearer adversarial-canary-value\n`,
    );
    assert.equal(bearer.valid, false);
    assert.ok(
        bearer.errors.includes('companion_matrix_expected_hash_mismatch') ||
            bearer.errors.includes('companion_matrix_sensitive_value_present'),
    );

    const authorityManifest = clone(await loadManifest());
    const authority = await validateWithMutatedMatrix(
        authorityManifest,
        (matrix) => `${matrix}\nBroker write authority: enabled\n`,
    );
    assert.equal(authority.valid, false);
    assert.ok(
        authority.errors.includes('companion_matrix_expected_hash_mismatch') ||
            authority.errors.includes(
                'companion_matrix_unsafe_authority_assertion',
            ),
    );
});

test('manual route coverage requires one canonical projection and rejects appended promotion', async () => {
    const manifest = clone(await loadManifest());
    const result = await validateWithMutatedSource(
        manifest,
        'MANUAL-ROUTE-COVERAGE',
        (source) =>
            `${source}\n\n\`\`\`json\n${JSON.stringify({
                schema: 'realtimestock.manual-stock-write-route-coverage/v1',
                version: 'forged',
                coverageComplete: true,
                manualEquivalencePassed: true,
                serverDerivedProvenancePassed: true,
                automationAccountEligibility: 'enabled',
            })}\n\`\`\`\n`,
    );
    assert.equal(result.valid, false);
    assert.ok(
        result.errors.includes(
            'source_expected_hash_mismatch:MANUAL-ROUTE-COVERAGE',
        ) ||
            result.errors.includes('manual_coverage_projection_not_unique') ||
            result.errors.includes(
                'source_unsafe_authority_assertion:MANUAL-ROUTE-COVERAGE',
            ),
    );
});

test('Task 14.7 revalidates the bound Task 13.4 feature acceptance instead of trusting its outer digest', async () => {
    const manifest = clone(await loadManifest());
    const result = await validateWithMutatedSource(
        manifest,
        'TASK-13-4-ACCEPTANCE',
        (source) =>
            source.replace(
                '"featureGateState": "disabled"',
                '"featureGateState": "enabled"',
            ),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('task_13_4_acceptance_invalid'));
    assert.ok(
        result.errors.includes('task_13_4:manifest_hash_mismatch') ||
            result.errors.includes('task_13_4:strategy_entry_invalid'),
    );
});

test('canonical source and matrix paths reject symlinks even when content matches', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'task-14-7-symlink-'));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'task-14-7-outside-'));
    try {
        const manifest = clone(await loadManifest());
        for (const source of manifest.sources) {
            const target = path.join(fixtureRoot, source.path);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(
                target,
                await readFile(
                    path.join(DEFAULT_TASK_14_7_REPO_ROOT, source.path),
                ),
            );
        }
        const matrixPath = path.join(
            fixtureRoot,
            manifest.companionMatrix.path,
        );
        await mkdir(path.dirname(matrixPath), { recursive: true });
        const outsideMatrix = path.join(outsideRoot, 'matrix.md');
        await writeFile(
            outsideMatrix,
            await readFile(
                path.join(
                    DEFAULT_TASK_14_7_REPO_ROOT,
                    manifest.companionMatrix.path,
                ),
            ),
        );
        try {
            await rm(matrixPath);
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        await symlink(outsideMatrix, matrixPath);
        assert.equal((await lstat(matrixPath)).isSymbolicLink(), true);
        const result = await validateTask147AcceptanceManifest({
            manifest,
            repoRoot: fixtureRoot,
        });
        assert.equal(result.valid, false);
        assert.ok(result.errors.includes('companion_matrix_unreadable'));
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
        await rm(outsideRoot, { recursive: true, force: true });
    }
});
