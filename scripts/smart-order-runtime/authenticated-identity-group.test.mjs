import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const verifier = vi.hoisted(() => ({ evidence: new WeakSet() }));
vi.mock('./canonical-principal-verifier-authority.mjs', () => ({
    isVerifiedSmartOrderCanonicalPrincipalEvidence(value) {
        return verifier.evidence.has(value);
    },
}));

import { createSmartOrderAuthenticatedIdentityGroup } from './authenticated-identity-group.mjs';
import { prepareSmartOrderPrivateStorage } from './private-storage.mjs';

const roots = [];
const DIGEST = `sha256:${'a'.repeat(64)}`;

afterEach(async () => {
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'smart-order-identity-'));
    roots.push(root);
    await chmod(root, 0o700);
    const storage = await prepareSmartOrderPrivateStorage({ appSupportRoot: root });
    const evidence = Object.freeze({
        accountScopes: Object.freeze([
            Object.freeze({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
            }),
            Object.freeze({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-B',
            }),
        ]),
        canonicalPrincipal: 'broker-authenticated-principal',
        mappingRevision: 'mapping/1',
        principalEvidenceHash: DIGEST,
    });
    verifier.evidence.add(evidence);
    return { storage, evidence };
}

describe('authenticated smart-order identity group', () => {
    it('derives the same full HMAC group across restart and binds all fixed accounts', async () => {
        const { storage, evidence } = await fixture();
        const first = await createSmartOrderAuthenticatedIdentityGroup({
            identityKeyPath: storage.paths.identityKeyPath,
            authenticatedPrincipalEvidence: evidence,
        });
        const admissionA = first.issueAdmission({
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-A',
            nowEpochMs: 100,
        });
        first.close();
        const second = await createSmartOrderAuthenticatedIdentityGroup({
            identityKeyPath: storage.paths.identityKeyPath,
            authenticatedPrincipalEvidence: evidence,
        });
        const admissionB = second.issueAdmission({
            accountBrokerRef: 'broker-A',
            accountIdRef: 'account-B',
            nowEpochMs: 200,
        });
        expect(admissionA.identityGroupId).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
        expect(admissionB.identityGroupId).toBe(admissionA.identityGroupId);
        expect(admissionA.admissionHmacSha256).toMatch(
            /^hmac-sha256:[0-9a-f]{64}$/,
        );
        expect(JSON.stringify(second.status())).not.toContain(
            evidence.canonicalPrincipal,
        );
        second.close();
    });

    it('fails closed for unverified principal, unknown accounts, clones, and accessors', async () => {
        const { storage, evidence } = await fixture();
        const unverified = await createSmartOrderAuthenticatedIdentityGroup({
            identityKeyPath: storage.paths.identityKeyPath,
            authenticatedPrincipalEvidence: { ...evidence },
        });
        expect(unverified.status().state).toBe(
            'principal_unavailable_fail_closed',
        );
        expect(() =>
            unverified.issueAdmission({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-A',
                nowEpochMs: 1,
            }),
        ).toThrow('canonical principal is unavailable');
        unverified.close();

        const authority = await createSmartOrderAuthenticatedIdentityGroup({
            identityKeyPath: storage.paths.identityKeyPath,
            authenticatedPrincipalEvidence: evidence,
        });
        expect(() =>
            authority.issueAdmission({
                accountBrokerRef: 'broker-A',
                accountIdRef: 'account-C',
                nowEpochMs: 1,
            }),
        ).toThrow('not bound');
        let reads = 0;
        const hostile = { accountBrokerRef: 'broker-A', nowEpochMs: 1 };
        Object.defineProperty(hostile, 'accountIdRef', {
            enumerable: true,
            get() {
                reads += 1;
                return 'account-A';
            },
        });
        expect(() => authority.issueAdmission(hostile)).toThrow(
            'own data property',
        );
        expect(reads).toBe(0);
        expect(() =>
            authority.issueAdmission(
                new Proxy(
                    {
                        accountBrokerRef: 'broker-A',
                        accountIdRef: 'account-A',
                        nowEpochMs: 1,
                    },
                    {},
                ),
            ),
        ).toThrow('exact object');
        authority.close();
    });
});
