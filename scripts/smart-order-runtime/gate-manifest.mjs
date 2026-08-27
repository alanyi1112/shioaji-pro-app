import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import { isVerifiedSmartOrderGateEvidence } from './gate-evidence-verifier.mjs';

export const SMART_ORDER_GATE_MANIFEST_SCHEMA_VERSION =
    'smart-order-gate-manifest/2026-08-11.1';

export const SMART_ORDER_FEATURE_GATE_IDS = Object.freeze([
    'good_till',
    'multi_condition',
    'parent_child',
    'quick',
    'scheduled_quantity',
    'stop_take',
    'trailing_exit',
]);

const REQUIRED_EVIDENCE_BY_PROVENANCE = Object.freeze({
    automation: Object.freeze([
        'account_contract',
        'calendar_contract',
        'correlation_contract',
        'identity_mapping',
        'node_sqlite_capability',
        'order_class_contract',
        'pnl_full_day',
        'product_boundary_consent',
        'readonly_contract',
        'route_coverage',
        'security_review',
        'subscription_ownership',
        'unit_contract',
    ]),
    manual_user_confirmed: Object.freeze([
        'account_contract',
        'node_sqlite_capability',
        'order_class_contract',
        'pnl_full_day',
        'product_boundary_consent',
        'readonly_contract',
        'route_coverage',
        'security_review',
        'unit_contract',
    ]),
    gate_probe: Object.freeze([
        'account_contract',
        'node_sqlite_capability',
        'probe_safety_envelope',
        'product_boundary_consent',
        'readonly_contract',
        'security_review',
        'unit_contract',
    ]),
});

const FINGERPRINT_KEYS = Object.freeze([
    'adapterSha256',
    'appBuildSha256',
    'mappingRevision',
    'nodeRuntimeSha256',
    'orderClassMatrixRevision',
    'orderClassMatrixSha256',
    'osPlatformSha256',
    'pnlPolicyDefinitionSha256',
    'pnlPolicyRevision',
    'routeCoverageSha256',
    'shioajiCapabilitySha256',
    'shioajiServerVersion',
    'sidecarSchemaSha256',
    'sqliteRuntimeSha256',
]);

function token(value, label, maximumLength = 160) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > maximumLength ||
        value.trim() !== value ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} must be a bounded token`);
    }
    return value;
}

function digest(value, label) {
    if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
        throw new TypeError(`${label} must be a SHA-256 digest`);
    }
    return value;
}

function exactObject(value, keys) {
    return (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        JSON.stringify(Object.keys(value).sort()) ===
            JSON.stringify([...keys].sort())
    );
}

function canonicalFingerprints(input) {
    if (!exactObject(input, FINGERPRINT_KEYS)) {
        throw new TypeError('gate fingerprint fields are not canonical');
    }
    return Object.freeze({
        adapterSha256: digest(input.adapterSha256, 'adapterSha256'),
        appBuildSha256: digest(input.appBuildSha256, 'appBuildSha256'),
        mappingRevision: token(input.mappingRevision, 'mappingRevision'),
        nodeRuntimeSha256: digest(
            input.nodeRuntimeSha256,
            'nodeRuntimeSha256',
        ),
        orderClassMatrixRevision: token(
            input.orderClassMatrixRevision,
            'orderClassMatrixRevision',
        ),
        orderClassMatrixSha256: digest(
            input.orderClassMatrixSha256,
            'orderClassMatrixSha256',
        ),
        osPlatformSha256: digest(
            input.osPlatformSha256,
            'osPlatformSha256',
        ),
        pnlPolicyDefinitionSha256: digest(
            input.pnlPolicyDefinitionSha256,
            'pnlPolicyDefinitionSha256',
        ),
        pnlPolicyRevision: token(
            input.pnlPolicyRevision,
            'pnlPolicyRevision',
        ),
        routeCoverageSha256: digest(
            input.routeCoverageSha256,
            'routeCoverageSha256',
        ),
        shioajiCapabilitySha256: digest(
            input.shioajiCapabilitySha256,
            'shioajiCapabilitySha256',
        ),
        shioajiServerVersion: token(
            input.shioajiServerVersion,
            'shioajiServerVersion',
        ),
        sidecarSchemaSha256: digest(
            input.sidecarSchemaSha256,
            'sidecarSchemaSha256',
        ),
        sqliteRuntimeSha256: digest(
            input.sqliteRuntimeSha256,
            'sqliteRuntimeSha256',
        ),
    });
}

function canonicalFeatureGates(input) {
    if (!exactObject(input, SMART_ORDER_FEATURE_GATE_IDS)) {
        throw new TypeError('feature gate fields are not canonical');
    }
    const gates = {};
    for (const feature of SMART_ORDER_FEATURE_GATE_IDS) {
        if (typeof input[feature] !== 'boolean') {
            throw new TypeError(`feature gate ${feature} must be boolean`);
        }
        gates[feature] = input[feature];
    }
    return Object.freeze(gates);
}

function canonicalEvidence(evidence, nowEpochMs) {
    if (!Array.isArray(evidence)) {
        throw new TypeError('gate evidence must be an array');
    }
    const entries = [];
    const evidenceIds = new Set();
    const evidenceClassIds = new Set();
    for (const item of evidence) {
        if (!isVerifiedSmartOrderGateEvidence(item) || item.eligible !== true) {
            throw new TypeError('gate evidence was not issued by the verifier');
        }
        if (item.validUntilEpochMs <= nowEpochMs) {
            throw new TypeError('gate evidence is expired');
        }
        if (evidenceIds.has(item.evidenceId)) {
            throw new TypeError('duplicate gate evidence id');
        }
        if (evidenceClassIds.has(item.evidenceClass)) {
            throw new TypeError('duplicate gate evidence class');
        }
        evidenceIds.add(item.evidenceId);
        evidenceClassIds.add(item.evidenceClass);
        entries.push(
            Object.freeze({
                evidenceId: token(item.evidenceId, 'evidenceId'),
                evidenceClass: token(item.evidenceClass, 'evidenceClass'),
                schemaVersion: token(item.schemaVersion, 'schemaVersion'),
                sourceSha256: digest(item.sourceSha256, 'sourceSha256'),
                resultSha256: digest(item.resultSha256, 'resultSha256'),
                generatedAtEpochMs: item.generatedAtEpochMs,
                validUntilEpochMs: item.validUntilEpochMs,
            }),
        );
    }
    entries.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
    return Object.freeze(entries);
}

function evidenceClasses(entries) {
    return new Set(
        entries.map((entry) =>
            entry.evidenceClass === 'live_readonly'
                ? 'readonly_contract'
                : entry.evidenceClass,
        ),
    );
}

function blockersFor(provenance, entries) {
    const classes = evidenceClasses(entries);
    return Object.freeze(
        REQUIRED_EVIDENCE_BY_PROVENANCE[provenance]
            .filter((required) => !classes.has(required))
            .map((required) => `missing_evidence:${required}`),
    );
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function createSmartOrderGateManifest({
    manifestId = randomUUID(),
    manifestRevision,
    provenance,
    fingerprints,
    featureGates,
    productBoundaryConsentVersion,
    evidence = [],
    createdAtEpochMs,
    requestedValidUntilEpochMs,
}) {
    if (!Object.hasOwn(REQUIRED_EVIDENCE_BY_PROVENANCE, provenance)) {
        throw new TypeError('gate manifest provenance is unsupported');
    }
    if (
        !Number.isSafeInteger(createdAtEpochMs) ||
        createdAtEpochMs < 0 ||
        !Number.isSafeInteger(requestedValidUntilEpochMs) ||
        requestedValidUntilEpochMs <= createdAtEpochMs
    ) {
        throw new TypeError('gate manifest time range is invalid');
    }
    const canonicalEvidenceEntries = canonicalEvidence(evidence, createdAtEpochMs);
    const blockers = blockersFor(provenance, canonicalEvidenceEntries);
    const evidenceExpiry = canonicalEvidenceEntries.reduce(
        (minimum, item) => Math.min(minimum, item.validUntilEpochMs),
        requestedValidUntilEpochMs,
    );
    const content = Object.freeze({
        schemaVersion: SMART_ORDER_GATE_MANIFEST_SCHEMA_VERSION,
        manifestId: token(manifestId, 'manifestId'),
        manifestRevision: token(manifestRevision, 'manifestRevision'),
        provenance,
        state: blockers.length === 0 ? 'eligible' : 'observe_only',
        fingerprints: canonicalFingerprints(fingerprints),
        featureGates: canonicalFeatureGates(featureGates),
        productBoundaryConsentVersion: token(
            productBoundaryConsentVersion,
            'productBoundaryConsentVersion',
        ),
        evidence: canonicalEvidenceEntries,
        blockers,
        createdAtEpochMs,
        validUntilEpochMs: evidenceExpiry,
        containsSecrets: false,
        containsAccountIdentifiers: false,
        browserMutable: false,
    });
    return Object.freeze({
        ...content,
        manifestSha256: sha256(canonicalJson(content)),
    });
}

export function validateSmartOrderGateManifest({
    manifest,
    currentFingerprints,
    currentEvidence,
    currentProductBoundaryConsentVersion,
    nowEpochMs,
}) {
    const reasons = [];
    if (
        !manifest ||
        typeof manifest !== 'object' ||
        Array.isArray(manifest) ||
        !Number.isSafeInteger(nowEpochMs) ||
        nowEpochMs < 0
    ) {
        return Object.freeze({
            valid: false,
            state: 'observe_only',
            reasons: Object.freeze(['manifest_shape_invalid']),
        });
    }
    let expectedFingerprints;
    let evidence;
    let expectedConsentVersion;
    try {
        expectedFingerprints = canonicalFingerprints(currentFingerprints);
        evidence = canonicalEvidence(currentEvidence, nowEpochMs);
        expectedConsentVersion = token(
            currentProductBoundaryConsentVersion,
            'currentProductBoundaryConsentVersion',
        );
    } catch {
        return Object.freeze({
            valid: false,
            state: 'observe_only',
            reasons: Object.freeze(['current_verifier_context_invalid']),
        });
    }
    let hashMatches = false;
    try {
        const { manifestSha256, ...content } = manifest;
        hashMatches =
            manifestSha256 === sha256(canonicalJson(content)) &&
            exactObject(manifest, [...Object.keys(content), 'manifestSha256']);
    } catch {
        hashMatches = false;
    }
    if (!hashMatches) reasons.push('manifest_hash_or_schema_invalid');
    if (manifest.schemaVersion !== SMART_ORDER_GATE_MANIFEST_SCHEMA_VERSION) {
        reasons.push('manifest_schema_stale');
    }
    let recomputedBlockers = Object.freeze(['manifest_semantics_invalid']);
    try {
        token(manifest.manifestId, 'manifest.manifestId');
        token(manifest.manifestRevision, 'manifest.manifestRevision');
        const manifestFingerprints = canonicalFingerprints(
            manifest.fingerprints,
        );
        canonicalFeatureGates(manifest.featureGates);
        if (!Object.hasOwn(REQUIRED_EVIDENCE_BY_PROVENANCE, manifest.provenance)) {
            throw new TypeError('manifest provenance is unsupported');
        }
        if (
            !Number.isSafeInteger(manifest.createdAtEpochMs) ||
            manifest.createdAtEpochMs < 0 ||
            !Number.isSafeInteger(manifest.validUntilEpochMs) ||
            manifest.validUntilEpochMs <= manifest.createdAtEpochMs ||
            manifest.validUntilEpochMs >
                evidence.reduce(
                    (minimum, item) =>
                        Math.min(minimum, item.validUntilEpochMs),
                    manifest.validUntilEpochMs,
                )
        ) {
            throw new TypeError('manifest time range is invalid');
        }
        if (
            canonicalJson(manifestFingerprints) !==
            canonicalJson(expectedFingerprints)
        ) {
            reasons.push('fingerprint_mismatch');
        }
        if (manifest.productBoundaryConsentVersion !== expectedConsentVersion) {
            reasons.push('product_boundary_consent_mismatch');
        }
        if (canonicalJson(manifest.evidence) !== canonicalJson(evidence)) {
            reasons.push('evidence_catalog_mismatch');
        }
        recomputedBlockers = blockersFor(manifest.provenance, evidence);
        if (
            canonicalJson(manifest.blockers) !==
            canonicalJson(recomputedBlockers)
        ) {
            reasons.push('blocker_projection_mismatch');
        }
    } catch {
        reasons.push('manifest_semantics_invalid');
    }
    if (manifest.validUntilEpochMs <= nowEpochMs) reasons.push('manifest_expired');
    const recomputedState = recomputedBlockers.length === 0 ? 'eligible' : 'observe_only';
    if (manifest.state !== recomputedState) reasons.push('state_projection_mismatch');
    if (
        manifest.containsSecrets !== false ||
        manifest.containsAccountIdentifiers !== false ||
        manifest.browserMutable !== false
    ) {
        reasons.push('privacy_boundary_invalid');
    }
    return reasons.length === 0
        ? Object.freeze({
              valid: true,
              state: recomputedState,
              provenance: manifest.provenance,
              manifestSha256: manifest.manifestSha256,
              blockers: recomputedBlockers,
          })
        : Object.freeze({
              valid: false,
              state: 'observe_only',
              reasons: Object.freeze([...new Set(reasons)].sort()),
          });
}
