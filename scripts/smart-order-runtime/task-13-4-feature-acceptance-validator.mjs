import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson } from './canonical-json.mjs';
import {
    SMART_ORDER_CANONICAL_DRAFT_KINDS,
} from './canonical-strategy-draft.mjs';
import { SMART_ORDER_FEATURE_GATE_IDS } from './gate-manifest.mjs';

export const TASK_13_4_ACCEPTANCE_SCHEMA =
    'smart-order-task-13-4-feature-acceptance/2026-08-23.1';
export const TASK_13_4_CHANGE_ID =
    'add-durable-smart-order-panel-and-protective-exits';
export const TASK_13_4_MANIFEST_ID =
    'smart-order-task-13-4/offline/2026-08-23.1';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TASK_13_4_REPO_ROOT = path.resolve(
    SCRIPT_DIRECTORY,
    '../..',
);
export const DEFAULT_TASK_13_4_MANIFEST_PATH = path.join(
    DEFAULT_TASK_13_4_REPO_ROOT,
    'openspec',
    'changes',
    TASK_13_4_CHANGE_ID,
    'task-13-4-feature-acceptance.json',
);

export const TASK_13_4_STRATEGY_IDS = Object.freeze([
    'quick',
    'good_till',
    'multi_condition',
    'parent_child',
    'stop_take',
    'trailing_exit',
    'scheduled_quantity',
]);

const SOURCE_DEFINITIONS = Object.freeze({
    canonical_domain: Object.freeze({
        path: 'scripts/smart-order-runtime/canonical-strategy-draft.mjs',
        sha256: 'sha256:ce49257f41d9cefb01e565e926a374659d4eadbff33e3c8c01dbdcd6cddd2fb9',
    }),
    canonical_fixtures: Object.freeze({
        path: 'scripts/smart-order-runtime/canonical-strategy-draft-fixtures.mjs',
        sha256: 'sha256:c4ea939eaf449318d4dec729da637e4f47cabc7058bf061cc6af6bfec5a88d68',
    }),
    feature_gate: Object.freeze({
        path: 'scripts/smart-order-runtime/gate-manifest.mjs',
        sha256: 'sha256:f3be77805ad388ea00e592d02155951f9a9df7abffe0d97f9bedccfec546fb7f',
    }),
    repository_runtime: Object.freeze({
        path: 'scripts/smart-order-runtime/repository-worker.mjs',
        sha256: 'sha256:4ae21d002325e6a4688456be1352b1f3b906a03ac24a6fd4b02578db453c20cb',
    }),
    controller_runtime: Object.freeze({
        path: 'scripts/smart-order-runtime/runtime-controller.mjs',
        sha256: 'sha256:7f868f0f3b6d96cac5a25a3e0196ce3e09d87bcfb71e8b221222863ab29325bb',
    }),
    broker_adapter: Object.freeze({
        path: 'scripts/smart-order-runtime/node-safe-broker-adapter.mjs',
        sha256: 'sha256:62027d41384f01346859bc366159f2c042dd239dfe06d48ad9fe37af664d10fd',
    }),
    canonical_domain_tests: Object.freeze({
        path: 'scripts/smart-order-runtime/canonical-strategy-draft.test.mjs',
        sha256: 'sha256:054c5d480e2574c0d3fc3143671da8fd13fef6261d86dc939524caedd690034e',
    }),
    repository_integration_tests: Object.freeze({
        path: 'scripts/smart-order-runtime/repository.test.mjs',
        sha256: 'sha256:817c2d1d9389af6026c5ef6fe3a6feff6a908dcb439e30847d808472c000917c',
    }),
    controller_integration_tests: Object.freeze({
        path: 'scripts/smart-order-runtime/runtime-controller.test.mjs',
        sha256: 'sha256:c6e17d129d1723cc6ad120dc1ac18d7709e151c7b9ceadca59bc858e8fa322d8',
    }),
    broker_adapter_tests: Object.freeze({
        path: 'scripts/smart-order-runtime/node-safe-broker-adapter.test.mjs',
        sha256: 'sha256:8a7845650211d2a90867da9b0fe1b51ebfddee767ffe3d4597c191fedc765bda',
    }),
    gateway_integration_tests: Object.freeze({
        path: 'scripts/smart-order-runtime/vite-same-origin-gateway.test.mjs',
        sha256: 'sha256:7b1dba9af9724392a12ca506e2fcda3d810ae5f057a685326a5ba1e79486721e',
    }),
    dispatch_integration_tests: Object.freeze({
        path: 'scripts/smart-order-runtime/broker-dispatch-coordinator.test.mjs',
        sha256: 'sha256:9a436d05f2c0135527a83755b9bdff371c70314c079bd18f74dcdc751a138fbd',
    }),
});

const COMMON_SOURCE_IDS = Object.freeze(Object.keys(SOURCE_DEFINITIONS));
const COMMON_BLOCKERS = Object.freeze([
    'bounded_quote_simulation_e2e_pending_market_reproducibility',
    'write_unlock_gates_incomplete',
]);
const SCHEDULED_BLOCKERS = Object.freeze([
    ...COMMON_BLOCKERS,
    'scheduled_quantity_algorithm_unverified',
]);

const EXPECTED_SCOPE = Object.freeze({
    assessmentMode: 'offline',
    brokerNetworkAccessed: false,
    brokerWriteAuthority: false,
    productionAuthorized: false,
    caAuthorized: false,
    realOrderAuthorized: false,
    containsSecrets: false,
    containsAccountIdentifiers: false,
});

const TOP_LEVEL_KEYS = Object.freeze([
    'schemaVersion',
    'manifestId',
    'manifestSha256',
    'changeId',
    'scope',
    'sources',
    'strategies',
    'summary',
]);

function exactKeys(value, keys) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        JSON.stringify(Object.keys(value).sort()) ===
            JSON.stringify([...keys].sort())
    );
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function computeTask134AcceptanceManifestSha256(manifest) {
    const { manifestSha256: _ignored, ...content } = manifest;
    return sha256(canonicalJson(content));
}

async function resolveCanonicalFileInsideRepo(repoRoot, relativePath) {
    if (
        typeof relativePath !== 'string' ||
        relativePath.length === 0 ||
        relativePath.length > 300 ||
        path.isAbsolute(relativePath) ||
        relativePath.split('/').includes('..') ||
        /[\u0000-\u001f\u007f]/.test(relativePath)
    ) {
        throw new TypeError('unsafe relative path');
    }
    const canonicalRepoRoot = await realpath(repoRoot);
    const absolute = path.resolve(canonicalRepoRoot, relativePath);
    const relative = path.relative(canonicalRepoRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new TypeError('path escaped repository');
    }
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new TypeError('source must be a regular non-symlink file');
    }
    const physical = await realpath(absolute);
    if (physical !== absolute) {
        throw new TypeError('source physical path is not canonical');
    }
    return physical;
}

function hasSensitiveValue(value) {
    const text = JSON.stringify(value);
    return (
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
        /\b(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/i.test(
            text,
        ) ||
        /\b(?:account|acct|broker)(?:[_-]?(?:id|no|number))\s*[:=/#-]+\s*[A-Za-z0-9]{6,}\b/i.test(
            text,
        )
    );
}

function expectedStrategy(id) {
    const scheduled = id === 'scheduled_quantity';
    return {
        id,
        domainAcceptance: 'passed',
        adapterAcceptance: scheduled ? 'fail_closed_passed' : 'passed',
        productionWiring: scheduled ? 'connected_fail_closed' : 'connected',
        featureGateState: 'disabled',
        boundedQuoteSimulationE2E:
            'pending_market_reproducibility',
        confirmedFillClaimed: false,
        sourceIds: COMMON_SOURCE_IDS,
        blockers: scheduled ? SCHEDULED_BLOCKERS : COMMON_BLOCKERS,
    };
}

export async function validateTask134AcceptanceManifest({
    manifest,
    repoRoot = DEFAULT_TASK_13_4_REPO_ROOT,
}) {
    const errors = [];
    if (!exactKeys(manifest, TOP_LEVEL_KEYS)) {
        return Object.freeze({
            valid: false,
            errors: Object.freeze(['manifest_schema_invalid']),
        });
    }
    if (manifest.schemaVersion !== TASK_13_4_ACCEPTANCE_SCHEMA) {
        errors.push('schema_version_invalid');
    }
    if (manifest.manifestId !== TASK_13_4_MANIFEST_ID) {
        errors.push('manifest_id_invalid');
    }
    if (manifest.changeId !== TASK_13_4_CHANGE_ID) {
        errors.push('change_id_invalid');
    }
    if (
        manifest.manifestSha256 !==
        computeTask134AcceptanceManifestSha256(manifest)
    ) {
        errors.push('manifest_hash_mismatch');
    }
    if (
        !exactKeys(manifest.scope, Object.keys(EXPECTED_SCOPE)) ||
        canonicalJson(manifest.scope) !== canonicalJson(EXPECTED_SCOPE)
    ) {
        errors.push('scope_not_offline_fail_closed');
    }
    if (hasSensitiveValue(manifest)) {
        errors.push('sensitive_value_present');
    }

    const sourceMap = new Map();
    if (!Array.isArray(manifest.sources)) {
        errors.push('sources_not_array');
    } else {
        for (const source of manifest.sources) {
            const expected = SOURCE_DEFINITIONS[source?.id];
            if (
                !exactKeys(source, ['id', 'path', 'sha256']) ||
                !expected ||
                sourceMap.has(source.id) ||
                source.path !== expected.path ||
                source.sha256 !== expected.sha256
            ) {
                errors.push('source_entry_invalid');
                continue;
            }
            sourceMap.set(source.id, source);
            try {
                const absolute = await resolveCanonicalFileInsideRepo(
                    repoRoot,
                    source.path,
                );
                const content = await readFile(absolute);
                if (sha256(content) !== source.sha256) {
                    errors.push(`source_hash_mismatch:${source.id}`);
                }
            } catch {
                errors.push(`source_unreadable:${source.id}`);
            }
        }
    }
    if (
        sourceMap.size !== COMMON_SOURCE_IDS.length ||
        COMMON_SOURCE_IDS.some((id) => !sourceMap.has(id))
    ) {
        errors.push('source_catalog_not_exact');
    }

    const runtimeKinds = [...SMART_ORDER_CANONICAL_DRAFT_KINDS];
    const gateKinds = [...SMART_ORDER_FEATURE_GATE_IDS];
    if (
        canonicalJson([...runtimeKinds].sort()) !==
            canonicalJson([...TASK_13_4_STRATEGY_IDS].sort()) ||
        canonicalJson([...gateKinds].sort()) !==
            canonicalJson([...TASK_13_4_STRATEGY_IDS].sort())
    ) {
        errors.push('production_strategy_catalog_drift');
    }
    const strategyMap = new Map();
    if (!Array.isArray(manifest.strategies)) {
        errors.push('strategies_not_array');
    } else {
        for (const strategy of manifest.strategies) {
            const expected = expectedStrategy(strategy?.id);
            if (
                !TASK_13_4_STRATEGY_IDS.includes(strategy?.id) ||
                strategyMap.has(strategy.id) ||
                !exactKeys(strategy, Object.keys(expected)) ||
                canonicalJson(strategy) !== canonicalJson(expected)
            ) {
                errors.push('strategy_entry_invalid');
                continue;
            }
            strategyMap.set(strategy.id, strategy);
        }
    }
    if (
        strategyMap.size !== TASK_13_4_STRATEGY_IDS.length ||
        TASK_13_4_STRATEGY_IDS.some((id) => !strategyMap.has(id))
    ) {
        errors.push('strategy_catalog_not_exact');
    }

    const expectedSummary = {
        strategyCount: 7,
        domainAcceptancePassedCount: 7,
        adapterAcceptancePassedCount: 7,
        productionWiringConnectedCount: 7,
        enabledFeatureGateCount: 0,
        boundedQuoteSimulationE2ECompleteCount: 0,
        confirmedFillClaimCount: 0,
    };
    if (
        !exactKeys(manifest.summary, Object.keys(expectedSummary)) ||
        canonicalJson(manifest.summary) !== canonicalJson(expectedSummary)
    ) {
        errors.push('summary_projection_invalid');
    }

    return Object.freeze({
        valid: errors.length === 0,
        errors: Object.freeze([...new Set(errors)].sort()),
        summary: Object.freeze(expectedSummary),
    });
}

export async function readAndValidateTask134AcceptanceManifest({
    manifestPath = DEFAULT_TASK_13_4_MANIFEST_PATH,
    repoRoot = DEFAULT_TASK_13_4_REPO_ROOT,
} = {}) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    return validateTask134AcceptanceManifest({ manifest, repoRoot });
}

async function main() {
    const manifestPath = process.argv[2]
        ? path.resolve(process.argv[2])
        : DEFAULT_TASK_13_4_MANIFEST_PATH;
    const result = await readAndValidateTask134AcceptanceManifest({
        manifestPath,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    await main();
}
