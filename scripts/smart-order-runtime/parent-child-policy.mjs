const TRADE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const WALL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/u;

function tradeDate(value, label) {
    if (typeof value !== 'string' || !TRADE_DATE_PATTERN.test(value)) {
        throw new TypeError(`${label} must be an ISO trade date`);
    }
    return value;
}

function wallTime(value, label) {
    if (typeof value !== 'string' || !WALL_TIME_PATTERN.test(value)) {
        throw new TypeError(`${label} must be HH:mm:ss`);
    }
    return value;
}

export function parentChildParentWindowClosed({
    parentEndDate,
    tradeDate: currentTradeDate,
    wallTime: currentWallTime,
}) {
    const currentDate = tradeDate(currentTradeDate, 'tradeDate');
    const endDate = tradeDate(parentEndDate, 'parentEndDate');
    const currentTime = wallTime(currentWallTime, 'wallTime');
    return (
        currentDate > endDate ||
        (currentDate === endDate && currentTime > '13:30:00')
    );
}

export function parentChildChildWindowClosed({
    activationTradeDate,
    cutoffTime,
    tradeDate: currentTradeDate,
    wallTime: currentWallTime,
}) {
    const activationDate = tradeDate(
        activationTradeDate,
        'activationTradeDate',
    );
    const currentDate = tradeDate(currentTradeDate, 'tradeDate');
    const cutoff = wallTime(cutoffTime, 'cutoffTime');
    const currentTime = wallTime(currentWallTime, 'wallTime');
    return currentDate !== activationDate || currentTime > cutoff;
}

export function parentChildIntentDispatchWindowOpen({
    activationTradeDate,
    childCutoffTime,
    leg,
    parentEndDate,
    parentStartDate,
    tradeDate: currentTradeDate,
    wallTime: currentWallTime,
}) {
    if (!['parent', 'child'].includes(leg)) {
        throw new TypeError('leg must be parent or child');
    }
    const activationDate = tradeDate(
        activationTradeDate,
        'activationTradeDate',
    );
    const currentDate = tradeDate(currentTradeDate, 'tradeDate');
    const currentTime = wallTime(currentWallTime, 'wallTime');
    if (currentDate !== activationDate) return false;
    if (leg === 'child') {
        return !parentChildChildWindowClosed({
            activationTradeDate: activationDate,
            cutoffTime: childCutoffTime,
            tradeDate: currentDate,
            wallTime: currentTime,
        });
    }
    const startDate = tradeDate(parentStartDate, 'parentStartDate');
    const endDate = tradeDate(parentEndDate, 'parentEndDate');
    return (
        currentDate >= startDate &&
        currentDate <= endDate &&
        currentTime <= '13:30:00'
    );
}

export function parentChildBrokerTerminalIsExactFullFill({
    brokerStatus,
    cancelledShares,
    expectedOrderShares,
    filledShares,
    orderShares,
    remainingShares,
}) {
    for (const [label, value] of Object.entries({
        cancelledShares,
        expectedOrderShares,
        filledShares,
        orderShares,
        remainingShares,
    })) {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new TypeError(`${label} must be a non-negative safe integer`);
        }
    }
    return (
        brokerStatus === 'Filled' &&
        orderShares === expectedOrderShares &&
        filledShares === orderShares &&
        cancelledShares === 0 &&
        remainingShares === 0
    );
}
