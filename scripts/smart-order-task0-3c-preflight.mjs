#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
    buildSmartOrderTaskProbeMarketPlan,
} from './smart-order-runtime/task-probe-market-plan.mjs';
import {
    consumeSmartOrderTaskProbeReadonlyAuthority,
    runSmartOrderTaskProbeReadonlyPreflight,
} from './smart-order-runtime/task-probe-readonly-preflight.mjs';
import { smartOrderTask03cCustomField } from './smart-order-runtime/task0-3c-operation-contract.mjs';
import { assertSmartOrderTask03cExternalSellBaseline } from './smart-order-runtime/task0-3c-working-set.mjs';
import { managedSmartOrderReadonlyProbeAppSupportRoot } from './smart-order-contract-probe.mjs';

export const SMART_ORDER_TASK_0_3C_PREFLIGHT_SCHEMA_VERSION =
    'smart-order-task-0.3c-readonly-preflight/2026-08-27.1';

async function readGeneration(appSupportRoot) {
    const handle = await open(
        path.join(appSupportRoot, 'runtime-api-generation'),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
        const metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 1 ||
            metadata.size > 512 ||
            (metadata.mode & 0o777) !== 0o600
        ) {
            throw new Error('Task 0.3c generation metadata is invalid');
        }
        const value = (await handle.readFile('utf8')).trim();
        if (!/^simulation:[A-Za-z0-9._:-]{1,240}$/.test(value)) {
            throw new Error('Task 0.3c generation is not simulation');
        }
        return value;
    } finally {
        await handle.close();
    }
}

function marketPlan(projection, runId, operationOrdinal, nowEpochMs) {
    return buildSmartOrderTaskProbeMarketPlan({
        schemaVersion: SMART_ORDER_TASK_PROBE_MARKET_PLAN_SCHEMA_VERSION,
        taskId: '0.3c',
        runId,
        operation: 'place',
        purpose: 'working_non_marketable',
        side: 'Sell',
        priceType: 'LMT',
        timeInForce: 'ROD',
        priceOrdinal: operationOrdinal,
        quantityCommonLots: 1,
        accountScopeSha256: projection.accountScopeSha256,
        tradeDate: projection.tradeDate,
        sourceFingerprintSha256: projection.sourceFingerprintSha256,
        apiGenerationSha256: projection.apiGenerationSha256,
        positionsSha256: projection.positionsSha256,
        workingOrdersSha256: projection.workingOrdersSha256,
        nowEpochMs,
        target: null,
        contract: projection.contract,
        quote: projection.quote,
    }).plan;
}

export async function runSmartOrderTask03cReadonlyPreflight({
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    runId = randomUUID(),
} = {}) {
    const appSupportRoot = await realpath(
        managedSmartOrderReadonlyProbeAppSupportRoot(),
    );
    const expectedApiGeneration = await readGeneration(appSupportRoot);
    const readonly = await runSmartOrderTaskProbeReadonlyPreflight({
        appSupportRoot,
        expectedApiGeneration,
        candidateOnly: true,
        fetchImpl,
        now,
    });
    const privateReadonly = consumeSmartOrderTaskProbeReadonlyAuthority(
        readonly.authority,
    );
    const baseline = assertSmartOrderTask03cExternalSellBaseline({
        account: privateReadonly.account,
        contractUnit: privateReadonly.contract.contractUnit,
        expectedCustomField: smartOrderTask03cCustomField(runId, 1),
        operationOrdinal: 1,
        positions: privateReadonly.positions,
        previousTargets: [],
        trades: privateReadonly.trades,
    });
    const observedAtEpochMs = now();
    const first = marketPlan(
        readonly.projection,
        runId,
        1,
        observedAtEpochMs,
    );
    const second = marketPlan(
        readonly.projection,
        runId,
        2,
        observedAtEpochMs,
    );
    return Object.freeze({
        schemaVersion: SMART_ORDER_TASK_0_3C_PREFLIGHT_SCHEMA_VERSION,
        eligible: true,
        runId,
        accountScopeSha256: readonly.projection.accountScopeSha256,
        accountRef: readonly.projection.accountRef,
        tradeDate: readonly.projection.tradeDate,
        contractKey: first.contractKey,
        contractUnit: privateReadonly.contract.contractUnit,
        positionQuantityShares: baseline.position.quantityShares,
        positionYesterdayQuantityShares:
            baseline.position.yesterdayQuantityShares,
        workingSellCount: baseline.workingSellCount,
        workingSetSha256: baseline.workingSetSha256,
        candidatePrices: Object.freeze([first.price, second.price]),
        bestBid: String(readonly.projection.quote.bestBidMinorUnits / 100),
        bestAsk: String(readonly.projection.quote.bestAskMinorUnits / 100),
        limitUp: String(readonly.projection.contract.limitUpMinorUnits / 100),
        evidenceValidUntilEpochMs: Math.min(
            first.validUntilEpochMs,
            second.validUntilEpochMs,
        ),
        brokerWriteAttempted: false,
        brokerWriteNetworked: false,
        writeMasterAuthority: false,
        brokerAuthority: false,
    });
}

async function main() {
    process.stdout.write(
        `${JSON.stringify(await runSmartOrderTask03cReadonlyPreflight())}\n`,
    );
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    main().catch((error) => {
        process.stderr.write(
            `smart_order_task0_3c_preflight=unavailable:${error?.name ?? 'Error'}\n`,
        );
        process.exitCode = 1;
    });
}
