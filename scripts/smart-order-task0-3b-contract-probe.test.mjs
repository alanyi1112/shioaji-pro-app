import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runSmartOrderTask03bContractProbe } from './smart-order-task0-3b-contract-probe.mjs';

const RUNNER_URL = new URL('./smart-order-task0-3b-contract-probe.mjs', import.meta.url);
const EXECUTOR_URL = new URL('./smart-order-runtime/task0-3b-operation-executor.mjs', import.meta.url);
const WRITE_PREFLIGHT_URL = new URL(
    './smart-order-runtime/task-probe-write-preflight.mjs',
    import.meta.url,
);
const RUNTIME_URL = new URL('./realtimestock-runtime', import.meta.url);

describe('Task 0.3b production contract probe boundary', () => {
    it('rejects incomplete and confused operation arguments before live discovery', async () => {
        await expect(
            runSmartOrderTask03bContractProbe({ args: [] }),
        ).rejects.toThrow('arguments');
        await expect(
            runSmartOrderTask03bContractProbe({
                args: [
                    '--operation=place',
                    '--run-id=123e4567-e89b-42d3-a456-426614174000',
                    '--operation-id=123e4567-e89b-42d3-a456-426614174001',
                    '--nonce=123e4567-e89b-42d3-a456-426614174002',
                    `--account-scope=sha256:${'a'.repeat(64)}`,
                    '--target=/tmp/foreign.json',
                ],
            }),
        ).rejects.toThrow('arguments');
    });

    it('keeps candidate authorization hidden until exact observer readiness', async () => {
        const source = await readFile(RUNNER_URL, 'utf8');
        const candidate = source.indexOf('prepareSmartOrderTask03bCandidateOperation({');
        const observer = source.indexOf(
            'createTask03ObservationCoordination(',
            candidate,
        );
        const wait = source.indexOf('triggerCoordination.waitForReady({');
        const prepared = source.indexOf('prepareSmartOrderTask03bOperationAfterObserver({');
        const execute = source.indexOf('executePreparedSmartOrderTask03bOperation({');
        expect(candidate).toBeGreaterThan(0);
        expect(observer).toBeGreaterThan(candidate);
        expect(wait).toBeGreaterThan(observer);
        expect(prepared).toBeGreaterThan(wait);
        expect(execute).toBeGreaterThan(prepared);
        expect(source).not.toContain('115 ROD');
        expect(source).not.toContain('REALTIME_STOCK_EXPECTED_PRICE');
    });

    it('serializes the fixed account and latches no-retry before the one transport write', async () => {
        const source = await readFile(EXECUTOR_URL, 'utf8');
        const projection = source.indexOf('brokerId: prepared.account.broker_id');
        const lock = source.indexOf('withNodeSafeBrokerAccountLock(nodeSafeLockAccount');
        const ledger = source.indexOf('ledgerDurable = true;');
        const dispatch = source.indexOf('resourceCoordinator.markOperationDispatching({');
        const write = source.indexOf('await transport.write(canonical.request, receipt)');
        const proof = source.indexOf('await observerCoordination.writeProof({');
        const formalAuthority = source.indexOf("stage = 'formal_evidence_authority';");
        const authorization = source.indexOf("stage = 'cli_authorization';");
        const authorizationSummary = source.indexOf(
            'task0_3b_authorization_summary=',
            authorization,
        );
        const formalWrite = source.indexOf(
            '`task13-2-formal-0.3b-${operationKey.replaceAll',
        );
        const complete = source.indexOf('resourceCoordinator.completeOperation({ operationId })');
        expect(projection).toBeGreaterThan(0);
        expect(lock).toBeGreaterThan(projection);
        expect(dispatch).toBeGreaterThan(ledger);
        expect(write).toBeGreaterThan(dispatch);
        expect(proof).toBeGreaterThan(write);
        expect(formalAuthority).toBeGreaterThan(lock);
        expect(authorization).toBeGreaterThan(formalAuthority);
        expect(authorizationSummary).toBeGreaterThan(authorization);
        expect(formalWrite).toBeGreaterThan(proof);
        expect(source).toContain(
            "-${prepared.marketPlan.runId}-${operationId}.json`",
        );
        expect(complete).toBeGreaterThan(proof);
        expect(source.match(/transport\.write\(/g)).toHaveLength(1);
        expect(source).toContain('automaticRetryAllowed: false');
        expect(source).toContain('blindCleanupAllowed: false');
        expect(source).toContain('runSmartOrderTaskProbeAdjacentRevalidation({');
        expect(source).toContain(
            'evidenceSha256:\n                prepared.readonlyProjection.observerReadinessSha256',
        );
        expect(source).not.toContain(
            "stage = 'authorization_adjacent_readonly';\n        const adjacentReadonly = await runSmartOrderTaskProbeReadonlyPreflight({",
        );
        expect(source).toContain(
            'blocked.brokerWriteMayHaveBeenAttempted = ledgerDurable',
        );
    });

    it('binds the long-lived observer implementation into the exact write source fingerprint', async () => {
        const source = await readFile(WRITE_PREFLIGHT_URL, 'utf8');
        expect(source).toContain("'../smart-order-contract-probe.mjs'");
        expect(source).toContain("'./task0-3-observation-coordination.mjs'");
    });

    it('requires an exact correlated observer event for every confirmed operation', async () => {
        const source = await readFile(RUNNER_URL, 'utf8');
        const execute = source.indexOf('executePreparedSmartOrderTask03bOperation({');
        const observer = source.indexOf('const observerResult = await observerPromise;', execute);
        const event = source.indexOf("check?.id === 'order-event-account'", observer);
        const pass = source.indexOf("eventCheck?.status !== 'pass'", event);
        expect(observer).toBeGreaterThan(execute);
        expect(event).toBeGreaterThan(observer);
        expect(pass).toBeGreaterThan(event);
        expect(source).toContain(
            'if (!brokerWriteMayHaveBeenAttempted) {\n            observerCoordination.abortObservation();',
        );
    });

    it('is reachable only through the managed runtime wrapper preflight', async () => {
        const source = await readFile(RUNTIME_URL, 'utf8');
        const fn = source.indexOf('run_smart_order_task0_3b_probe()');
        const preflight = source.indexOf(
            'preflight_persisted_smart_order_runtime_contract',
            fn,
        );
        const exec = source.indexOf('"${NODE_BIN}" "${SMART_ORDER_TASK_0_3B_PROBE}"', fn);
        expect(fn).toBeGreaterThan(0);
        expect(preflight).toBeGreaterThan(fn);
        expect(exec).toBeGreaterThan(preflight);
        expect(source).toContain('task0-3b-probe)');
    });
});
