import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, link, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { dynamicDailyCohortPlanPath, validateDynamicDailyCohortPlan }
    from './dynamic-daily-cohort-plan.mjs';
import { dynamicDailyBaselineGateReceiptPath,
    dynamicDailyFinalGateReceiptPath, validateDynamicDailyBaselineGateReceipt,
    validateDynamicDailyFinalGateReceipt }
    from './dynamic-daily-premarket-gate.mjs';

export const DYNAMIC_DAILY_ACTIVE_PLAN_SCHEMA = 'intraday-monitor-daily-active-plan/1';

export function dynamicDailyActivePlanPath(root, tradeDate) {
    if (!path.isAbsolute(root ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '')) {
        throw new TypeError('daily_active_plan_path_invalid');
    }
    return path.join(root, 'IntradayMonitor', 'daily-cohort-plans', tradeDate,
        'active-plan.json');
}

function hash(body) {
    return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

export function validateDynamicDailyActivePlan(value, plan, finalGate) {
    if (!validateDynamicDailyCohortPlan(plan) ||
        !validateDynamicDailyFinalGateReceipt(finalGate, plan) ||
        value?.schemaVersion !== DYNAMIC_DAILY_ACTIVE_PLAN_SCHEMA ||
        value.tradeDate !== plan.tradeDate || value.planHash !== plan.planHash ||
        value.configRevision !== plan.configRevision ||
        value.configHash !== plan.configHash ||
        value.finalGateHash !== finalGate.receiptHash ||
        value.subscriptionRequestedCount !== 0 || value.dataActiveCount !== 0 ||
        value.notificationAuthority !== false ||
        value.brokerWriteAuthority !== false || value.productionAuthority !== false ||
        !Number.isFinite(Date.parse(value.activatedAt ?? '')) ||
        Date.parse(value.activatedAt) < Date.parse(finalGate.checkedAt) ||
        Date.parse(value.activatedAt) >= Date.parse(`${plan.tradeDate}T09:00:00+08:00`)) {
        return false;
    }
    const { activationHash, ...body } = value;
    return /^[a-f0-9]{64}$/.test(activationHash ?? '') && activationHash === hash(body);
}

async function readSavedBaselineGate(root, plan, finalGate) {
    const identity = { schemaVersion: 'intraday-monitor-daily-baseline-gate/1',
        tradeDate: plan.tradeDate, receiptHash: finalGate.baselineGateHash };
    let baselineGate;
    try {
        baselineGate = JSON.parse(await readFile(dynamicDailyBaselineGateReceiptPath(root,
            identity), 'utf8'));
    } catch { throw new Error('daily_baseline_gate_receipt_missing'); }
    if (!validateDynamicDailyBaselineGateReceipt(baselineGate, plan) ||
        !['ready', 'partial_ready'].includes(baselineGate.outcome) ||
        baselineGate.receiptHash !== finalGate.baselineGateHash ||
        baselineGate.outcome !== finalGate.outcome ||
        baselineGate.baselineReadyCount !== finalGate.baselineReadyCount ||
        Date.parse(baselineGate.checkedAt) > Date.parse(finalGate.checkedAt)) {
        throw new Error('daily_baseline_gate_receipt_mismatch');
    }
    return baselineGate;
}

// 供後續 API/status 唯讀查詢；active pointer、候選 plan 與 08:45 Gate
// 必須三份互相對得上。缺 pointer 是尚未啟用，不得讀候選 plan 冒充生效。
export async function readDynamicDailyActivePlan(root, tradeDate) {
    const activePath = dynamicDailyActivePlanPath(root, tradeDate);
    let active;
    try { active = JSON.parse(await readFile(activePath, 'utf8')); }
    catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw new Error('daily_active_plan_unreadable');
    }
    if (active?.tradeDate !== tradeDate ||
        !/^[a-f0-9]{64}$/.test(active.planHash ?? '') ||
        !/^[a-f0-9]{64}$/.test(active.finalGateHash ?? '')) {
        throw new Error('daily_active_plan_identity_invalid');
    }
    const directory = path.dirname(activePath);
    let plan;
    let finalGate;
    try {
        plan = JSON.parse(await readFile(path.join(directory,
            `plan-${active.planHash}.json`), 'utf8'));
        finalGate = JSON.parse(await readFile(path.join(directory,
            'gate-receipts', `final-${active.finalGateHash}.json`), 'utf8'));
    } catch { throw new Error('daily_active_plan_evidence_unavailable'); }
    if (!validateDynamicDailyActivePlan(active, plan, finalGate)) {
        throw new Error('daily_active_plan_evidence_mismatch');
    }
    const baselineGate = await readSavedBaselineGate(root, plan, finalGate);
    return Object.freeze({ active, plan, baselineGate, finalGate });
}

// 只有已保存的候選 plan 與通過的 08:45 Gate 可升為當日唯一 active pointer。
// 不能覆寫既有 pointer；另一 revision 即使後來驗證通過，也須等下一適用交易日。
export async function activateDynamicDailyPlan({ root, plan, finalGate,
    activatedAt = new Date().toISOString() } = {}) {
    if (!path.isAbsolute(root ?? '') ||
        !validateDynamicDailyFinalGateReceipt(finalGate, plan) ||
        !Number.isFinite(Date.parse(activatedAt ?? '')) ||
        Date.parse(activatedAt) < Date.parse(finalGate.checkedAt) ||
        Date.parse(activatedAt) >= Date.parse(`${plan.tradeDate}T09:00:00+08:00`)) {
        throw new TypeError('daily_active_plan_input_invalid');
    }
    const planPath = dynamicDailyCohortPlanPath(root, plan);
    const saved = JSON.parse(await readFile(planPath, 'utf8')
        .catch(() => { throw new Error('daily_candidate_plan_missing'); }));
    if (saved.planHash !== plan.planHash ||
        canonicalJson(saved) !== canonicalJson(plan)) {
        throw new Error('daily_candidate_plan_mismatch');
    }
    const gatePath = dynamicDailyFinalGateReceiptPath(root, finalGate);
    const savedGate = JSON.parse(await readFile(gatePath, 'utf8')
        .catch(() => { throw new Error('daily_final_gate_receipt_missing'); }));
    if (canonicalJson(savedGate) !== canonicalJson(finalGate)) {
        throw new Error('daily_final_gate_receipt_mismatch');
    }
    await readSavedBaselineGate(root, plan, finalGate);
    const body = { schemaVersion: DYNAMIC_DAILY_ACTIVE_PLAN_SCHEMA,
        tradeDate: plan.tradeDate, planHash: plan.planHash,
        configRevision: plan.configRevision, configHash: plan.configHash,
        finalGateHash: finalGate.receiptHash, activatedAt,
        subscriptionRequestedCount: 0, dataActiveCount: 0,
        notificationAuthority: false, brokerWriteAuthority: false,
        productionAuthority: false };
    const value = Object.freeze({ ...body, activationHash: hash(body) });
    const outputPath = dynamicDailyActivePlanPath(root, plan.tradeDate);
    await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    const temporary = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
        try { await handle.writeFile(`${canonicalJson(value)}\n`); await handle.sync(); }
        finally { await handle.close(); }
        try { await link(temporary, outputPath); }
        catch (error) {
            if (error?.code !== 'EEXIST') throw error;
            const existing = JSON.parse(await readFile(outputPath, 'utf8'));
            if (!validateDynamicDailyActivePlan(existing, plan, finalGate)) {
                throw new Error('daily_active_plan_conflict');
            }
            return Object.freeze({ path: outputPath, value: existing, alreadyActive: true });
        }
    } finally { await unlink(temporary).catch(() => {}); }
    return Object.freeze({ path: outputPath, value, alreadyActive: false });
}
