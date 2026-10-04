import { validateDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';

export const DYNAMIC_DAILY_ADMISSION_SCHEMA = 'intraday-monitor-daily-admission/1';

// 只建立當日不可變的訂閱意圖；實際 batch 必須由既有 session 的共用 transport 執行。
// 缺基準商品仍占用原 plan 名額，不允許盤中以候補補位。
export function createDynamicDailyAdmission({ plan, coverage } = {}) {
    if (!validateDynamicDailyCohortPlan(plan) || coverage?.planHash !== plan.planHash ||
        coverage.tradeDate !== plan.tradeDate || coverage.previousTradeDate !== plan.previousTradeDate ||
        coverage.plannedCount !== plan.selected.length ||
        !Array.isArray(coverage.items) || coverage.items.length !== plan.selected.length ||
        coverage.items.some((item, index) =>
            item?.canonicalSymbol !== plan.selected[index].canonicalSymbol ||
            !['baseline_ready', 'waiting_baseline'].includes(item.state) ||
            (item.state === 'baseline_ready' &&
                !/^sha256:[a-f0-9]{64}$/.test(item.manifestId ?? '')) ||
            (item.state === 'waiting_baseline' && item.manifestId !== null)) ||
        coverage.baselineReadyCount !== coverage.items.filter((item) =>
            item.state === 'baseline_ready').length) {
        throw new TypeError('daily_admission_input_invalid');
    }
    const items = Object.freeze(plan.selected.map((entry, index) => Object.freeze({
        canonicalSymbol: entry.canonicalSymbol,
        exchange: entry.exchange,
        baselineState: coverage.items[index].state,
        baselineReason: coverage.items[index].reason,
        baselineManifestId: coverage.items[index].manifestId,
        subscriptionState: 'not_requested',
        dataState: 'awaiting_first_kbar',
        comparisonEligible: false,
        notificationEligible: false,
    })));
    const contracts = Object.freeze(plan.selected.map((entry) => Object.freeze({
        securityType: 'STK', region: 'TW', exchange: entry.exchange,
        code: entry.canonicalSymbol.split('.')[0], targetCode: null,
        canonicalSymbol: entry.canonicalSymbol,
    })));
    return Object.freeze({ schemaVersion: DYNAMIC_DAILY_ADMISSION_SCHEMA,
        tradeDate: plan.tradeDate, planHash: plan.planHash,
        configuredRevision: plan.configRevision,
        plannedCount: plan.selected.length,
        baselineReadyCount: coverage.baselineReadyCount,
        exact160BaselineReady: coverage.exact160BaselineReady === true &&
            plan.selected.length === 160 && coverage.baselineReadyCount === 160,
        subscriptionRequestedCount: 0,
        dataActiveCount: 0,
        contracts, items,
        singleBatchOnly: true, allowSecondLogin: false, allowSecondStream: false,
        allowCohortRotation: false, allowIntradayBackfill: false,
    });
}

// control-plane accepted 只表示請求已送達，不能提升 data-active 或比較資格。
export function recordDynamicDailySubscription(admission, receipt) {
    if (admission?.schemaVersion !== DYNAMIC_DAILY_ADMISSION_SCHEMA ||
        admission.plannedCount < 1 || admission.plannedCount > 160 ||
        admission.subscriptionRequestedCount !== 0 || admission.dataActiveCount !== 0 ||
        receipt?.planHash !== admission.planHash || receipt.tradeDate !== admission.tradeDate ||
        receipt.cohortSize !== admission.plannedCount ||
        !Array.isArray(receipt.canonicalSymbols) ||
        receipt.canonicalSymbols.length !== admission.plannedCount ||
        receipt.canonicalSymbols.some((symbol, index) =>
            symbol !== admission.contracts[index].canonicalSymbol) ||
        receipt.sharedSession !== true || receipt.sameGeneration !== true ||
        receipt.secondLogin === true || receipt.secondStream === true ||
        receipt.rotation === true || receipt.batchCount !== 1 ||
        receipt.subscribeAccepted !== true) {
        throw new TypeError('daily_subscription_receipt_invalid');
    }
    return Object.freeze({ ...admission,
        subscriptionRequestedCount: admission.plannedCount,
        items: Object.freeze(admission.items.map((item) => Object.freeze({
            ...item, subscriptionState: 'requested',
        }))),
    });
}

// 資料面每檔獨立：真實合法 KBar + 同分鐘連續性與盤前基準均成立才可比較。
export function recordDynamicDailyDataEvidence(admission, evidence) {
    if (admission?.schemaVersion !== DYNAMIC_DAILY_ADMISSION_SCHEMA ||
        admission.subscriptionRequestedCount !== admission.plannedCount ||
        evidence?.tradeDate !== admission.tradeDate ||
        evidence.planHash !== admission.planHash ||
        evidence.sameGeneration !== true || evidence.liveKbar !== true ||
        evidence.unit !== 'common_lot' ||
        !/^\d{2}:\d{2}$/.test(evidence.minuteKey ?? '') ||
        !Number.isSafeInteger(evidence.currentCumulativeVolume) ||
        evidence.currentCumulativeVolume < 0 ||
        !Number.isFinite(Date.parse(evidence.receivedAt ?? ''))) {
        throw new TypeError('daily_data_evidence_invalid');
    }
    const index = admission.items.findIndex((item) =>
        item.canonicalSymbol === evidence.canonicalSymbol);
    if (index < 0) throw new TypeError('daily_data_symbol_not_planned');
    const prior = admission.items[index];
    const eligible = prior.baselineState === 'baseline_ready' &&
        evidence.baselineManifestId === prior.baselineManifestId &&
        Number.isSafeInteger(evidence.previousCumulativeVolume) &&
        evidence.previousCumulativeVolume >= 0 &&
        evidence.sealedMinuteComplete === true && evidence.baselineMinuteMatched === true;
    const updated = Object.freeze({ ...prior,
        dataState: eligible ? 'active' : 'partial',
        comparisonEligible: eligible,
        // 真正通知仍須外層現有 ledger 與 session Gate，這裡絕不直接授權。
        notificationEligible: false,
    });
    const items = Object.freeze(admission.items.map((item, i) => i === index ? updated : item));
    return Object.freeze({ ...admission, items,
        dataActiveCount: items.filter((item) => item.dataState === 'active').length });
}
