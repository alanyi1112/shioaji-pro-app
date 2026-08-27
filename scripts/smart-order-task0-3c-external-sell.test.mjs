import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runSmartOrderTask03cExternalSell } from './smart-order-task0-3c-external-sell.mjs';

const RUNNER_URL = new URL('./smart-order-task0-3c-external-sell.mjs', import.meta.url);
const EXECUTOR_URL = new URL('./smart-order-runtime/task0-3b-operation-executor.mjs', import.meta.url);
const FINALIZER_URL = new URL('./smart-order-task0-3c-finalize.mjs', import.meta.url);
const RUNTIME_URL = new URL('./realtimestock-runtime', import.meta.url);

describe('Task 0.3c external simulation client boundary', () => {
    it('rejects incomplete or cross-ordinal arguments before live discovery', async () => {
        await expect(
            runSmartOrderTask03cExternalSell({ args: [] }),
        ).rejects.toThrow('arguments');
        await expect(
            runSmartOrderTask03cExternalSell({
                args: [
                    '--ordinal=1',
                    '--run-id=123e4567-e89b-42d3-a456-426614174660',
                    '--operation-id=123e4567-e89b-42d3-a456-426614174661',
                    '--nonce=123e4567-e89b-42d3-a456-426614174662',
                    `--account-scope=sha256:${'a'.repeat(64)}`,
                    '--previous-target=/tmp/foreign.json',
                ],
            }),
        ).rejects.toThrow('arguments');
    });

    it('orders stopped-sidecar preflight, observer readiness, preparation and one executor', async () => {
        const source = await readFile(RUNNER_URL, 'utf8');
        const stopped = source.indexOf('await assertSidecarStopped(appSupportRoot);');
        const candidate = source.indexOf(
            'prepareSmartOrderTask03cCandidateOperation({',
        );
        const readiness = source.indexOf(
            'triggerCoordination.waitForReady({',
            candidate,
        );
        const prepared = source.indexOf(
            'prepareSmartOrderTask03cOperationAfterObserver({',
            readiness,
        );
        const execute = source.indexOf(
            'executePreparedSmartOrderTask03cOperation({',
            prepared,
        );
        const observer = source.indexOf(
            'const observerResult = await observerPromise;',
            execute,
        );
        expect(stopped).toBeGreaterThan(0);
        expect(candidate).toBeGreaterThan(stopped);
        expect(readiness).toBeGreaterThan(candidate);
        expect(prepared).toBeGreaterThan(readiness);
        expect(execute).toBeGreaterThan(prepared);
        expect(observer).toBeGreaterThan(execute);
        expect(source).toContain("eventCheck?.status !== 'pass'");
    });

    it('rechecks stopped sidecar immediately before its sole no-retry write', async () => {
        const source = await readFile(EXECUTOR_URL, 'utf8');
        const ledger = source.indexOf('ledgerDurable = true;');
        const stopped = source.lastIndexOf(
            'if (isTask03c) await assertTask03cSidecarStopped(appSupportRoot);',
            source.indexOf('await transport.write(canonical.request, receipt)'),
        );
        const write = source.indexOf(
            'await transport.write(canonical.request, receipt)',
        );
        expect(stopped).toBeGreaterThan(ledger);
        expect(write).toBeGreaterThan(stopped);
        expect(source.match(/transport\.write\(/g)).toHaveLength(1);
        expect(source).toContain("? 'reduce_only_protection'");
        expect(source).toContain('automaticRetryAllowed: false');
        expect(source).toContain('blindCleanupAllowed: false');
    });

    it('wrapper refuses a loaded sidecar, live discovery, pending barrier, or non-simulation API', async () => {
        const source = await readFile(RUNTIME_URL, 'utf8');
        const body = source.match(
            /run_smart_order_task0_3c_external_sell\(\) \{([\s\S]*?)\n\}/,
        )?.[1];
        expect(body).toContain('job_loaded "${SMART_ORDER_LABEL}"');
        expect(body).toContain('SMART_ORDER_DISCOVERY_PATH');
        expect(body).toContain('SMART_ORDER_LIFECYCLE_STOP_BARRIER_PATH');
        expect(body).toContain("[[ \"${mode_state}\" != 'simulation' ]]");
        expect(body).toContain("jq -e '.simulation == true'");
        expect(body).toContain(
            '"${NODE_BIN}" "${SMART_ORDER_TASK_0_3C_EXTERNAL_SELL}"',
        );
        expect(source).toContain('task0-3c-external-sell)');
        const preflightBody = source.match(
            /run_smart_order_task0_3c_preflight\(\) \{([\s\S]*?)\n\}/,
        )?.[1];
        expect(preflightBody).toContain('job_loaded "${SMART_ORDER_LABEL}"');
        expect(preflightBody).toContain('strict_smart_order_discovery_epoch');
        expect(preflightBody).toContain(
            '"${NODE_BIN}" "${SMART_ORDER_TASK_0_3C_PREFLIGHT}"',
        );
        expect(source).toContain('task0-3c-preflight)');
    });

    it('finalizer requires two expected claims on a post-restart current head', async () => {
        const source = await readFile(FINALIZER_URL, 'utf8');
        expect(source).toContain('claims.length !== 2');
        expect(source).toContain(
            'canonicalJson(claims.map((claim) => claim.exit_claim_id))',
        );
        expect(source).toContain(
            'head.observed_at_epoch_ms < discovery.startedAtEpochMs',
        );
        expect(source).toContain("claim.state !== 'broker_working'");
        expect(source).toContain(
            "'task13-2-formal-0.3c-external-working-sells-complete.json'",
        );
    });
});
