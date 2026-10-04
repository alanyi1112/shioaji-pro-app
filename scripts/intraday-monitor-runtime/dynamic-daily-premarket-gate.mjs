import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, link, unlink } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { validateDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { isHistoricalKbarBaselineManifest } from './historical-kbar-repair.mjs';

export const DYNAMIC_DAILY_BASELINE_GATE_SCHEMA = 'intraday-monitor-daily-baseline-gate/1';
export const DYNAMIC_DAILY_FINAL_GATE_SCHEMA = 'intraday-monitor-daily-final-gate/1';
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function hash(body) {
    return createHash('sha256').update(canonicalJson(body, { maximumBytes: 1024 * 1024 })).digest('hex');
}

function taipeiDeadline(date, time) {
    return Date.parse(`${date}T${time}+08:00`);
}

function receiptHashValid(value) {
    if (!value || typeof value !== 'object') return false;
    try {
        const { receiptHash, ...body } = value;
        return /^[a-f0-9]{64}$/.test(receiptHash ?? '') && receiptHash === hash(body);
    } catch { return false; }
}

export function createDynamicDailyBaselineGateReceipt({ plan, coverage, sources = [],
    checkedAt, officialCalendarCurrent = false, previousSessionFinalized = false } = {}) {
    const checkedAtMs = Date.parse(checkedAt ?? '');
    if (!validateDynamicDailyCohortPlan(plan) || coverage?.planHash !== plan.planHash ||
        coverage.tradeDate !== plan.tradeDate ||
        coverage.previousTradeDate !== plan.previousTradeDate ||
        !Array.isArray(coverage.items) || coverage.items.length !== plan.selected.length ||
        !Array.isArray(sources) || !INSTANT.test(checkedAt ?? '') ||
        !Number.isFinite(checkedAtMs) ||
        checkedAtMs < taipeiDeadline(plan.previousTradeDate, '13:34:30') ||
        checkedAtMs >= taipeiDeadline(plan.tradeDate, '08:36:00')) {
        throw new TypeError('daily_baseline_gate_input_invalid');
    }
    const bySymbol = new Map();
    for (const source of sources) {
        const symbol = source?.manifest?.symbol;
        if (typeof symbol !== 'string') continue;
        const prior = bySymbol.get(symbol) ?? [];
        prior.push(source);
        bySymbol.set(symbol, prior);
    }
    const items = plan.selected.map((entry, index) => {
        const matched = bySymbol.get(entry.canonicalSymbol) ?? [];
        const coverageItem = coverage.items[index];
        let reason = null;
        if (coverageItem?.canonicalSymbol !== entry.canonicalSymbol ||
            coverageItem.state !== 'baseline_ready') reason = 'baseline_not_ready';
        else if (matched.length !== 1) reason = matched.length > 1 ?
            'baseline_source_conflict' : 'baseline_receipt_missing';
        else {
            const { manifest, sealedAt, sourceHash } = matched[0];
            const sealedAtMs = Date.parse(sealedAt ?? '');
            if (!isHistoricalKbarBaselineManifest(manifest) ||
                manifest.symbol !== entry.canonicalSymbol ||
                manifest.exchange !== entry.exchange ||
                manifest.tradeDate !== plan.previousTradeDate ||
                manifest.targetTradeDate !== plan.tradeDate ||
                manifest.manifestId !== coverageItem.manifestId ||
                sourceHash !== coverageItem.sourceHash || !SHA256.test(sourceHash ?? '') ||
                !INSTANT.test(sealedAt ?? '') || !Number.isFinite(sealedAtMs) ||
                !Number.isFinite(Date.parse(manifest.refetchTime ?? '')) ||
                sealedAtMs > checkedAtMs ||
                sealedAtMs > taipeiDeadline(plan.tradeDate, '08:35:00') ||
                Date.parse(manifest.refetchTime ?? '') > sealedAtMs) {
                reason = 'baseline_receipt_invalid';
            }
        }
        return Object.freeze({ canonicalSymbol: entry.canonicalSymbol,
            state: reason ? 'waiting_baseline' : 'baseline_ready', reason,
            manifestId: reason ? null : coverageItem.manifestId,
            sourceHash: reason ? null : coverageItem.sourceHash,
            sealedAt: reason ? null : matched[0].sealedAt });
    });
    const readyCount = items.filter((item) => item.state === 'baseline_ready').length;
    const gateCurrent = officialCalendarCurrent === true && previousSessionFinalized === true;
    const outcome = !gateCurrent || readyCount === 0 ? 'failed' :
        readyCount === plan.selected.length ? 'ready' : 'partial_ready';
    const body = { schemaVersion: DYNAMIC_DAILY_BASELINE_GATE_SCHEMA,
        tradeDate: plan.tradeDate, previousTradeDate: plan.previousTradeDate,
        planHash: plan.planHash, configRevision: plan.configRevision,
        checkedAt, calendarCurrent: officialCalendarCurrent === true,
        previousSessionFinalized: previousSessionFinalized === true,
        plannedCount: plan.selected.length, baselineReadyCount: readyCount,
        exact160BaselineReady: plan.selected.length === 160 && readyCount === 160,
        outcome, items,
        notificationAuthority: false, subscriptionAuthority: false,
        retroactiveAuthority: false };
    return Object.freeze({ ...body, receiptHash: hash(body) });
}

export function validateDynamicDailyBaselineGateReceipt(value, plan) {
    if (!validateDynamicDailyCohortPlan(plan) || !receiptHashValid(value) ||
        value.schemaVersion !== DYNAMIC_DAILY_BASELINE_GATE_SCHEMA ||
        value.tradeDate !== plan.tradeDate ||
        value.previousTradeDate !== plan.previousTradeDate ||
        value.planHash !== plan.planHash ||
        value.configRevision !== plan.configRevision ||
        !INSTANT.test(value.checkedAt ?? '') ||
        Date.parse(value.checkedAt) < taipeiDeadline(plan.previousTradeDate, '13:34:30') ||
        Date.parse(value.checkedAt) >= taipeiDeadline(plan.tradeDate, '08:36:00') ||
        typeof value.calendarCurrent !== 'boolean' ||
        typeof value.previousSessionFinalized !== 'boolean' ||
        !['ready', 'partial_ready', 'failed'].includes(value.outcome) ||
        value.plannedCount !== plan.selected.length ||
        !Number.isSafeInteger(value.baselineReadyCount) ||
        value.baselineReadyCount < 0 ||
        value.baselineReadyCount > plan.selected.length ||
        value.exact160BaselineReady !== (plan.selected.length === 160 &&
            value.baselineReadyCount === 160) ||
        !Array.isArray(value.items) || value.items.length !== plan.selected.length ||
        value.notificationAuthority !== false ||
        value.subscriptionAuthority !== false || value.retroactiveAuthority !== false) {
        return false;
    }
    const validItems = value.items.every((item, index) => {
        if (item.canonicalSymbol !== plan.selected[index].canonicalSymbol) return false;
        if (item.state === 'waiting_baseline') return typeof item.reason === 'string' &&
            item.manifestId === null && item.sourceHash === null && item.sealedAt === null;
        return item.state === 'baseline_ready' && item.reason === null &&
            SHA256.test(item.manifestId ?? '') && SHA256.test(item.sourceHash ?? '') &&
            INSTANT.test(item.sealedAt ?? '') &&
            Date.parse(item.sealedAt) <= Date.parse(value.checkedAt);
    });
    const readyCount = value.items.filter((item) => item.state === 'baseline_ready').length;
    const expectedOutcome = !value.calendarCurrent || !value.previousSessionFinalized ||
        readyCount === 0 ? 'failed' :
        readyCount === plan.selected.length ? 'ready' : 'partial_ready';
    return validItems && readyCount === value.baselineReadyCount &&
        value.outcome === expectedOutcome;
}

export function createDynamicDailyFinalGateReceipt({ plan, baselineGate,
    checkedAt, savedConfigRevision, officialCalendarCurrent = false,
    simulation = false, businessSessionCurrent = false, connectionGeneration = null } = {}) {
    const checkedAtMs = Date.parse(checkedAt ?? '');
    if (!validateDynamicDailyBaselineGateReceipt(baselineGate, plan) ||
        !INSTANT.test(checkedAt ?? '') || !Number.isFinite(checkedAtMs) ||
        checkedAtMs < taipeiDeadline(plan.tradeDate, '08:45:00') ||
        checkedAtMs >= taipeiDeadline(plan.tradeDate, '09:00:00')) {
        throw new TypeError('daily_final_gate_input_invalid');
    }
    const ready = ['ready', 'partial_ready'].includes(baselineGate.outcome) &&
        baselineGate.baselineReadyCount > 0 &&
        savedConfigRevision === plan.configRevision &&
        officialCalendarCurrent === true && simulation === true &&
        businessSessionCurrent === true &&
        typeof connectionGeneration === 'string' &&
        /^simulation:[A-Za-z0-9_-]{16,100}$/.test(connectionGeneration);
    const body = { schemaVersion: DYNAMIC_DAILY_FINAL_GATE_SCHEMA,
        tradeDate: plan.tradeDate, planHash: plan.planHash,
        configRevision: plan.configRevision, checkedAt,
        baselineGateHash: baselineGate.receiptHash,
        baselineReadyCount: baselineGate.baselineReadyCount,
        plannedCount: plan.selected.length,
        savedConfigRevision: Number.isSafeInteger(savedConfigRevision) ? savedConfigRevision : null,
        officialCalendarCurrent: officialCalendarCurrent === true,
        simulation: simulation === true, businessSessionCurrent: businessSessionCurrent === true,
        connectionGeneration: ready ? connectionGeneration : null,
        outcome: ready ? baselineGate.outcome : 'failed',
        subscriptionRequestedCount: 0, dataActiveCount: 0,
        notificationAuthority: false, subscriptionAuthority: false,
        retroactiveAuthority: false };
    return Object.freeze({ ...body, receiptHash: hash(body) });
}

export function validateDynamicDailyFinalGateReceipt(value, plan) {
    return validateDynamicDailyCohortPlan(plan) && receiptHashValid(value) &&
        value.schemaVersion === DYNAMIC_DAILY_FINAL_GATE_SCHEMA &&
        value.tradeDate === plan.tradeDate && value.planHash === plan.planHash &&
        value.configRevision === plan.configRevision &&
        INSTANT.test(value.checkedAt ?? '') &&
        Date.parse(value.checkedAt) >= taipeiDeadline(plan.tradeDate, '08:45:00') &&
        Date.parse(value.checkedAt) < taipeiDeadline(plan.tradeDate, '09:00:00') &&
        /^[a-f0-9]{64}$/.test(value.baselineGateHash ?? '') &&
        ['ready', 'partial_ready'].includes(value.outcome) &&
        value.plannedCount === plan.selected.length &&
        Number.isSafeInteger(value.baselineReadyCount) &&
        value.baselineReadyCount > 0 &&
        value.baselineReadyCount <= plan.selected.length &&
        value.outcome === (value.baselineReadyCount === plan.selected.length ?
            'ready' : 'partial_ready') &&
        value.subscriptionRequestedCount === 0 && value.dataActiveCount === 0 &&
        value.savedConfigRevision === plan.configRevision &&
        value.officialCalendarCurrent === true && value.simulation === true &&
        value.businessSessionCurrent === true &&
        /^simulation:[A-Za-z0-9_-]{16,100}$/.test(value.connectionGeneration ?? '') &&
        value.notificationAuthority === false && value.subscriptionAuthority === false &&
        value.retroactiveAuthority === false;
}

export function dynamicDailyFinalGateReceiptPath(root, receipt) {
    if (!path.isAbsolute(root ?? '') ||
        receipt?.schemaVersion !== DYNAMIC_DAILY_FINAL_GATE_SCHEMA ||
        !/^\d{4}-\d{2}-\d{2}$/.test(receipt.tradeDate ?? '') ||
        !/^[a-f0-9]{64}$/.test(receipt.receiptHash ?? '')) {
        throw new TypeError('daily_final_gate_path_invalid');
    }
    return path.join(root, 'IntradayMonitor', 'daily-cohort-plans',
        receipt.tradeDate, 'gate-receipts', `final-${receipt.receiptHash}.json`);
}

export function dynamicDailyBaselineGateReceiptPath(root, receipt) {
    if (!path.isAbsolute(root ?? '') ||
        receipt?.schemaVersion !== DYNAMIC_DAILY_BASELINE_GATE_SCHEMA ||
        !/^\d{4}-\d{2}-\d{2}$/.test(receipt.tradeDate ?? '') ||
        !/^[a-f0-9]{64}$/.test(receipt.receiptHash ?? '')) {
        throw new TypeError('daily_baseline_gate_path_invalid');
    }
    return path.join(root, 'IntradayMonitor', 'daily-cohort-plans',
        receipt.tradeDate, 'gate-receipts', `baseline-${receipt.receiptHash}.json`);
}

export async function writeDynamicDailyGateReceipt(root, receipt) {
    if (!path.isAbsolute(root ?? '') || !receiptHashValid(receipt) ||
        ![DYNAMIC_DAILY_BASELINE_GATE_SCHEMA, DYNAMIC_DAILY_FINAL_GATE_SCHEMA]
            .includes(receipt.schemaVersion) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(receipt.tradeDate ?? '')) {
        throw new TypeError('daily_gate_receipt_invalid');
    }
    const directory = path.join(root, 'IntradayMonitor', 'daily-cohort-plans',
        receipt.tradeDate, 'gate-receipts');
    const phase = receipt.schemaVersion === DYNAMIC_DAILY_BASELINE_GATE_SCHEMA ?
        'baseline' : 'final';
    const outputPath = path.join(directory, `${phase}-${receipt.receiptHash}.json`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const raw = `${canonicalJson(receipt, { maximumBytes: 1024 * 1024 })}\n`;
    const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
        try { await handle.writeFile(raw); await handle.sync(); }
        finally { await handle.close(); }
        try { await link(temporaryPath, outputPath); }
        catch (error) {
            if (error?.code !== 'EEXIST' || await readFile(outputPath, 'utf8') !== raw) throw error;
        }
    } finally { await unlink(temporaryPath).catch(() => {}); }
    return Object.freeze({ path: outputPath, receiptHash: receipt.receiptHash });
}
