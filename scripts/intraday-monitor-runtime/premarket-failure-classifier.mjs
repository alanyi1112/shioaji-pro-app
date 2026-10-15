// Pure candidate classifier. No filesystem, broker requests, or service lifecycle.
// A long-running 08:50 job's terminal partial is not a failure to start.
export function classifyPremarketCaptureFailure({ receipt, summary, session, tradeDate } = {}) {
    if (receipt?.schemaVersion !== 'intraday-monitor-premarket-orchestrator/1' ||
        receipt.localDate !== tradeDate || receipt.step !== '08:50' ||
        receipt.rolloverOutcome !== 'failed') return null;
    const failure = receipt.reason ?? 'unknown';
    if (failure !== 'daily_minute_volume_execution_failed') return failure;
    const started = Date.parse(receipt.actualStartedAt);
    const ended = Date.parse(receipt.actualEndedAt);
    const completed = Date.parse(summary?.completedAt);
    const expected = session?.itemStates?.map(item => item.canonicalSymbol);
    const coverage = summary?.liveCoverageBySymbol;
    const validDailyCompletion = session?.tradeDate === tradeDate &&
        receipt.sessionId === session.sessionId &&
        summary?.schemaVersion === 'intraday-monitor-daily-runner/1' &&
        summary.runtimeMode === 'daily' && summary.tradeDate === tradeDate &&
        summary.previousTradeDate === session.previousTradeDate &&
        summary.connectionGeneration === session.connectionGeneration &&
        summary.planHash === session.cohortHash &&
        ['ended', 'partial'].includes(summary.executionOutcome) &&
        summary.startReceipt?.started === true && summary.startReceipt.subscribeAccepted === true &&
        [started, ended, completed].every(Number.isFinite) &&
        completed >= started && ended >= completed && ended - completed <= 60_000 &&
        Array.isArray(expected) && expected.length === 160 && new Set(expected).size === 160 &&
        Array.isArray(coverage) && coverage.length === 160 &&
        new Set(coverage.map(item => item.canonicalSymbol)).size === 160 &&
        coverage.every(item => expected.includes(item.canonicalSymbol));
    // This does not grant current-session, freshness, notification, or live-complete
    // authority. Those validators must still evaluate the original evidence.
    return validDailyCompletion ? null : failure;
}
