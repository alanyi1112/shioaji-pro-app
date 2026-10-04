import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, link, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA } from './trading-calendar-authority.mjs';

export const DYNAMIC_DAILY_COHORT_PLAN_SCHEMA = 'intraday-monitor-daily-cohort-plan/1';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_CONFIGURED = 200;
const APPROVED_CAPACITY = 160;

function hash(value) {
    return createHash('sha256').update(canonicalJson(value, { maximumBytes: 1024 * 1024 })).digest('hex');
}

function validItem(item, position) {
    const contract = item?.contract;
    const symbol = `${contract?.code}.${contract?.exchange === 'TSE' ? 'TW' : 'TWO'}`;
    return item?.position === position && typeof item?.enabled === 'boolean' &&
        contract?.securityType === 'STK' && contract?.region === 'TW' &&
        ['TSE', 'OTC'].includes(contract?.exchange) &&
        contract?.targetCode === null && contract?.canonicalSymbol === symbol &&
        /^\d{4,6}[A-Z]?$/.test(contract?.code ?? '') &&
        typeof item?.effectiveThreshold?.decimal === 'string';
}

export function dynamicDailyConfigHash(config) {
    if (!Number.isSafeInteger(config?.revision) || config.revision < 0 ||
        typeof config.globalThreshold !== 'string' ||
        !Array.isArray(config.items) || !config.items.every(validItem)) {
        throw new TypeError('daily_config_hash_input_invalid');
    }
    return hash({ revision: config.revision, globalThreshold: config.globalThreshold,
        items: config.items.map((item) => ({ symbol: item.contract.canonicalSymbol,
            enabled: item.enabled, thresholdOverride: item.thresholdOverride,
            source: item.source })) });
}

export function createDynamicDailyCohortPlan({ config, authority, approval,
    createdAt = new Date().toISOString() } = {}) {
    if (authority?.schemaVersion !== INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA ||
        authority.current !== true || authority.isTradingDate !== true ||
        !DATE.test(authority.tradeDate ?? '') || !DATE.test(authority.previousTradeDate ?? '') ||
        authority.previousTradeDate >= authority.tradeDate ||
        !Array.isArray(authority.sourceVersions) || authority.sourceVersions.length === 0 ||
        !authority.sourceVersions.every((version) => typeof version === 'string' && version.length > 0) ||
        !Number.isFinite(Date.parse(authority.observedAt ?? ''))) {
        throw new TypeError('daily_plan_calendar_authority_invalid');
    }
    if (approval?.decision !== 'go' || approval.approvedActiveLimit !== APPROVED_CAPACITY ||
        !HASH.test(approval.approvalHash ?? '') ||
        !Number.isSafeInteger(config?.revision) || config.revision < 0 ||
        !Array.isArray(config.items) || config.items.length > MAX_CONFIGURED ||
        typeof config.globalThreshold !== 'string' ||
        !config.items.every(validItem) || !Number.isFinite(Date.parse(createdAt))) {
        throw new TypeError('daily_plan_input_invalid');
    }
    const symbols = config.items.map((item) => item.contract.canonicalSymbol);
    if (new Set(symbols).size !== symbols.length) throw new TypeError('daily_plan_duplicate_symbol');
    const selected = [];
    const waiting = [];
    const excluded = [];
    for (const item of config.items) {
        const entry = { canonicalSymbol: item.contract.canonicalSymbol,
            exchange: item.contract.exchange, position: item.position,
            threshold: item.effectiveThreshold.decimal };
        if (!item.enabled) excluded.push({ ...entry, reason: 'disabled' });
        else if (!/^(?!00)\d{4}$/.test(item.contract.code)) {
            excluded.push({ ...entry, reason: 'kbar_contract_unsupported' });
        } else if (selected.length < APPROVED_CAPACITY) selected.push(entry);
        else waiting.push({ ...entry, reason: 'waiting_capacity' });
    }
    const configHash = dynamicDailyConfigHash(config);
    const body = { schemaVersion: DYNAMIC_DAILY_COHORT_PLAN_SCHEMA,
        tradeDate: authority.tradeDate, previousTradeDate: authority.previousTradeDate,
        calendarSourceVersions: [...authority.sourceVersions],
        calendarObservedAt: authority.observedAt, configRevision: config.revision, configHash,
        approvedActiveLimit: APPROVED_CAPACITY, capacityApprovalHash: approval.approvalHash,
        selected, waiting, excluded, createdAt };
    return Object.freeze({ ...body, planHash: hash(body) });
}

export function validateDynamicDailyCohortPlan(value) {
    try {
        const { planHash, ...body } = value;
        const lists = [value.selected, value.waiting, value.excluded];
        const symbols = lists.flatMap((list) => list.map((entry) => entry.canonicalSymbol));
        const positions = lists.flatMap((list) => list.map((entry) => entry.position));
        const validEntry = (entry, admitted) => Number.isSafeInteger(entry?.position) &&
            entry.position >= 0 && entry.position < MAX_CONFIGURED &&
            /^\d{4,6}[A-Z]?\.(?:TW|TWO)$/.test(entry.canonicalSymbol ?? '') &&
            (!admitted || /^(?!00)\d{4}\.(?:TW|TWO)$/.test(entry.canonicalSymbol)) &&
            entry.exchange === (entry.canonicalSymbol.endsWith('.TW') ? 'TSE' : 'OTC') &&
            typeof entry.threshold === 'string' &&
            /^\d+(?:\.\d+)?$/.test(entry.threshold);
        const ordered = (list) => list.every((entry, index) =>
            index === 0 || list[index - 1].position < entry.position);
        return value.schemaVersion === DYNAMIC_DAILY_COHORT_PLAN_SCHEMA &&
            DATE.test(value.tradeDate) && DATE.test(value.previousTradeDate) &&
            value.previousTradeDate < value.tradeDate &&
            Number.isSafeInteger(value.configRevision) && value.configRevision >= 0 &&
            value.approvedActiveLimit === APPROVED_CAPACITY &&
            HASH.test(value.configHash) && HASH.test(value.capacityApprovalHash) &&
            Array.isArray(value.calendarSourceVersions) && value.calendarSourceVersions.length > 0 &&
            lists.every(Array.isArray) && value.selected.length <= APPROVED_CAPACITY &&
            symbols.length <= MAX_CONFIGURED && new Set(symbols).size === symbols.length &&
            new Set(positions).size === positions.length &&
            lists.every((list, index) => list.every((entry) =>
                validEntry(entry, index < 2)) && ordered(list)) &&
            value.selected.length === Math.min(APPROVED_CAPACITY,
                value.selected.length + value.waiting.length) &&
            (value.waiting.length === 0 ||
                value.selected.at(-1).position < value.waiting[0].position) &&
            value.waiting.every((entry) => entry.reason === 'waiting_capacity') &&
            value.excluded.every((entry) => ['disabled', 'kbar_contract_unsupported'].includes(entry.reason)) &&
            HASH.test(planHash) && planHash === hash(body);
    } catch { return false; }
}

export function dynamicDailyCohortPlanPath(appSupportRoot, plan) {
    if (!path.isAbsolute(appSupportRoot ?? '') || !validateDynamicDailyCohortPlan(plan)) {
        throw new TypeError('daily_plan_path_invalid');
    }
    return path.join(appSupportRoot, 'IntradayMonitor', 'daily-cohort-plans',
        plan.tradeDate, `plan-${plan.planHash}.json`);
}

// 只保存不可變候選 plan；不碰既有 session、claim、subscription 或歷史收據。
export async function writeDynamicDailyCohortPlan(appSupportRoot, plan) {
    const outputPath = dynamicDailyCohortPlanPath(appSupportRoot, plan);
    await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    const raw = `${canonicalJson(plan, { maximumBytes: 1024 * 1024 })}\n`;
    const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    const file = await open(temporaryPath, 'wx', 0o600);
    try {
        try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
        try { await link(temporaryPath, outputPath); }
        catch (error) {
            if (error?.code !== 'EEXIST' || await readFile(outputPath, 'utf8') !== raw) throw error;
        }
    } finally { await unlink(temporaryPath).catch(() => {}); }
    return Object.freeze({ path: outputPath, planHash: plan.planHash });
}
