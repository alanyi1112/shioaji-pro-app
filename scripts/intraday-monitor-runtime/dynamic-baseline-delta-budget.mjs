export const DYNAMIC_BASELINE_DELTA_BUDGET_SCHEMA = 'intraday-monitor-dynamic-baseline-delta-budget/1';
const MAX_AGE_DAYS = 30;
const MIN_SAMPLE_DAYS = 2;
const RESERVE_FRACTION = 0.25;
const FORECAST_MULTIPLIER = 3;
const FULL_SAMPLE_SYMBOLS = 160;
const MAX_RESPONSE_BYTES = 16 * 1024 ** 2;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[a-f0-9]{64}$/;
const issuedBudgets = new WeakSet();

export function isIssuedDynamicBaselineDeltaBudget(value) {
    return Boolean(value && typeof value === 'object' && issuedBudgets.has(value));
}

function validUsage(value) {
    return Number.isSafeInteger(value?.bytes) && value.bytes >= 0 &&
        Number.isSafeInteger(value?.limit_bytes) && value.limit_bytes > 0 &&
        Number.isSafeInteger(value?.remaining_bytes) && value.remaining_bytes >= 0 &&
        value.bytes + value.remaining_bytes === value.limit_bytes;
}

function verifiedSample(sample, usage, tradeDate) {
    const ageDays = (Date.parse(`${tradeDate}T00:00:00Z`) -
        Date.parse(`${sample?.tradeDate}T00:00:00Z`)) / DAY_MS;
    return DATE.test(sample?.tradeDate ?? '') && Number.isInteger(ageDays) &&
        ageDays >= 1 && ageDays <= MAX_AGE_DAYS &&
        Number.isSafeInteger(sample.consumedBytes) && sample.consumedBytes > 0 &&
        sample.providerLimitBytes === usage.limit_bytes &&
        ['sourceSha256', 'usageStartSha256', 'usageEndSha256',
            'verificationSha256', 'baselineSha256'].every((key) => HASH.test(sample[key] ?? ''));
}

// samples 必須由 readVerifiedBaselineBandwidthSamples 讀取；此處再驗結構及期限。
export function createDynamicBaselineDeltaBudget({ usage, samples, tradeDate,
    addedSymbolCount, observedAt, deadlineAt } = {}) {
    const now = Date.parse(observedAt ?? '');
    const deadline = Date.parse(deadlineAt ?? '');
    if (!validUsage(usage) || !DATE.test(tradeDate ?? '') ||
        !Number.isSafeInteger(addedSymbolCount) || addedSymbolCount < 1 ||
        addedSymbolCount > FULL_SAMPLE_SYMBOLS || !Array.isArray(samples) ||
        !Number.isFinite(now) || !Number.isFinite(deadline) || now >= deadline ||
        deadline > Date.parse(`${tradeDate}T08:35:00+08:00`)) {
        throw new TypeError('dynamic_baseline_delta_budget_input_invalid');
    }
    const eligible = samples.filter((sample) => verifiedSample(sample, usage, tradeDate));
    const byDate = new Map();
    for (const sample of eligible) {
        const prior = byDate.get(sample.tradeDate);
        if (!prior || sample.consumedBytes > prior.consumedBytes) byDate.set(sample.tradeDate, sample);
    }
    if (byDate.size < MIN_SAMPLE_DAYS) throw new Error('dynamic_baseline_samples_insufficient');
    const selected = [...byDate.values()].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
        .slice(0, 10);
    const maxObservedFullCohortBytes = Math.max(...selected.map((sample) => sample.consumedBytes));
    const reserveBytes = Math.ceil(usage.limit_bytes * RESERVE_FRACTION);
    const forecastBytes = Math.max(MAX_RESPONSE_BYTES,
        Math.ceil(maxObservedFullCohortBytes / FULL_SAMPLE_SYMBOLS *
            FORECAST_MULTIPLIER * addedSymbolCount));
    const requiredStartBytes = reserveBytes + forecastBytes;
    if (![reserveBytes, forecastBytes, requiredStartBytes].every(Number.isSafeInteger)) {
        throw new Error('dynamic_baseline_budget_overflow');
    }
    const budget = Object.freeze({ schemaVersion: DYNAMIC_BASELINE_DELTA_BUDGET_SCHEMA,
        tradeDate, addedSymbolCount, observedAt, deadlineAt,
        providerLimitBytes: usage.limit_bytes, providerUsedBytes: usage.bytes,
        providerRemainingBytes: usage.remaining_bytes, reserveBytes, forecastBytes,
        requiredStartBytes, maxResponseBytes: MAX_RESPONSE_BYTES,
        actualSpendAllowanceBytes: Math.max(0, usage.remaining_bytes - reserveBytes),
        ready: usage.remaining_bytes >= requiredStartBytes,
        blocker: usage.remaining_bytes >= requiredStartBytes ? null :
            'provider_bandwidth_budget_insufficient',
        providerPhysicalUsage: null, providerPhysicalHeadroom: null,
        sampleTradeDates: selected.map((sample) => sample.tradeDate) });
    issuedBudgets.add(budget);
    return budget;
}

export function checkDynamicBaselineDeltaProgress({ budget, usage, observedAt,
    responseBytes = 0 } = {}) {
    if (!isIssuedDynamicBaselineDeltaBudget(budget) ||
        budget.schemaVersion !== DYNAMIC_BASELINE_DELTA_BUDGET_SCHEMA ||
        !validUsage(usage) || usage.limit_bytes !== budget.providerLimitBytes ||
        !Number.isSafeInteger(responseBytes) || responseBytes < 0 ||
        !Number.isFinite(Date.parse(observedAt ?? ''))) {
        return Object.freeze({ allowed: false, reason: 'budget_progress_unverifiable' });
    }
    if (budget.ready !== true) {
        return Object.freeze({ allowed: false, reason: 'provider_bandwidth_budget_insufficient' });
    }
    if (Date.parse(observedAt) < Date.parse(budget.observedAt)) {
        return Object.freeze({ allowed: false, reason: 'budget_progress_unverifiable' });
    }
    if (Date.parse(observedAt) >= Date.parse(budget.deadlineAt)) {
        return Object.freeze({ allowed: false, reason: 'baseline_deadline_exceeded' });
    }
    const spent = usage.bytes - budget.providerUsedBytes;
    if (spent < 0 || spent > budget.actualSpendAllowanceBytes ||
        usage.remaining_bytes < budget.reserveBytes) {
        return Object.freeze({ allowed: false, reason: 'provider_bandwidth_budget_exceeded' });
    }
    if (responseBytes > budget.maxResponseBytes) {
        return Object.freeze({ allowed: false, reason: 'baseline_response_too_large' });
    }
    return Object.freeze({ allowed: true, reason: null, spentBytes: spent,
        remainingAllowanceBytes: budget.actualSpendAllowanceBytes - spent });
}
