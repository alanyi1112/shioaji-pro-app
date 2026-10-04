import { readFile } from 'node:fs/promises';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { dynamicDailyCohortPlanPath, validateDynamicDailyCohortPlan }
    from './dynamic-daily-cohort-plan.mjs';
import { activateDynamicDailyPlan } from './dynamic-daily-active-plan.mjs';
import { DYNAMIC_DAILY_SESSION_PROOF_SCHEMA }
    from './dynamic-daily-session-proof.mjs';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';
import { createDynamicDailyBaselineGateReceipt,
    createDynamicDailyFinalGateReceipt, dynamicDailyBaselineGateReceiptPath,
    validateDynamicDailyBaselineGateReceipt, writeDynamicDailyGateReceipt }
    from './dynamic-daily-premarket-gate.mjs';

export const DYNAMIC_DAILY_PREMARKET_STEP_SCHEMA =
    'intraday-monitor-daily-premarket-step/1';

async function requireSavedPlan(root, plan) {
    if (!validateDynamicDailyCohortPlan(plan)) throw new TypeError('daily_premarket_plan_invalid');
    let saved;
    try { saved = JSON.parse(await readFile(dynamicDailyCohortPlanPath(root, plan), 'utf8')); }
    catch { throw new Error('daily_premarket_plan_missing'); }
    if (canonicalJson(saved) !== canonicalJson(plan)) {
        throw new Error('daily_premarket_plan_mismatch');
    }
}

function currentCalendar(authority, plan, checkedAt) {
    return authority?.schemaVersion ===
        INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA &&
        authority.current === true && authority.isTradingDate === true &&
        authority.tradeDate === plan.tradeDate &&
        authority.previousTradeDate === plan.previousTradeDate &&
        Array.isArray(authority.sourceVersions) &&
        authority.sourceVersions.some((version) =>
            plan.calendarSourceVersions.includes(version)) &&
        Number.isFinite(Date.parse(authority.observedAt ?? '')) &&
        Date.parse(authority.observedAt) <= Date.parse(checkedAt) &&
        Date.parse(checkedAt) - Date.parse(authority.observedAt) <= 60 * 60 * 1000;
}

// 不讀行情、不開 session。只把已驗證且在期限內的輸入封成不可覆寫收據。
export async function sealDynamicDailyBaselineGate({ root, plan, coverage,
    sources, authority, previousSessionFinalized, checkedAt } = {}) {
    await requireSavedPlan(root, plan);
    const receipt = createDynamicDailyBaselineGateReceipt({ plan, coverage,
        sources, checkedAt, officialCalendarCurrent: currentCalendar(authority,
            plan, checkedAt), previousSessionFinalized });
    const saved = await writeDynamicDailyGateReceipt(root, receipt);
    return Object.freeze({ schemaVersion: DYNAMIC_DAILY_PREMARKET_STEP_SCHEMA,
        step: '08:35', outcome: receipt.outcome, receiptPath: saved.path,
        receiptHash: receipt.receiptHash, planHash: plan.planHash,
        notificationAuthority: false, subscriptionAuthority: false });
}

export async function sealDynamicDailyFinalGate({ root, plan, baselineGate,
    authority, sessionProof, savedConfigRevision, checkedAt } = {}) {
    await requireSavedPlan(root, plan);
    if (!validateDynamicDailyBaselineGateReceipt(baselineGate, plan)) {
        throw new TypeError('daily_premarket_baseline_gate_invalid');
    }
    let savedBaseline;
    try { savedBaseline = JSON.parse(await readFile(dynamicDailyBaselineGateReceiptPath(
        root, baselineGate), 'utf8')); }
    catch { throw new Error('daily_premarket_baseline_gate_missing'); }
    if (canonicalJson(savedBaseline) !== canonicalJson(baselineGate)) {
        throw new Error('daily_premarket_baseline_gate_mismatch');
    }
    const sessionCurrent = sessionProof?.schemaVersion === DYNAMIC_DAILY_SESSION_PROOF_SCHEMA &&
        sessionProof.simulation === true && sessionProof.businessSessionCurrent === true &&
        [plan.previousTradeDate, plan.tradeDate].includes(sessionProof.snapshotTradeDate) &&
        /^simulation:[A-Za-z0-9_-]{16,100}$/.test(
            sessionProof.connectionGeneration ?? '') &&
        sessionProof.secondLogin === false && sessionProof.secondStream === false &&
        Number.isFinite(Date.parse(sessionProof.observedAt ?? '')) &&
        Date.parse(sessionProof.observedAt) <= Date.parse(checkedAt) &&
        Date.parse(checkedAt) - Date.parse(sessionProof.observedAt) <= 2 * 60 * 1000;
    const receipt = createDynamicDailyFinalGateReceipt({ plan, baselineGate,
        checkedAt, savedConfigRevision,
        officialCalendarCurrent: currentCalendar(authority, plan, checkedAt),
        simulation: sessionCurrent, businessSessionCurrent: sessionCurrent,
        connectionGeneration: sessionCurrent ? sessionProof.connectionGeneration : null });
    const saved = await writeDynamicDailyGateReceipt(root, receipt);
    const activation = ['ready', 'partial_ready'].includes(receipt.outcome) ?
        await activateDynamicDailyPlan({ root, plan, finalGate: receipt,
            activatedAt: checkedAt }) : null;
    return Object.freeze({ schemaVersion: DYNAMIC_DAILY_PREMARKET_STEP_SCHEMA,
        step: '08:45', outcome: receipt.outcome,
        receiptPath: saved.path, receiptHash: receipt.receiptHash,
        activePlanPath: activation?.path ?? null, planHash: plan.planHash,
        notificationAuthority: false, subscriptionAuthority: false });
}
