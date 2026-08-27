import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileSmartOrderTask03bHistoricalUpdate } from './smart-order-runtime/task0-3b-update-reconciliation.mjs';

export async function runSmartOrderTask03bUpdateReconciliation({
    appSupportRoot = process.env.REALTIME_STOCK_APP_SUPPORT,
    expectedApiGeneration = process.env.REALTIME_STOCK_EXPECTED_API_GENERATION,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    verifyOnly = false,
} = {}) {
    return reconcileSmartOrderTask03bHistoricalUpdate({
        appSupportRoot,
        expectedApiGeneration,
        fetchImpl,
        now,
        verifyOnly,
    });
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--verify-only')) {
        throw new Error(
            'Task 0.3b update reconciliation accepts only --verify-only',
        );
    }
    const result = await runSmartOrderTask03bUpdateReconciliation({
        appSupportRoot: process.env.REALTIME_STOCK_APP_SUPPORT,
        expectedApiGeneration:
            process.env.REALTIME_STOCK_EXPECTED_API_GENERATION,
        verifyOnly: args[0] === '--verify-only',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((error) => {
        process.stderr.write(
            `Task 0.3b update reconciliation blocked: ${
                error?.message ?? 'unknown'
            }\n`,
        );
        process.exitCode = 1;
    });
}
