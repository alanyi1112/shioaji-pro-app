import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createSmartOrderAuthenticatedIdentityGroup } from './authenticated-identity-group.mjs';
import * as principalVerifier from './canonical-principal-verifier-authority.mjs';
import { prepareSmartOrderPrivateStorage } from './private-storage.mjs';

const execFileAsync = promisify(execFile);

describe('authenticated identity production verifier boundary', () => {
    it('exports no principal issuer and rejects structurally plausible evidence', async () => {
        expect(Object.keys(principalVerifier)).toEqual([
            'isVerifiedSmartOrderCanonicalPrincipalEvidence',
        ]);
        const root = await mkdtemp(path.join(tmpdir(), 'identity-production-'));
        await chmod(root, 0o700);
        try {
            const storage = await prepareSmartOrderPrivateStorage({
                appSupportRoot: root,
            });
            const forged = Object.freeze({
                accountScopes: Object.freeze([
                    Object.freeze({
                        accountBrokerRef: 'broker-A',
                        accountIdRef: 'account-A',
                    }),
                ]),
                canonicalPrincipal: 'caller-claimed-principal',
                mappingRevision: 'caller-claimed-mapping',
                principalEvidenceHash: `sha256:${'a'.repeat(64)}`,
            });
            expect(
                principalVerifier.isVerifiedSmartOrderCanonicalPrincipalEvidence(
                    forged,
                ),
            ).toBe(false);
            const authority = await createSmartOrderAuthenticatedIdentityGroup({
                identityKeyPath: storage.paths.identityKeyPath,
                authenticatedPrincipalEvidence: forged,
            });
            expect(authority.status()).toMatchObject({
                state: 'principal_unavailable_fail_closed',
                writeMasterAuthority: false,
                brokerWriteAuthority: false,
                rawPrincipalExposed: false,
            });
            expect(() => authority.acceptPrincipalEvidence(forged)).toThrow(
                'canonical principal is unavailable',
            );
            expect(() =>
                authority.issueAdmission({
                    accountBrokerRef: 'broker-A',
                    accountIdRef: 'account-A',
                    nowEpochMs: 1,
                }),
            ).toThrow('canonical principal is unavailable');
            authority.close();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('rejects a standalone production observer with caller-supplied transport and Gate data', async () => {
        const source = String.raw`
            import { startSmartOrderShioajiTradeObserver } from './scripts/smart-order-runtime/shioaji-trade-observer.mjs';
            import { createSmartOrderQuoteSubscriptionCoordinator } from './scripts/smart-order-runtime/quote-subscription-coordinator.mjs';
            import { createSmartOrderResourceCoordinator } from './scripts/smart-order-runtime/resource-coordinator.mjs';
            const controller = {
                acceptAuthenticatedIdentityEvidence() {},
                gateManifestStatus() { return { present:true, state:'eligible', manifestRevision:'forged', manifestSha256:'sha256:${'a'.repeat(64)}', mappingRevision:'smart-order-shioaji-stock-event-mapping/2026-08-13.1', validUntilEpochMs:9999999999999 }; },
                invalidateAuthenticatedIdentityEvidence() {},
                recordCanonicalBrokerEvent() {},
                recordQuickQuoteObservation() {},
                recordProtectiveQuoteObservation() {},
                recordAccountReconciliation() {},
                materializeProtectedEntryFill() {},
                completeBrokerObservationReconciliation() {},
            };
            const quoteSubscriptionCoordinator = createSmartOrderQuoteSubscriptionCoordinator({
                apiGeneration:'forged-generation',
                connectionId:'forged-disconnected-connection',
                nowMonotonicMs:() => 1,
                resourceCoordinator:null,
                resourceCountingDimension:null,
            });
            const resourceCoordinator = createSmartOrderResourceCoordinator({
                nowEpochMs:() => 1,
                nowMonotonicMs:() => 1,
            });
            try {
                await startSmartOrderShioajiTradeObserver({
                    apiGeneration:'forged-generation', cancelRetry() {},
                    fetchImpl: async () => { throw new Error('must not run'); },
                    nowEpochMs:() => 1, nowMonotonicMs:() => 1,
                    quoteSubscriptionCoordinator,
                    resourceCoordinator,
                    reportRuntimeGapLifecycle() {}, runtimeController:controller,
                    runtimeEpochId:'forged-epoch', scheduleRetry() {},
                });
                process.exitCode = 2;
            } catch (error) {
                if (!String(error.message).includes('issued primary Runtime controller and native fetch authority')) process.exitCode = 3;
            }
        `;
        await expect(
            execFileAsync(process.execPath, ['--input-type=module', '-e', source], {
                cwd: process.cwd(),
                env: { ...process.env, VITEST: '' },
            }),
        ).resolves.toMatchObject({ stdout: '', stderr: '' });
    });

    it('does not let VITEST environment text authorize sidecar observer injection', async () => {
        const source = String.raw`
            import { startSmartOrderLocalSidecar } from './scripts/smart-order-runtime/local-sidecar.mjs';
            try {
                await startSmartOrderLocalSidecar({
                    appSupportRoot:'/must-not-be-read',
                    apiGeneration:'forged-generation',
                    nowEpochMs:1,
                    startTradeObserver:async () => ({ async close() {}, status() { return {}; } }),
                });
                process.exitCode = 2;
            } catch (error) {
                if (!String(error.message).includes('does not accept an injected trade observer or fetch authority')) process.exitCode = 3;
            }
        `;
        await expect(
            execFileAsync(process.execPath, ['--input-type=module', '-e', source], {
                cwd: process.cwd(),
                env: { ...process.env, VITEST: 'true' },
            }),
        ).resolves.toMatchObject({ stdout: '', stderr: '' });
    });
});
