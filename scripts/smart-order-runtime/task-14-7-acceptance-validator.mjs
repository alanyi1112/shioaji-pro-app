import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateTask134AcceptanceManifest } from './task-13-4-feature-acceptance-validator.mjs';

export const TASK_14_7_ACCEPTANCE_SCHEMA =
    'smart-order-task-14-7-acceptance-manifest/2026-08-12.1';

export const TASK_14_7_CHANGE_ID =
    'add-durable-smart-order-panel-and-protective-exits';

export const TASK_14_7_MANIFEST_ID =
    'smart-order-task-14-7/offline/2026-08-12.1';

const CHANGE_ROOT_RELATIVE =
    `openspec/changes/${TASK_14_7_CHANGE_ID}`;
const COMPANION_MATRIX_PATH =
    `${CHANGE_ROOT_RELATIVE}/task-14-7-acceptance-matrix.md`;
const COMPANION_MATRIX_SHA256 =
    'sha256:a47967b9f316a91dbb4b58da1d0db9b8126c20cd5ffe2242a6ac5c3f0cf62c90';

export const TASK_14_7_FEATURE_GATE_IDS = Object.freeze([
    'runtime_core',
    'protective_exit',
    'quick',
    'good_till',
    'multi_condition',
    'parent_child',
    'stop_take',
    'trailing_exit',
    'scheduled_quantity',
]);

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TASK_14_7_REPO_ROOT = path.resolve(
    SCRIPT_DIRECTORY,
    '../..',
);
export const DEFAULT_TASK_14_7_MANIFEST_PATH = path.join(
    DEFAULT_TASK_14_7_REPO_ROOT,
    'openspec',
    'changes',
    TASK_14_7_CHANGE_ID,
    'task-14-7-acceptance-manifest.json',
);

const SOURCE_DEFINITIONS = Object.freeze({
    'SPEC-DURABLE': Object.freeze({
        prefix: 'DSR',
        kind: 'spec',
        path: `${CHANGE_ROOT_RELATIVE}/specs/durable-smart-order-runtime/spec.md`,
        sha256: 'sha256:c3f62ca3751ff684ac1e8fa35adac62e8abdcb7015975c38c686a41277999ae6',
    }),
    'SPEC-PROTECTIVE': Object.freeze({
        prefix: 'PET',
        kind: 'spec',
        path: `${CHANGE_ROOT_RELATIVE}/specs/protective-exit-order-ticket/spec.md`,
        sha256: 'sha256:eb3d60f5f5316355b7b4fe36a71a6ecb755e1d54b6024e9221b1bdeb2230429b',
    }),
    'SPEC-SAFE-RUNTIME': Object.freeze({
        prefix: 'SLR',
        kind: 'spec',
        path: `${CHANGE_ROOT_RELATIVE}/specs/safe-local-runtime-mode-switch/spec.md`,
        sha256: 'sha256:6e6a05f6fe95c062b6c2ae330de86acaddf303f629b187c3d49438a699ccc23c',
    }),
    'SPEC-SMART-PANEL': Object.freeze({
        prefix: 'SOP',
        kind: 'spec',
        path: `${CHANGE_ROOT_RELATIVE}/specs/smart-order-panel/spec.md`,
        sha256: 'sha256:832950c6cb3eb46dfbac2618557598d25b28167b586bd78a79fa25833df3a7c7',
    }),
    'MANUAL-ROUTE-COVERAGE': Object.freeze({
        kind: 'manual_coverage',
        path: `${CHANGE_ROOT_RELATIVE}/manual-stock-write-route-coverage.md`,
        sha256: 'sha256:2b567c0af7d403ae01cc7391836bbf5a01efe9bbbccc54874ca2ab1df254bd05',
    }),
    'OFFICIAL-DECISION-TABLES': Object.freeze({
        kind: 'decision_table',
        path: `${CHANGE_ROOT_RELATIVE}/official-smart-order-decision-tables.md`,
        sha256: 'sha256:11895dc2c423c41a82762f82ffa13f8c7d2263f23527667fef0f524c209e52fe',
    }),
    'TASK-13-4-ACCEPTANCE': Object.freeze({
        kind: 'feature_acceptance',
        path: `${CHANGE_ROOT_RELATIVE}/task-13-4-feature-acceptance.json`,
        sha256: 'sha256:509cd75bc0520d01fb4d33da223ac7ef551c1b14926b076ea05a876ef196200d',
    }),
});

const EXPECTED_SCOPE = Object.freeze({
    assessmentMode: 'offline',
    completionLevel: 'artifact_only',
    brokerNetworkAccessed: false,
    api8080Accessed: false,
    brokerWriteAuthority: false,
    productionAuthorized: false,
    caAuthorized: false,
    realOrderAuthorized: false,
    containsSecrets: false,
    containsAccountIdentifiers: false,
});

const EXPECTED_READINESS = Object.freeze({
    artifactApplyReady: true,
    writeUnlockReady: false,
    featureReleaseReady: false,
});

const EXPECTED_SCENARIO_ROLE_DEFINITIONS = Object.freeze({
    normal:
        '直接執行綁定的規範 Scenario，不額外注入故障；若 Scenario 本身是拒絕案例，正常結果就是依規範拒絕。',
    failure:
        '在綁定 Scenario 注入缺資料、stale、I/O、mode、broker 回應或前置條件失敗；未知結果必須 fail closed。',
    race:
        '在綁定 Scenario 加入同 revision 或同資源的並發與狀態漂移；不得產生第二個 authority、intent 或 side effect。',
});

const SCENARIO_VARIANTS = Object.freeze({
    normal: Object.freeze({
        suffix: 'N',
        injection: 'none',
        expectedOutcome:
            'source_scenario_contract_holds_without_broker_authority',
    }),
    failure: Object.freeze({
        suffix: 'F',
        injection:
            'required_input_or_dependency_fails_or_becomes_unavailable',
        expectedOutcome:
            'fail_closed_and_no_unverified_broker_side_effect',
    }),
    race: Object.freeze({
        suffix: 'R',
        injection:
            'concurrent_revision_or_authoritative_state_changes_before_completion',
        expectedOutcome:
            'single_linearized_authority_and_no_duplicate_side_effect',
    }),
});

const TOP_LEVEL_KEYS = Object.freeze([
    'schemaVersion',
    'manifestId',
    'manifestSha256',
    'changeId',
    'scope',
    'readiness',
    'scenarioRoleDefinitions',
    'sources',
    'companionMatrix',
    'simulationEvidence',
    'manualRouteCoverage',
    'featureGates',
    'requirements',
    'summary',
]);

const SCOPE_KEYS = Object.freeze([
    'assessmentMode',
    'completionLevel',
    'brokerNetworkAccessed',
    'api8080Accessed',
    'brokerWriteAuthority',
    'productionAuthorized',
    'caAuthorized',
    'realOrderAuthorized',
    'containsSecrets',
    'containsAccountIdentifiers',
]);

const REQUIREMENT_KEYS = Object.freeze([
    'id',
    'sourceId',
    'title',
    'scenarios',
    'simulationEvidenceId',
    'manualRouteCoverageId',
    'featureGateIds',
]);

const DECISION_TABLE_FEATURE_LABELS = Object.freeze({
    quick: '快速單',
    stop_take: '停損停利單',
    good_till: '長效單',
    multi_condition: '多條件單',
    parent_child: '母子單',
    trailing_exit: '移動出場單',
    scheduled_quantity: '定時定量單',
});

const COMMON_GATE_BLOCKERS = Object.freeze([
    'no_current_eligible_live_simulation_evidence',
    'write_unlock_gates_incomplete',
]);
const ACCEPTED_STRATEGY_GATE_BLOCKERS = Object.freeze([
    ...COMMON_GATE_BLOCKERS,
    'bounded_quote_simulation_e2e_pending_market_reproducibility',
]);

const EXPECTED_FEATURE_GATES = Object.freeze({
    runtime_core: Object.freeze({
        gateClass: 'gate_1',
        state: 'disabled',
        blockers: COMMON_GATE_BLOCKERS,
    }),
    protective_exit: Object.freeze({
        gateClass: 'gate_2',
        state: 'disabled',
        blockers: Object.freeze([
            ...COMMON_GATE_BLOCKERS,
            'protective_exit_acceptance_missing',
        ]),
    }),
    quick: Object.freeze({
        gateClass: 'gate_3',
        state: 'disabled',
        blockers: ACCEPTED_STRATEGY_GATE_BLOCKERS,
    }),
    good_till: Object.freeze({
        gateClass: 'gate_3',
        state: 'disabled',
        blockers: ACCEPTED_STRATEGY_GATE_BLOCKERS,
    }),
    multi_condition: Object.freeze({
        gateClass: 'gate_3',
        state: 'disabled',
        blockers: ACCEPTED_STRATEGY_GATE_BLOCKERS,
    }),
    parent_child: Object.freeze({
        gateClass: 'gate_3',
        state: 'disabled',
        blockers: ACCEPTED_STRATEGY_GATE_BLOCKERS,
    }),
    stop_take: Object.freeze({
        gateClass: 'gate_3',
        state: 'disabled',
        blockers: ACCEPTED_STRATEGY_GATE_BLOCKERS,
    }),
    trailing_exit: Object.freeze({
        gateClass: 'gate_3',
        state: 'disabled',
        blockers: ACCEPTED_STRATEGY_GATE_BLOCKERS,
    }),
    scheduled_quantity: Object.freeze({
        gateClass: 'gate_3',
        state: 'disabled',
        blockers: Object.freeze([
            ...ACCEPTED_STRATEGY_GATE_BLOCKERS,
            'scheduled_quantity_algorithm_unverified',
        ]),
    }),
});

const NORMAL_SCENARIO_PATTERN =
    /正常|合法|完成|建立|查看|選擇|可重算|已知|唯一|相同|一張與|百分比|創高|滑價|部分成交|看 A 下 B|不能整除|使用不同商品|最小|關閉 5173|同一 transaction|所有義務已終結|只有一般既有持股|recovery 完成|dispatch 已持有|從新增|聯動 K 線|條件由 false|為既有部位|OR 兩條|Runtime 重啟且無行情缺口|剩餘量小於|不同帳號|取消仍有 working|broker 接受|安裝|status|逐次授權|current eligible|沿用|顯示/;
const FAILURE_SCENARIO_PATTERN =
    /失敗|缺少|不符|惡意|Cloudflare|逾時|未知|未通過|不完整|不可|disabled|超過|拒絕|遺失|過期|非法|離線|未成交|零成交|不支援|NaN|超出|只有 BidAsk|無法|未授權|fixture|stale|不一致|未訂閱|read-only|用盡|滿|一般 uninstall|synthetic|改變|修改|尚未|不足|漂移/;
const RACE_SCENARIO_PATTERN =
    /同時|競爭|等待|重複|重啟|當機|gap|切換|並發|TOCTOU|drift|重排|晚到|跨交易日|queue|ack|response|event|外部|部分成交|working|重新|多個|cancel 與 fill|第一個 byte|sleep|返回|聯動|revision|重送|前日|收盤|remainder/;

function exactKeys(value, keys) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        JSON.stringify(Object.keys(value).sort()) ===
            JSON.stringify([...keys].sort())
    );
}

function canonicalJson(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
        .join(',')}}`;
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function computeTask147AcceptanceManifestSha256(manifest) {
    const { manifestSha256: _ignored, ...content } = manifest;
    return sha256(canonicalJson(content));
}

function isSha256(value) {
    return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isSafeRelativePath(value) {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 300 &&
        !path.isAbsolute(value) &&
        !value.split('/').includes('..') &&
        !/[\u0000-\u001f\u007f]/.test(value)
    );
}

async function resolveCanonicalFileInsideRepo(repoRoot, relativePath) {
    if (!isSafeRelativePath(relativePath)) {
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
        throw new TypeError('canonical artifact must be a regular non-symlink file');
    }
    const physicalPath = await realpath(absolute);
    const physicalRelative = path.relative(canonicalRepoRoot, physicalPath);
    if (
        physicalRelative.startsWith('..') ||
        path.isAbsolute(physicalRelative) ||
        physicalPath !== absolute
    ) {
        throw new TypeError('canonical artifact escaped its physical repository path');
    }
    return physicalPath;
}

function parseSpec(sourceText) {
    const requirements = [];
    let current = null;
    for (const line of sourceText.split(/\r?\n/)) {
        const requirementMatch = line.match(/^### Requirement: (.+)$/);
        if (requirementMatch) {
            current = {
                title: requirementMatch[1],
                scenarios: [],
            };
            requirements.push(current);
            continue;
        }
        const scenarioMatch = line.match(/^#### Scenario: (.+)$/);
        if (scenarioMatch && current) {
            current.scenarios.push(scenarioMatch[1]);
        }
    }
    return requirements;
}

function countOccurrences(haystack, needle) {
    let count = 0;
    let cursor = 0;
    while (true) {
        const position = haystack.indexOf(needle, cursor);
        if (position < 0) return count;
        count += 1;
        cursor = position + needle.length;
    }
}

function chooseScenario(scenarios, pattern, excluded = []) {
    return (
        scenarios.find(
            (scenario) => pattern.test(scenario) && !excluded.includes(scenario),
        ) ??
        scenarios.find((scenario) => !excluded.includes(scenario)) ??
        scenarios[0]
    );
}

function expectedScenarioSources(scenarios) {
    const normal = chooseScenario(scenarios, NORMAL_SCENARIO_PATTERN);
    const failure = chooseScenario(scenarios, FAILURE_SCENARIO_PATTERN, [
        normal,
    ]);
    const race = chooseScenario(scenarios, RACE_SCENARIO_PATTERN, [
        normal,
        failure,
    ]);
    return Object.freeze({ normal, failure, race });
}

function expectedRequirementFeatureGateIds(prefix, requirementNumber) {
    if (prefix === 'DSR' || prefix === 'SLR') return ['runtime_core'];
    if (prefix === 'PET') {
        const gateIds = ['runtime_core', 'protective_exit'];
        if ([5, 6, 7, 8, 9, 10, 11, 13, 14, 15].includes(requirementNumber)) {
            gateIds.push('stop_take');
        }
        if ([11, 12, 13, 14, 15].includes(requirementNumber)) {
            gateIds.push('trailing_exit');
        }
        return gateIds;
    }
    const allStrategyGateIds = [
        'quick',
        'good_till',
        'multi_condition',
        'parent_child',
        'stop_take',
        'trailing_exit',
        'scheduled_quantity',
    ];
    const specificGateByRequirement = {
        6: 'quick',
        7: 'stop_take',
        8: 'good_till',
        9: 'multi_condition',
        10: 'parent_child',
        11: 'trailing_exit',
        12: 'scheduled_quantity',
    };
    const specificGate = specificGateByRequirement[requirementNumber];
    return [
        'runtime_core',
        ...(specificGate ? [specificGate] : allStrategyGateIds),
    ];
}

function expectedMatrixRow(requirement, expectedGateIds) {
    return [
        `| \`${requirement.id}\``,
        requirement.title,
        `\`${requirement.id}-N\``,
        `\`${requirement.id}-F\``,
        `\`${requirement.id}-R\``,
        '`SIM-CURRENT-NONE`／hash=null',
        '`MRC-2026-08-11.1`／complete',
        `${expectedGateIds.map((gateId) => `\`${gateId}\``).join('＋')}／disabled |`,
    ].join(' | ');
}

function hasSensitiveField(value) {
    const forbiddenNormalizedKeys = new Set([
        'password',
        'passwd',
        'secret',
        'token',
        'credential',
        'credentials',
        'apikey',
        'clientsecret',
        'clientid',
        'accesstoken',
        'refreshtoken',
        'sessiontoken',
        'authtoken',
        'idtoken',
        'secretaccesskey',
        'accesskeyid',
        'authorization',
        'cookie',
        'privatekey',
        'sshprivatekey',
        'pem',
        'certificate',
        'accountid',
        'accountno',
        'accountnumber',
        'accountref',
        'brokeraccount',
        'brokeraccountid',
        'brokerid',
        'personid',
        'userid',
        'username',
        'email',
        'capassword',
        'capath',
    ]);
    if (Array.isArray(value)) return value.some(hasSensitiveField);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(
        ([key, child]) =>
            forbiddenNormalizedKeys.has(key.replace(/[_\-.]/g, '').toLowerCase()) ||
            hasSensitiveField(child),
    );
}

function hasSensitiveString(value) {
    if (typeof value === 'string') {
        if (isSha256(value)) return false;
        return (
            /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
            /\bAKIA[A-Z0-9]{16}\b/.test(value) ||
            /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/.test(value) ||
            /\bsk-[A-Za-z0-9_-]{20,}\b/.test(value) ||
            /\bBearer\s+\S+/i.test(value) ||
            /\bBasic\s+[A-Za-z0-9+/=]{8,}/i.test(value) ||
            /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(
                value,
            ) ||
            /\b(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/i.test(
                value,
            ) ||
            /\b(?:aws[_-]?secret[_-]?access[_-]?key|client[_-]?secret|secret[_-]?access[_-]?key|access[_-]?key[_-]?id|session[_-]?token|refresh[_-]?token|access[_-]?token|id[_-]?token|auth[_-]?token|credential(?:s)?)\s*[:=]\s*\S+/i.test(
                value,
            ) ||
            /\b(?:account|acct|broker|person)(?:[_-]?(?:id|no))?\s*[:=\/#-]+\s*[A-Za-z0-9]{6,}\b/i.test(
                value,
            ) ||
            /\b(?:account|acct|broker|person)(?:[_-]?(?:id|no))\s+[A-Za-z0-9]{6,}\b/i.test(
                value,
            ) ||
            /\b(?:account|acct|broker|person)\s+\d{6,20}\b/i.test(
                value,
            ) ||
            /\b\d{8,20}\b/.test(value)
        );
    }
    if (Array.isArray(value)) return value.some(hasSensitiveString);
    if (!value || typeof value !== 'object') return false;
    return Object.values(value).some(hasSensitiveString);
}

function hasSensitiveArtifactText(text) {
    return (
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
        /\bAKIA[A-Z0-9]{16}\b/.test(text) ||
        /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/.test(text) ||
        /\bsk-[A-Za-z0-9_-]{20,}\b/.test(text) ||
        /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+\S+/i.test(text) ||
        /\b(?:Bearer|Basic)\s+(?:token|credential|secret)[-_][A-Za-z0-9_-]{8,}\b/i.test(
            text,
        ) ||
        /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(
            text,
        ) ||
        /\b(?:password|passwd|api[_-]?key|client[_-]?secret|secret[_-]?access[_-]?key|access[_-]?key[_-]?id|session[_-]?token|refresh[_-]?token|access[_-]?token|id[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_+./=-]{8,}/i.test(
            text,
        ) ||
        /\b(?:account|acct|broker|person)(?:[_-]?(?:id|no|number))\s*[:=/#-]+\s*["']?[A-Za-z0-9]{6,}\b/i.test(
            text,
        )
    );
}

const UNSAFE_ACCEPTANCE_ASSERTIONS = Object.freeze([
    /\bbroker\s+write\s+authority\s*[:=]\s*(?:enabled|true|yes)\b/i,
    /\bbrokerWriteAuthority\s*[:=]\s*true\b/i,
    /\bwrite[-_ ]unlock(?:[-_ ]ready)?\s*[:=]\s*true\b/i,
    /\bfeature[-_ ]release(?:[-_ ]ready)?\s*[:=]\s*true\b/i,
    /\bproduction(?:Authorized|[-_ ]authorized)?\s*[:=]\s*true\b/i,
    /\b(?:ca|realOrder)Authorized\s*[:=]\s*true\b/i,
    /\bautomationAccountEligibility\s*["']?\s*[:=]\s*["']?enabled\b/i,
]);

function hasUnsafeAcceptanceAssertion(text) {
    return UNSAFE_ACCEPTANCE_ASSERTIONS.some((pattern) => pattern.test(text));
}

function parseManualCoverageProjection(text, errors) {
    const fencedJsonBlocks = [...text.matchAll(/```json\s*\r?\n([\s\S]*?)\r?\n```/g)];
    const candidates = [];
    for (const match of fencedJsonBlocks) {
        try {
            const parsed = JSON.parse(match[1]);
            if (
                parsed?.schema ===
                    'realtimestock.manual-stock-write-route-coverage/v1' ||
                Object.hasOwn(parsed ?? {}, 'coverageComplete') ||
                Object.hasOwn(parsed ?? {}, 'manualEquivalencePassed') ||
                Object.hasOwn(parsed ?? {}, 'serverDerivedProvenancePassed') ||
                Object.hasOwn(parsed ?? {}, 'automationAccountEligibility')
            ) {
                candidates.push(parsed);
            }
        } catch {
            errors.push('manual_coverage_json_invalid');
        }
    }
    if (candidates.length !== 1) {
        errors.push('manual_coverage_projection_not_unique');
        return null;
    }
    return candidates[0];
}

function validateManualCoverageProjection(text, manifestCoverage, errors) {
    const expected = {
        coverageComplete: true,
        manualEquivalencePassed: true,
        serverDerivedProvenancePassed: true,
        automationAccountEligibility: 'disabled',
    };
    const sourceProjection = parseManualCoverageProjection(text, errors);
    for (const [key, value] of Object.entries(expected)) {
        if (sourceProjection?.[key] !== value) {
            errors.push(`manual_coverage_source_projection_missing:${key}`);
        }
        if (manifestCoverage[key] !== value) {
            errors.push(`manual_coverage_projection_mismatch:${key}`);
        }
    }
}

function validateDecisionTableProjection(text, featureGateMap, errors) {
    for (const [gateId, label] of Object.entries(
        DECISION_TABLE_FEATURE_LABELS,
    )) {
        const row = text
            .split(/\r?\n/)
            .find((line) => line.startsWith(`| ${label} |`));
        if (!row || !row.includes('`disabled`')) {
            errors.push(`decision_table_not_disabled:${gateId}`);
        }
        if (featureGateMap.get(gateId)?.state !== 'disabled') {
            errors.push(`feature_gate_not_disabled:${gateId}`);
        }
    }
}

export async function validateTask147AcceptanceManifest({
    manifest,
    repoRoot = DEFAULT_TASK_14_7_REPO_ROOT,
} = {}) {
    const errors = [];
    if (!exactKeys(manifest, TOP_LEVEL_KEYS)) {
        const shapeErrors = ['manifest_top_level_schema_invalid'];
        if (hasSensitiveField(manifest)) shapeErrors.push('sensitive_field_present');
        if (hasSensitiveString(manifest)) shapeErrors.push('sensitive_value_present');
        return Object.freeze({
            valid: false,
            errors: Object.freeze(shapeErrors.sort()),
        });
    }

    if (manifest.schemaVersion !== TASK_14_7_ACCEPTANCE_SCHEMA) {
        errors.push('manifest_schema_stale');
    }
    if (manifest.changeId !== TASK_14_7_CHANGE_ID) {
        errors.push('change_id_mismatch');
    }
    if (manifest.manifestId !== TASK_14_7_MANIFEST_ID) {
        errors.push('manifest_id_invalid');
    }
    if (
        !isSha256(manifest.manifestSha256) ||
        manifest.manifestSha256 !==
            computeTask147AcceptanceManifestSha256(manifest)
    ) {
        errors.push('manifest_hash_mismatch');
    }

    if (
        !exactKeys(manifest.scope, SCOPE_KEYS) ||
        canonicalJson(manifest.scope) !== canonicalJson(EXPECTED_SCOPE)
    ) {
        errors.push('scope_schema_invalid');
        if (exactKeys(manifest.scope, SCOPE_KEYS)) {
            for (const key of SCOPE_KEYS.slice(2)) {
                if (manifest.scope[key] !== false) {
                    errors.push(`scope_safety_flag_not_false:${key}`);
                }
            }
        }
    }

    if (
        !exactKeys(manifest.readiness, Object.keys(EXPECTED_READINESS)) ||
        canonicalJson(manifest.readiness) !== canonicalJson(EXPECTED_READINESS)
    ) {
        errors.push('readiness_projection_invalid');
    }

    if (
        !exactKeys(
            manifest.scenarioRoleDefinitions,
            Object.keys(EXPECTED_SCENARIO_ROLE_DEFINITIONS),
        ) ||
        canonicalJson(manifest.scenarioRoleDefinitions) !==
            canonicalJson(EXPECTED_SCENARIO_ROLE_DEFINITIONS)
    ) {
        errors.push('scenario_role_definitions_invalid');
    }

    if (hasSensitiveField(manifest)) errors.push('sensitive_field_present');
    if (hasSensitiveString(manifest)) errors.push('sensitive_value_present');

    const sourceMap = new Map();
    const sourceTextMap = new Map();
    if (!Array.isArray(manifest.sources)) {
        errors.push('sources_not_array');
    } else {
        for (const source of manifest.sources) {
            const definition = SOURCE_DEFINITIONS[source?.id];
            if (
                !exactKeys(source, ['id', 'path', 'sha256']) ||
                !definition ||
                sourceMap.has(source.id) ||
                source.path !== definition.path ||
                !isSha256(source.sha256)
            ) {
                errors.push('source_entry_invalid');
                if (definition && source?.path !== definition.path) {
                    errors.push(`source_path_mismatch:${source.id}`);
                }
                continue;
            }
            if (source.sha256 !== definition.sha256) {
                errors.push(`source_expected_hash_mismatch:${source.id}`);
            }
            sourceMap.set(source.id, source);
            try {
                const sourceText = await readFile(
                    await resolveCanonicalFileInsideRepo(repoRoot, source.path),
                    'utf8',
                );
                sourceTextMap.set(source.id, sourceText);
                if (sha256(sourceText) !== source.sha256) {
                    errors.push(`source_hash_mismatch:${source.id}`);
                }
                if (hasSensitiveArtifactText(sourceText)) {
                    errors.push(`source_sensitive_value_present:${source.id}`);
                }
                if (hasUnsafeAcceptanceAssertion(sourceText)) {
                    errors.push(`source_unsafe_authority_assertion:${source.id}`);
                }
            } catch {
                errors.push(`source_unreadable:${source.id}`);
            }
        }
        for (const sourceId of Object.keys(SOURCE_DEFINITIONS)) {
            if (!sourceMap.has(sourceId)) {
                errors.push(`source_missing:${sourceId}`);
            }
        }
        if (sourceMap.size !== Object.keys(SOURCE_DEFINITIONS).length) {
            errors.push('source_catalog_not_exact');
        }
    }

    let matrixText = '';
    if (
        !exactKeys(manifest.companionMatrix, ['path', 'sha256']) ||
        manifest.companionMatrix?.path !== COMPANION_MATRIX_PATH ||
        !isSha256(manifest.companionMatrix?.sha256)
    ) {
        errors.push('companion_matrix_invalid');
        if (
            manifest.companionMatrix?.path !== undefined &&
            manifest.companionMatrix.path !== COMPANION_MATRIX_PATH
        ) {
            errors.push('companion_matrix_path_mismatch');
        }
    } else {
        if (manifest.companionMatrix.sha256 !== COMPANION_MATRIX_SHA256) {
            errors.push('companion_matrix_expected_hash_mismatch');
        }
        try {
            matrixText = await readFile(
                await resolveCanonicalFileInsideRepo(
                    repoRoot,
                    manifest.companionMatrix.path,
                ),
                'utf8',
            );
            if (sha256(matrixText) !== manifest.companionMatrix.sha256) {
                errors.push('companion_matrix_hash_mismatch');
            }
            if (hasSensitiveArtifactText(matrixText)) {
                errors.push('companion_matrix_sensitive_value_present');
            }
            if (hasUnsafeAcceptanceAssertion(matrixText)) {
                errors.push('companion_matrix_unsafe_authority_assertion');
            }
        } catch {
            errors.push('companion_matrix_unreadable');
        }
    }

    const simulationEvidenceMap = new Map();
    if (!Array.isArray(manifest.simulationEvidence)) {
        errors.push('simulation_evidence_not_array');
    } else {
        for (const evidence of manifest.simulationEvidence) {
            if (
                !exactKeys(evidence, [
                    'id',
                    'evidenceClass',
                    'eligibility',
                    'sha256',
                    'reason',
                ]) ||
                simulationEvidenceMap.has(evidence.id)
            ) {
                errors.push('simulation_evidence_entry_invalid');
                continue;
            }
            simulationEvidenceMap.set(evidence.id, evidence);
        }
        const missing = simulationEvidenceMap.get('SIM-CURRENT-NONE');
        if (
            simulationEvidenceMap.size !== 1 ||
            !missing ||
            missing.evidenceClass !== 'none' ||
            missing.eligibility !== 'missing' ||
            missing.sha256 !== null ||
            missing.reason !== 'no_current_eligible_live_simulation_evidence'
        ) {
            errors.push('live_simulation_evidence_must_remain_absent');
        }
    }

    if (
        !exactKeys(manifest.manualRouteCoverage, [
            'id',
            'sourceId',
            'coverageComplete',
            'manualEquivalencePassed',
            'serverDerivedProvenancePassed',
            'automationAccountEligibility',
        ]) ||
        manifest.manualRouteCoverage.id !== 'MRC-2026-08-11.1' ||
        manifest.manualRouteCoverage.sourceId !== 'MANUAL-ROUTE-COVERAGE'
    ) {
        errors.push('manual_route_coverage_schema_invalid');
    } else {
        validateManualCoverageProjection(
            sourceTextMap.get('MANUAL-ROUTE-COVERAGE') ?? '',
            manifest.manualRouteCoverage,
            errors,
        );
    }

    try {
        const task134Manifest = JSON.parse(
            sourceTextMap.get('TASK-13-4-ACCEPTANCE') ?? '',
        );
        const task134Result = await validateTask134AcceptanceManifest({
            manifest: task134Manifest,
            repoRoot,
        });
        if (!task134Result.valid) {
            errors.push('task_13_4_acceptance_invalid');
            for (const error of task134Result.errors) {
                errors.push(`task_13_4:${error}`);
            }
        }
    } catch {
        errors.push('task_13_4_acceptance_unreadable');
    }

    const featureGateMap = new Map();
    if (!Array.isArray(manifest.featureGates)) {
        errors.push('feature_gates_not_array');
    } else {
        for (const gate of manifest.featureGates) {
            const expectedGate = EXPECTED_FEATURE_GATES[gate?.id];
            if (
                !exactKeys(gate, ['id', 'gateClass', 'state', 'blockers']) ||
                !expectedGate ||
                featureGateMap.has(gate.id) ||
                canonicalJson({
                    gateClass: gate.gateClass,
                    state: gate.state,
                    blockers: gate.blockers,
                }) !== canonicalJson(expectedGate)
            ) {
                errors.push('feature_gate_entry_invalid');
                continue;
            }
            featureGateMap.set(gate.id, gate);
        }
        for (const gateId of TASK_14_7_FEATURE_GATE_IDS) {
            if (!featureGateMap.has(gateId)) {
                errors.push(`feature_gate_missing:${gateId}`);
            }
        }
        if (featureGateMap.size !== TASK_14_7_FEATURE_GATE_IDS.length) {
            errors.push('feature_gate_catalog_not_exact');
        }
    }
    validateDecisionTableProjection(
        sourceTextMap.get('OFFICIAL-DECISION-TABLES') ?? '',
        featureGateMap,
        errors,
    );

    const expectedRequirements = new Map();
    for (const [sourceId, definition] of Object.entries(SOURCE_DEFINITIONS)) {
        if (definition.kind !== 'spec') continue;
        const parsed = parseSpec(sourceTextMap.get(sourceId) ?? '');
        parsed.forEach((requirement, index) => {
            const requirementNumber = index + 1;
            const id = `${definition.prefix}-${String(requirementNumber).padStart(3, '0')}`;
            expectedRequirements.set(id, {
                sourceId,
                prefix: definition.prefix,
                requirementNumber,
                scenarioSources: expectedScenarioSources(
                    requirement.scenarios,
                ),
                featureGateIds: expectedRequirementFeatureGateIds(
                    definition.prefix,
                    requirementNumber,
                ),
                ...requirement,
            });
        });
    }

    const requirementIds = new Set();
    let normalCount = 0;
    let failureCount = 0;
    let raceCount = 0;
    if (!Array.isArray(manifest.requirements)) {
        errors.push('requirements_not_array');
    } else {
        for (const requirement of manifest.requirements) {
            if (!exactKeys(requirement, REQUIREMENT_KEYS)) {
                errors.push('requirement_entry_schema_invalid');
                continue;
            }
            if (
                typeof requirement.id !== 'string' ||
                requirementIds.has(requirement.id)
            ) {
                errors.push('requirement_id_invalid_or_duplicate');
                continue;
            }
            requirementIds.add(requirement.id);
            const expected = expectedRequirements.get(requirement.id);
            if (
                !expected ||
                expected.sourceId !== requirement.sourceId ||
                expected.title !== requirement.title
            ) {
                errors.push(`requirement_binding_mismatch:${requirement.id}`);
                continue;
            }
            if (
                requirement.simulationEvidenceId !== 'SIM-CURRENT-NONE' ||
                requirement.manualRouteCoverageId !== 'MRC-2026-08-11.1'
            ) {
                errors.push(`requirement_evidence_binding_invalid:${requirement.id}`);
            }
            if (
                !Array.isArray(requirement.featureGateIds) ||
                canonicalJson(requirement.featureGateIds) !==
                    canonicalJson(expected.featureGateIds)
            ) {
                errors.push(`requirement_feature_gate_binding_invalid:${requirement.id}`);
            }
            if (!exactKeys(requirement.scenarios, ['normal', 'failure', 'race'])) {
                errors.push(`requirement_scenarios_invalid:${requirement.id}`);
                continue;
            }
            for (const [role, suffix] of [
                ['normal', 'N'],
                ['failure', 'F'],
                ['race', 'R'],
            ]) {
                const scenario = requirement.scenarios[role];
                const expectedVariant = SCENARIO_VARIANTS[role];
                if (
                    !exactKeys(scenario, [
                        'caseId',
                        'sourceScenario',
                        'role',
                        'injection',
                        'expectedOutcome',
                        'status',
                    ]) ||
                    scenario.caseId !== `${requirement.id}-${suffix}` ||
                    scenario.role !== role ||
                    scenario.injection !== expectedVariant.injection ||
                    scenario.expectedOutcome !==
                        expectedVariant.expectedOutcome ||
                    scenario.status !== 'missing' ||
                    scenario.sourceScenario !== expected.scenarioSources[role]
                ) {
                    errors.push(
                        `requirement_${role}_scenario_invalid:${requirement.id}`,
                    );
                }
            }
            normalCount += 1;
            failureCount += 1;
            raceCount += 1;
            if (matrixText) {
                const expectedRow = expectedMatrixRow(
                    requirement,
                    expected.featureGateIds,
                );
                if (countOccurrences(matrixText, expectedRow) !== 1) {
                    errors.push(`matrix_requirement_row_invalid:${requirement.id}`);
                }
            }
        }
    }
    for (const requirementId of expectedRequirements.keys()) {
        if (!requirementIds.has(requirementId)) {
            errors.push(`requirement_missing:${requirementId}`);
        }
    }
    if (requirementIds.size !== expectedRequirements.size) {
        errors.push('requirement_inventory_not_exact');
    }

    if (matrixText) {
        const actualRows = matrixText
            .split(/\r?\n/)
            .filter((line) =>
                /^\| `(?:DSR|PET|SLR|SOP)-\d{3}` \|/.test(line),
            );
        const expectedRows = [...expectedRequirements.entries()].map(
            ([id, expected]) =>
                expectedMatrixRow(
                    { id, title: expected.title },
                    expected.featureGateIds,
                ),
        );
        if (canonicalJson(actualRows) !== canonicalJson(expectedRows)) {
            errors.push('matrix_requirement_catalog_invalid');
        }
    }

    const expectedSummary = {
        requirementCount: expectedRequirements.size,
        normalScenarioCount: normalCount,
        failureScenarioCount: failureCount,
        raceScenarioCount: raceCount,
        currentEligibleSimulationEvidenceCount: 0,
        enabledFeatureGateCount: 0,
        manualRouteCoverageComplete: true,
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

export async function readAndValidateTask147AcceptanceManifest({
    manifestPath = DEFAULT_TASK_14_7_MANIFEST_PATH,
    repoRoot = DEFAULT_TASK_14_7_REPO_ROOT,
} = {}) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    return validateTask147AcceptanceManifest({ manifest, repoRoot });
}

async function main() {
    const manifestPath = process.argv[2]
        ? path.resolve(process.argv[2])
        : DEFAULT_TASK_14_7_MANIFEST_PATH;
    const result = await readAndValidateTask147AcceptanceManifest({
        manifestPath,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    await main();
}
