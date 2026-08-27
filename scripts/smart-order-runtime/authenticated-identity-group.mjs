import { createHash, createHmac } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { canonicalJson } from './canonical-json.mjs';
import { readPrivateSecret } from './private-storage.mjs';
import { isVerifiedSmartOrderCanonicalPrincipalEvidence } from './canonical-principal-verifier-authority.mjs';

export const SMART_ORDER_AUTHENTICATED_IDENTITY_ADMISSION_SCHEMA_VERSION =
    'smart-order-authenticated-identity-admission/2026-08-13.1';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function token(value, label) {
    if (
        typeof value !== 'string' ||
        value.length < 1 ||
        value.length > 512 ||
        /[\u0000-\u001f\u007f]/.test(value)
    ) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

function exactOwnDataSnapshot(value, keys, label) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        utilTypes.isProxy(value)
    ) {
        throw new TypeError(`${label} must be an exact object`);
    }
    let ownKeys;
    let descriptors;
    try {
        ownKeys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        throw new TypeError(`${label} could not be inspected safely`);
    }
    if (
        ownKeys.some((key) => typeof key !== 'string') ||
        JSON.stringify([...ownKeys].sort()) !== JSON.stringify([...keys].sort())
    ) {
        throw new TypeError(`${label} keys are invalid`);
    }
    const snapshot = {};
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (
            !descriptor ||
            !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
            typeof descriptor.get === 'function' ||
            typeof descriptor.set === 'function'
        ) {
            throw new TypeError(`${label}.${key} must be an own data property`);
        }
        snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function accountScope(value, label) {
    const snapshot = exactOwnDataSnapshot(
        value,
        ['accountBrokerRef', 'accountIdRef'],
        label,
    );
    return Object.freeze({
        accountBrokerRef: token(snapshot.accountBrokerRef, `${label}.accountBrokerRef`),
        accountIdRef: token(snapshot.accountIdRef, `${label}.accountIdRef`),
    });
}

function admissionUnsigned(admission) {
    return Object.freeze({
        schemaVersion: admission.schemaVersion,
        accountBrokerRef: admission.accountBrokerRef,
        accountIdRef: admission.accountIdRef,
        identityGroupId: admission.identityGroupId,
        identityKeyFingerprintSha256: admission.identityKeyFingerprintSha256,
        principalEvidenceHash: admission.principalEvidenceHash,
        mappingRevision: admission.mappingRevision,
        issuedAtEpochMs: admission.issuedAtEpochMs,
    });
}

function verifiedPrincipal(value) {
    if (
        value === undefined ||
        !isVerifiedSmartOrderCanonicalPrincipalEvidence(value)
    ) {
        return undefined;
    }
    const snapshot = exactOwnDataSnapshot(
        value,
        [
            'accountScopes',
            'canonicalPrincipal',
            'mappingRevision',
            'principalEvidenceHash',
        ],
        'authenticatedPrincipalEvidence',
    );
    if (!Array.isArray(snapshot.accountScopes) || snapshot.accountScopes.length < 1) {
        throw new TypeError('authenticated principal requires fixed account scopes');
    }
    const scopes = snapshot.accountScopes.map((scope, index) =>
        accountScope(scope, `authenticatedPrincipalEvidence.accountScopes[${index}]`),
    );
    const scopeKeys = scopes.map(
        (scope) => `${scope.accountBrokerRef}\u001f${scope.accountIdRef}`,
    );
    if (new Set(scopeKeys).size !== scopeKeys.length) {
        throw new TypeError('authenticated principal account scopes must be unique');
    }
    const principalEvidenceHash = token(
        snapshot.principalEvidenceHash,
        'principalEvidenceHash',
    );
    if (!DIGEST.test(principalEvidenceHash)) {
        throw new TypeError('principalEvidenceHash must be sha256');
    }
    return Object.freeze({
        accountScopes: Object.freeze(scopes),
        canonicalPrincipal: token(
            snapshot.canonicalPrincipal,
            'canonicalPrincipal',
        ),
        mappingRevision: token(snapshot.mappingRevision, 'mappingRevision'),
        principalEvidenceHash,
    });
}

function verifiedProjection(value) {
    return canonicalJson({
        accountScopes: value.accountScopes,
        canonicalPrincipalSha256: `sha256:${createHash('sha256')
            .update(value.canonicalPrincipal)
            .digest('hex')}`,
        mappingRevision: value.mappingRevision,
        principalEvidenceHash: value.principalEvidenceHash,
    });
}

export async function createSmartOrderAuthenticatedIdentityGroup({
    identityKeyPath,
    authenticatedPrincipalEvidence,
}) {
    const key = await readPrivateSecret(identityKeyPath);
    const keyFingerprintSha256 = `sha256:${createHash('sha256')
        .update(key)
        .digest('hex')}`;
    let closed = false;
    let invalidated = false;
    let verified = verifiedPrincipal(authenticatedPrincipalEvidence);
    let identityGroupId = verified
        ? `hmac-sha256:${createHmac('sha256', key)
              .update(verified.canonicalPrincipal)
              .digest('hex')}`
        : undefined;

    function status() {
        return Object.freeze({
            state: closed
                ? 'closed_fail_closed'
                : invalidated
                  ? 'mapping_conflict_fail_closed'
                  : verified
                    ? 'authenticated'
                    : 'principal_unavailable_fail_closed',
            identityGroupSha256: identityGroupId
                ? `sha256:${createHash('sha256')
                      .update(identityGroupId)
                      .digest('hex')}`
                : null,
            fixedAccountCount: verified?.accountScopes.length ?? 0,
            writeMasterAuthority: false,
            brokerWriteAuthority: false,
            rawPrincipalExposed: false,
            secretValuesExposed: false,
        });
    }

    return Object.freeze({
        status,
        acceptPrincipalEvidence(value) {
            if (closed) throw new Error('authenticated identity group is closed');
            if (invalidated) {
                throw new Error(
                    'authenticated identity mapping is invalidated; reconciliation required',
                );
            }
            const next = verifiedPrincipal(value);
            if (!next) {
                throw new Error(
                    'broker-authenticated canonical principal is unavailable',
                );
            }
            if (verified) {
                if (verifiedProjection(next) !== verifiedProjection(verified)) {
                    invalidated = true;
                    verified = undefined;
                    identityGroupId = undefined;
                    throw new Error(
                        'authenticated identity mapping changed; reconciliation required',
                    );
                }
                return status();
            }
            verified = next;
            identityGroupId = `hmac-sha256:${createHmac('sha256', key)
                .update(verified.canonicalPrincipal)
                .digest('hex')}`;
            return status();
        },
        invalidatePrincipalEvidence() {
            if (closed) throw new Error('authenticated identity group is closed');
            invalidated = true;
            verified = undefined;
            identityGroupId = undefined;
            return status();
        },
        issueAdmission(input) {
            if (closed) throw new Error('authenticated identity group is closed');
            if (invalidated || !verified || !identityGroupId) {
                throw new Error(
                    'broker-authenticated canonical principal is unavailable',
                );
            }
            const snapshot = exactOwnDataSnapshot(
                input,
                ['accountBrokerRef', 'accountIdRef', 'nowEpochMs'],
                'identityAdmissionRequest',
            );
            const scope = accountScope(
                {
                    accountBrokerRef: snapshot.accountBrokerRef,
                    accountIdRef: snapshot.accountIdRef,
                },
                'identityAdmissionRequest',
            );
            if (
                !Number.isSafeInteger(snapshot.nowEpochMs) ||
                snapshot.nowEpochMs < 0
            ) {
                throw new TypeError('identity admission time is invalid');
            }
            if (
                !verified.accountScopes.some(
                    (candidate) =>
                        candidate.accountBrokerRef === scope.accountBrokerRef &&
                        candidate.accountIdRef === scope.accountIdRef,
                )
            ) {
                throw new Error(
                    'fixed account is not bound to the authenticated principal',
                );
            }
            const unsigned = Object.freeze({
                schemaVersion:
                    SMART_ORDER_AUTHENTICATED_IDENTITY_ADMISSION_SCHEMA_VERSION,
                accountBrokerRef: scope.accountBrokerRef,
                accountIdRef: scope.accountIdRef,
                identityGroupId,
                identityKeyFingerprintSha256: keyFingerprintSha256,
                principalEvidenceHash: verified.principalEvidenceHash,
                mappingRevision: verified.mappingRevision,
                issuedAtEpochMs: snapshot.nowEpochMs,
            });
            const admissionHmacSha256 = `hmac-sha256:${createHmac('sha256', key)
                .update(canonicalJson(unsigned))
                .digest('hex')}`;
            return Object.freeze({ ...unsigned, admissionHmacSha256 });
        },
        close() {
            if (!closed) key.fill(0);
            closed = true;
        },
    });
}

export function authenticatedIdentityAdmissionUnsignedForVerification(value) {
    return admissionUnsigned(value);
}
