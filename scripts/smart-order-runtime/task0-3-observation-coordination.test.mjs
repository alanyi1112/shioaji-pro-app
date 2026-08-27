import { randomBytes } from 'node:crypto';
import {
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    bindTask03ObserverLiveness,
    task03CorrelatedEventEvidence,
} from '../smart-order-contract-probe.mjs';
import {
    createTask03ObservationCoordination,
    SMART_ORDER_TASK_0_3_MAX_OBSERVER_LIFETIME_MS,
    task03TradeIdentitySha256,
} from './task0-3-observation-coordination.mjs';

const roots = [];
const coordinators = [];
const coordinationId = '123e4567-e89b-42d3-a456-426614174099';
const accountScopeSha256 = `sha256:${'a'.repeat(64)}`;
const requestSha256 = `sha256:${'b'.repeat(64)}`;
const account = {
    broker_id: 'SIM-BROKER',
    account_id: 'SIM-ACCOUNT',
    account_type: 'S',
};

afterEach(async () => {
    await Promise.all(
        coordinators.splice(0).map((coordinator) =>
            coordinator.closeReadiness().catch(() => {}),
        ),
    );
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'task03-coordination-'));
    roots.push(root);
    await chmod(root, 0o700);
    const privateDirectory = path.join(root, 'smart-order', 'private');
    await mkdir(privateDirectory, {
        recursive: true,
        mode: 0o700,
    });
    await chmod(privateDirectory, 0o700);
    await writeFile(
        path.join(privateDirectory, 'gate-probe-cli-capability.bin'),
        randomBytes(32),
        { mode: 0o600 },
    );
    const coordination = createTask03ObservationCoordination({
        accountScopeSha256,
        appSupportRoot: await realpath(root),
        coordinationId,
        requestSha256,
    });
    coordinators.push(coordination);
    return coordination;
}

describe('Task 0.3 observer/trigger coordination', () => {
    it('exposes a module-issued abort signal for pre-dispatch observer shutdown', async () => {
        const coordination = await fixture();
        expect(coordination.observationAbortSignal.aborted).toBe(false);
        coordination.abortObservation();
        expect(coordination.observationAbortSignal.aborted).toBe(true);
    });

    it('allows the five-minute prompt window but rejects an overlong observer', async () => {
        expect(SMART_ORDER_TASK_0_3_MAX_OBSERVER_LIFETIME_MS).toBe(360_000);
        const accepted = await fixture();
        await expect(
            accepted.signalReady({
                observerDeadlineEpochMs: Date.now() + 330_000,
            }),
        ).resolves.toBeUndefined();

        const rejected = await fixture();
        await expect(
            rejected.signalReady({
                observerDeadlineEpochMs: Date.now() + 400_000,
            }),
        ).rejects.toThrow('deadline is invalid');
    });

    it('uses hash-only durable readiness and response identity proof', async () => {
        const runnerCoordination = await fixture();
        await runnerCoordination.signalReady({
            observerDeadlineEpochMs: Date.now() + 30_000,
        });
        const triggerCoordination = createTask03ObservationCoordination({
            accountScopeSha256,
            appSupportRoot: await realpath(roots[0]),
            coordinationId,
            requestSha256,
        });
        coordinators.push(triggerCoordination);
        await expect(triggerCoordination.waitForReady()).resolves.toMatchObject({
            coordinationId,
            accountScopeSha256,
            requestSha256,
            brokerWriteAttempted: false,
            accountIdentifiersPersisted: false,
        });
        const tradeIdentitySha256 = task03TradeIdentitySha256(
            account,
            'task03-trade-1',
        );
        await triggerCoordination.writeProof({
            resultEvidenceSha256: `sha256:${'c'.repeat(64)}`,
            state: 'confirmed',
            tradeIdentitySha256,
        });
        await expect(runnerCoordination.readProof()).resolves.toMatchObject({
            coordinationId,
            tradeIdentitySha256,
            resultEvidenceSha256: `sha256:${'c'.repeat(64)}`,
            state: 'confirmed',
            brokerWriteAttempted: true,
            accountIdentifiersPersisted: false,
        });
        const privateDirectory = path.join(
            roots[0],
            'smart-order',
            'private',
        );
        for (const name of [
            `task0-3-observer-ready-${coordinationId}.json`,
            `task0-3-trigger-proof-${coordinationId}.json`,
        ]) {
            const filePath = path.join(privateDirectory, name);
            expect((await stat(filePath)).mode & 0o777).toBe(0o600);
            const serialized = await readFile(filePath, 'utf8');
            expect(serialized).not.toContain(account.broker_id);
            expect(serialized).not.toContain(account.account_id);
        }
    });

    it('accepts only the response-linked event identity, never another same-account event', () => {
        const expected = task03TradeIdentitySha256(account, 'task03-trade-1');
        const unrelated = task03TradeIdentitySha256(account, 'other-trade');
        expect(
            task03CorrelatedEventEvidence(
                { eventIdentitySha256s: [unrelated] },
                { tradeIdentitySha256: expected },
            ),
        ).toBe(false);
        expect(
            task03CorrelatedEventEvidence(
                { eventIdentitySha256s: [unrelated, expected] },
                { tradeIdentitySha256: expected },
            ),
        ).toBe(true);
    });

    it('rejects a forged readiness HMAC and a closed observer liveness channel', async () => {
        const forged = await fixture();
        await forged.signalReady({
            observerDeadlineEpochMs: Date.now() + 30_000,
        });
        const readinessPath = path.join(
            roots[0],
            'smart-order',
            'private',
            `task0-3-observer-ready-${coordinationId}.json`,
        );
        const readiness = JSON.parse(await readFile(readinessPath, 'utf8'));
        readiness.readinessHmacSha256 = `sha256:${'0'.repeat(64)}`;
        await writeFile(readinessPath, `${JSON.stringify(readiness)}\n`, {
            mode: 0o600,
        });
        await expect(forged.waitForReady()).rejects.toThrow('HMAC');

        await forged.closeReadiness();
        coordinators.splice(coordinators.indexOf(forged), 1);
        await rm(roots.shift(), { recursive: true, force: true });
        const closed = await fixture();
        await closed.signalReady({
            observerDeadlineEpochMs: Date.now() + 30_000,
        });
        await closed.waitForReady();
        await closed.expireReadinessLiveness();
        await expect(closed.revalidateReady()).rejects.toThrow();
    });

    it('fails closed on concurrent readiness or proof writers', async () => {
        const coordination = await fixture();
        const readiness = await Promise.allSettled([
            coordination.signalReady({
                observerDeadlineEpochMs: Date.now() + 30_000,
            }),
            coordination.signalReady({
                observerDeadlineEpochMs: Date.now() + 30_000,
            }),
        ]);
        expect(readiness.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(readiness.filter((result) => result.status === 'rejected')).toEqual([
            expect.objectContaining({
                reason: expect.objectContaining({
                    message: 'Task 0.3 observer readiness signal is already claimed',
                }),
            }),
        ]);
        await coordination.waitForReady();
        const tradeIdentitySha256 = task03TradeIdentitySha256(
            account,
            'task03-trade-1',
        );
        const proofs = await Promise.allSettled([
            coordination.writeProof({
                resultEvidenceSha256: `sha256:${'c'.repeat(64)}`,
                state: 'confirmed',
                tradeIdentitySha256,
            }),
            coordination.writeProof({
                resultEvidenceSha256: `sha256:${'c'.repeat(64)}`,
                state: 'confirmed',
                tradeIdentitySha256,
            }),
        ]);
        expect(proofs.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    });

    it('rejects a forged terminal proof HMAC', async () => {
        const coordination = await fixture();
        await coordination.signalReady({
            observerDeadlineEpochMs: Date.now() + 30_000,
        });
        await coordination.waitForReady();
        await coordination.writeProof({
            resultEvidenceSha256: `sha256:${'c'.repeat(64)}`,
            state: 'confirmed',
            tradeIdentitySha256: task03TradeIdentitySha256(
                account,
                'task03-trade-1',
            ),
        });
        const proofPath = path.join(
            roots[0],
            'smart-order',
            'private',
            `task0-3-trigger-proof-${coordinationId}.json`,
        );
        const proof = JSON.parse(await readFile(proofPath, 'utf8'));
        proof.proofHmacSha256 = `sha256:${'0'.repeat(64)}`;
        await writeFile(proofPath, `${JSON.stringify(proof)}\n`, { mode: 0o600 });
        await expect(coordination.readProof({ timeoutMs: 100 })).rejects.toThrow(
            'proof HMAC',
        );
    });

    it('revokes the authenticated liveness channel as soon as the SSE observer settles', async () => {
        const coordination = await fixture();
        await coordination.signalReady({
            observerDeadlineEpochMs: Date.now() + 30_000,
        });
        await coordination.waitForReady();
        let settleObserver;
        const observer = {
            result: new Promise((resolve) => {
                settleObserver = resolve;
            }),
        };
        const revoked = bindTask03ObserverLiveness(observer, coordination);
        settleObserver({ observedCount: 0 });
        await revoked;
        await expect(
            coordination.revalidateReady({ minimumRemainingMs: 10_000 }),
        ).rejects.toThrow();
    });
});
