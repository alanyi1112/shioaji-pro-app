// Read-only sizing of the shared ledger. This never grants admission: every
// source request still needs the persistent, atomic broker reservation port.
const safe = value => Number.isSafeInteger(value) && value >= 0;

export function calculateDailyMinuteVolumeBudgetPlan({ remainingBytes,
    quoteReserveBytes, otherCommittedBytes, retainedEstimatedBytes,
    maxObservedUsageDeltaBytes, estimateMultiplier, missingRequests } = {}) {
    if (![remainingBytes, quoteReserveBytes, otherCommittedBytes, retainedEstimatedBytes,
        maxObservedUsageDeltaBytes, missingRequests].every(safe) ||
        maxObservedUsageDeltaBytes < 1 || missingRequests > 320 ||
        !Number.isFinite(estimateMultiplier) || estimateMultiplier < 1 ||
        estimateMultiplier > 10) throw new TypeError('daily_budget_plan_invalid');
    const estimatePerRequest = Math.ceil(maxObservedUsageDeltaBytes * estimateMultiplier);
    const requiredBytes = estimatePerRequest * missingRequests;
    const availableBytes = remainingBytes - quoteReserveBytes - otherCommittedBytes -
        retainedEstimatedBytes;
    if (![estimatePerRequest, requiredBytes, availableBytes].every(Number.isSafeInteger))
        throw new Error('daily_budget_plan_overflow');
    return Object.freeze({ estimatePerRequest, missingRequests, requiredBytes,
        availableBytes, shortfallBytes: Math.max(0, requiredBytes - availableBytes),
        readyForBudgetPreflight: availableBytes >= requiredBytes,
        admissionStillRequired: true });
}
