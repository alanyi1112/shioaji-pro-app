export function publicStrategyOperationError(error) {
    const message = String(error?.message ?? '').toLowerCase();
    if (message.includes('optimistic') || message.includes('revision')) {
        return Object.freeze({ status: 409, code: 'stale_revision' });
    }
    if (
        message.includes('only a draft') ||
        message.includes('not allowed') ||
        message.includes('terminal strategy')
    ) {
        return Object.freeze({
            status: 409,
            code: 'strategy_transition_not_allowed',
        });
    }
    if (
        message.includes('broker order cancellation requires') ||
        message.includes('one exact working order') ||
        message.includes('exact durable correlation') ||
        message.includes('already has a live intent')
    ) {
        return Object.freeze({
            status: 409,
            code: 'broker_order_cancel_not_ready',
        });
    }
    if (message.includes('requires current gate')) {
        return Object.freeze({ status: 409, code: 'strategy_resume_not_ready' });
    }
    if (message.includes('already exists') || message.includes('unique')) {
        return Object.freeze({ status: 409, code: 'strategy_conflict' });
    }
    if (
        error?.name === 'TypeError' ||
        message.includes('invalid') ||
        message.includes('unsupported')
    ) {
        return Object.freeze({ status: 422, code: 'strategy_payload_invalid' });
    }
    return Object.freeze({ status: 503, code: 'strategy_service_unavailable' });
}
