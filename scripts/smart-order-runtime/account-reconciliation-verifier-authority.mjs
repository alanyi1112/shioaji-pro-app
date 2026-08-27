import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';
import { SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION } from './shioaji-broker-event-mapper.mjs';
import { assertSmartOrderShioajiTradeObserverRuntimeAuthority } from './shioaji-trade-observer-runtime-authority.mjs';
import {
    SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
    SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
} from './canonical-pnl-policy.mjs';

const VERIFIED = new WeakSet();
const EVIDENCE = new WeakMap();

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function safeEpoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function digest(value, label) {
    if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
        throw new TypeError(`${label} must be a SHA-256 digest`);
    }
    return value;
}

/**
 * Creates the production reconciliation verifier only for the already-issued
 * primary Runtime controller and native Shioaji read transport. The issuer is
 * retained by the observer composition root; the coordinator receives only
 * the verifier facet.
 */
export async function createSmartOrderAccountReconciliationTransportAuthority({
    fetchImpl,
    nowEpochMs,
    runtimeController,
}) {
    await assertSmartOrderShioajiTradeObserverRuntimeAuthority({
        fetchImpl,
        runtimeController,
    });
    async function currentGateCapability(observedAtEpochMs) {
        const now = safeEpoch(observedAtEpochMs, 'nowEpochMs');
        const gate = await runtimeController.gateManifestStatus({
            provenance: 'automation',
            nowEpochMs: now,
        });
        if (
            gate?.present !== true ||
            gate.state !== 'eligible' ||
            gate.mappingRevision !== SMART_ORDER_SHIOAJI_EVENT_MAPPING_REVISION ||
            gate.pnlPolicyRevision !== SMART_ORDER_CANONICAL_PNL_POLICY_REVISION ||
            gate.pnlPolicyDefinitionSha256 !==
                SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256 ||
            gate.accountReconciliationCapabilityVerified !== true ||
            !Number.isSafeInteger(gate.validUntilEpochMs) ||
            gate.validUntilEpochMs <= now
        ) {
            throw new Error(
                'current Gate account reconciliation completeness capability is unavailable',
            );
        }
        return Object.freeze({
            capabilitySha256: digest(
                gate.accountReconciliationCapabilitySha256,
                'accountReconciliationCapabilitySha256',
            ),
            manifestRevision:
                typeof gate.manifestRevision === 'string' &&
                gate.manifestRevision.length > 0
                    ? gate.manifestRevision
                    : (() => {
                          throw new TypeError('manifestRevision is invalid');
                      })(),
            manifestSha256: digest(gate.manifestSha256, 'manifestSha256'),
            pnlPolicyDefinitionSha256:
                SMART_ORDER_CANONICAL_PNL_POLICY_DEFINITION_SHA256,
            pnlPolicyRevision: SMART_ORDER_CANONICAL_PNL_POLICY_REVISION,
            validUntilEpochMs: gate.validUntilEpochMs,
        });
    }
    const gateCapability = await currentGateCapability(nowEpochMs);
    const verifier = Object.freeze({
        verifySnapshotEvidence(candidate, expected) {
            const issued = EVIDENCE.get(candidate);
            const valid =
                issued !== undefined &&
                canonicalJson(issued.expected) === canonicalJson(expected);
            return Object.freeze({
                evidenceSha256:
                    issued?.evidenceSha256 ??
                    sha256('invalid-account-reconciliation-evidence'),
                valid,
            });
        },
    });
    VERIFIED.add(verifier);
    const issuer = Object.freeze({
        issueSnapshotEvidence(expected) {
            const evidence = Object.freeze({
                schemaVersion:
                    'smart-order-account-reconciliation-evidence/2026-08-13.1',
            });
            EVIDENCE.set(evidence, {
                expected,
                evidenceSha256: sha256(
                    canonicalJson([
                        'smart-order-account-reconciliation-evidence/2026-08-13.1',
                        gateCapability,
                        expected,
                    ]),
                ),
            });
            return evidence;
        },
    });
    return Object.freeze({
        async assertCurrentCompletenessCapability(observedAtEpochMs) {
            const current = await currentGateCapability(observedAtEpochMs);
            if (
                current.capabilitySha256 !== gateCapability.capabilitySha256 ||
                current.manifestRevision !== gateCapability.manifestRevision ||
                current.manifestSha256 !== gateCapability.manifestSha256
            ) {
                throw new Error(
                    'Gate account reconciliation completeness capability changed during collection',
                );
            }
            return true;
        },
        issuer,
        verifier,
    });
}

export function isVerifiedSmartOrderAccountReconciliationVerifier(value) {
    return Boolean(value && VERIFIED.has(value));
}
