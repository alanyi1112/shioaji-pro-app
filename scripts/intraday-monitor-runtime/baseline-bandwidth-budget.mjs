import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { validateDirect160BaselineSet } from './direct-160-baseline.mjs';

export const BASELINE_BANDWIDTH_BUDGET_SCHEMA = 'intraday-monitor-baseline-bandwidth-budget/1';
export const BASELINE_BANDWIDTH_RESERVE_FRACTION = 0.25;
export const BASELINE_BANDWIDTH_FORECAST_MULTIPLIER = 3;
export const BASELINE_BANDWIDTH_MAX_SAMPLE_AGE_DAYS = 30;
export const BASELINE_BANDWIDTH_MIN_SAMPLES = 2;
export const BASELINE_BANDWIDTH_MAX_RESPONSE_BYTES = 16 * 1024 ** 2;

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function sha256(raw) {
    return createHash('sha256').update(raw).digest('hex');
}

function validUsage(value) {
    return Number.isSafeInteger(value?.bytes) && value.bytes >= 0 &&
        Number.isSafeInteger(value?.limit_bytes) && value.limit_bytes > 0 &&
        Number.isSafeInteger(value?.remaining_bytes) && value.remaining_bytes >= 0 &&
        value.bytes + value.remaining_bytes === value.limit_bytes;
}

async function readJsonWithHash(file) {
    const raw = await readFile(file, 'utf8');
    return { value: JSON.parse(raw), sha256: sha256(raw) };
}

export async function readVerifiedBaselineBandwidthSamples({ root, manifest, tradeDate } = {}) {
    if (!path.isAbsolute(root ?? '') || !DATE.test(tradeDate ?? '') ||
        typeof manifest?.manifestHash !== 'string') {
        throw new TypeError('baseline bandwidth sample identity is invalid');
    }
    const baselineRoot = path.join(root, 'intraday-baselines');
    const entries = await readdir(baselineRoot, { withFileTypes: true })
        .catch((error) => { if (error?.code === 'ENOENT') return []; throw error; });
    const samples = [];
    for (const entry of entries) {
        const match = entry.isDirectory() &&
            /^(\d{4}-\d{2}-\d{2})-direct160(?:-attempt-(0[1-3]))?-source$/.exec(entry.name);
        if (!match) continue;
        const sourceDate = match[1];
        const ageDays = (Date.parse(`${tradeDate}T00:00:00Z`) -
            Date.parse(`${sourceDate}T00:00:00Z`)) / DAY_MS;
        if (!Number.isInteger(ageDays) || ageDays < 1 ||
            ageDays > BASELINE_BANDWIDTH_MAX_SAMPLE_AGE_DAYS) continue;
        try {
            const sourceDirectory = path.join(baselineRoot, entry.name);
            const [source, start, end] = await Promise.all([
                readJsonWithHash(path.join(sourceDirectory, 'source.json')),
                readJsonWithHash(path.join(sourceDirectory, 'usage-start.json')),
                readJsonWithHash(path.join(sourceDirectory, 'usage-160.json')),
            ]);
            if (source.value.simulation !== true || source.value.tradeDate !== sourceDate ||
                source.value.cohortHash !== manifest.manifestHash ||
                !validUsage(start.value) || !validUsage(end.value) ||
                start.value.limit_bytes !== end.value.limit_bytes ||
                end.value.bytes <= start.value.bytes) continue;
            if (match[2] && source.value.attempt !== Number(match[2])) continue;
            if (match[2] || source.value.budgetSha256) {
                if (!/^[a-f0-9]{64}$/.test(source.value.budgetSha256 ?? '')) continue;
                const suffix = match[2] ? `-attempt-${match[2]}` : '';
                const budgetPath = path.join(root, 'IntradayMonitor', 'postclose-baseline',
                    'budgets', `${sourceDate}${suffix}.json`);
                const budget = await readJsonWithHash(budgetPath);
                if (budget.sha256 !== source.value.budgetSha256 ||
                    budget.value.schemaVersion !== BASELINE_BANDWIDTH_BUDGET_SCHEMA ||
                    budget.value.tradeDate !== sourceDate ||
                    budget.value.attempt !== (match[2] ? Number(match[2]) : 1) ||
                    budget.value.manifestHash !== manifest.manifestHash ||
                    budget.value.providerLimitBytes !== start.value.limit_bytes ||
                    budget.value.ready !== true) continue;
            }
            const outputs = entries.filter((candidate) => candidate.isDirectory() &&
                new RegExp(`^${sourceDate}-for-(\\d{4}-\\d{2}-\\d{2})-verified$`).test(candidate.name));
            if (outputs.length !== 1) continue;
            const targetDate = outputs[0].name.slice(sourceDate.length + 5, sourceDate.length + 15);
            const outputDirectory = path.join(baselineRoot, outputs[0].name);
            const [report, baseline] = await Promise.all([
                readJsonWithHash(path.join(outputDirectory, 'verification.json')),
                readJsonWithHash(path.join(outputDirectory, 'baseline-set.json')),
            ]);
            if (report.value.previousTradeDate !== sourceDate ||
                report.value.targetTradeDate !== targetDate ||
                report.value.sourceDirectory !== sourceDirectory ||
                report.value.manifestHash !== manifest.manifestHash ||
                report.value.verifiedCount !== 160 || report.value.expectedCount !== 160 ||
                report.value.baselineUsable !== true ||
                !validateDirect160BaselineSet(baseline.value, manifest, targetDate)) continue;
            samples.push(Object.freeze({ tradeDate: sourceDate, targetTradeDate: targetDate,
                manifestHash: manifest.manifestHash,
                consumedBytes: end.value.bytes - start.value.bytes,
                providerLimitBytes: start.value.limit_bytes,
                sourceSha256: source.sha256, usageStartSha256: start.sha256,
                usageEndSha256: end.sha256, verificationSha256: report.sha256,
                baselineSha256: baseline.sha256 }));
        } catch {
            // 不完整或損毀的歷史資料不得被當成預算樣本。
        }
    }
    return Object.freeze(samples.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)));
}

export function createBaselineBandwidthBudget({ usage, samples, manifestHash, tradeDate,
    attempt, observedAt = new Date().toISOString() } = {}) {
    if (!validUsage(usage) || !DATE.test(tradeDate ?? '') ||
        !/^[a-f0-9]{64}$/.test(manifestHash ?? '') ||
        !Number.isInteger(attempt) || attempt < 1 || attempt > 3 ||
        !Number.isFinite(Date.parse(observedAt ?? ''))) {
        throw new TypeError('baseline_bandwidth_usage_invalid');
    }
    const eligible = (samples ?? []).filter((sample) =>
        DATE.test(sample?.tradeDate ?? '') && Number.isSafeInteger(sample.consumedBytes) &&
        sample.tradeDate < tradeDate && sample.manifestHash === manifestHash &&
        (Date.parse(`${tradeDate}T00:00:00Z`) -
            Date.parse(`${sample.tradeDate}T00:00:00Z`)) / DAY_MS <=
            BASELINE_BANDWIDTH_MAX_SAMPLE_AGE_DAYS &&
        sample.consumedBytes > 0 && sample.providerLimitBytes === usage.limit_bytes &&
        /^[a-f0-9]{64}$/.test(sample.sourceSha256 ?? '') &&
        /^[a-f0-9]{64}$/.test(sample.usageStartSha256 ?? '') &&
        /^[a-f0-9]{64}$/.test(sample.usageEndSha256 ?? '') &&
        /^[a-f0-9]{64}$/.test(sample.verificationSha256 ?? '') &&
        /^[a-f0-9]{64}$/.test(sample.baselineSha256 ?? ''));
    if (eligible.length < BASELINE_BANDWIDTH_MIN_SAMPLES ||
        new Set(eligible.map((sample) => sample.tradeDate)).size < BASELINE_BANDWIDTH_MIN_SAMPLES) {
        throw new Error('baseline_bandwidth_samples_insufficient');
    }
    const byDate = new Map();
    for (const sample of eligible) {
        const previous = byDate.get(sample.tradeDate);
        if (!previous || sample.consumedBytes > previous.consumedBytes) {
            byDate.set(sample.tradeDate, sample);
        }
    }
    const selected = [...byDate.values()]
        .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)).slice(0, 10);
    const maxObservedBytes = Math.max(...selected.map((sample) => sample.consumedBytes));
    const reserveBytes = Math.ceil(usage.limit_bytes * BASELINE_BANDWIDTH_RESERVE_FRACTION);
    const forecastBytes = Math.max(BASELINE_BANDWIDTH_MAX_RESPONSE_BYTES,
        Math.ceil(maxObservedBytes * BASELINE_BANDWIDTH_FORECAST_MULTIPLIER));
    const requiredStartBytes = reserveBytes + forecastBytes;
    if (![reserveBytes, forecastBytes, requiredStartBytes].every(Number.isSafeInteger)) {
        throw new Error('baseline_bandwidth_budget_invalid');
    }
    const plan = Object.freeze({ schemaVersion: BASELINE_BANDWIDTH_BUDGET_SCHEMA,
        tradeDate, attempt, manifestHash, observedAt,
        providerLimitBytes: usage.limit_bytes, providerUsedBytes: usage.bytes,
        providerRemainingBytes: usage.remaining_bytes,
        reserveFraction: BASELINE_BANDWIDTH_RESERVE_FRACTION,
        forecastMultiplier: BASELINE_BANDWIDTH_FORECAST_MULTIPLIER,
        reserveBytes, forecastBytes, requiredStartBytes,
        ready: usage.remaining_bytes >= requiredStartBytes,
        blocker: usage.remaining_bytes >= requiredStartBytes ? null :
            'provider_bandwidth_budget_insufficient',
        forecastPerSymbolBytes: Math.ceil(forecastBytes / 160),
        maxResponseBytes: BASELINE_BANDWIDTH_MAX_RESPONSE_BYTES,
        samples: selected });
    return plan;
}
