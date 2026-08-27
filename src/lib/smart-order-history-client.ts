import {
    assertSmartOrderBrowserGatewayAvailable,
    SmartOrderLocalApiError,
    type SmartOrderStrategyKind,
} from './smart-order-client';

export const SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION =
    'smart-order-history-projection/2026-08-12.2';

const HISTORY_ROUTE = '/__smart-orders/v1/history';
const HISTORY_LIMIT = 100;
const TOKEN = /^[A-Za-z0-9._:-]{1,240}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_:-]{0,159}$/;

const STRATEGY_KINDS = new Set<SmartOrderStrategyKind>([
    'quick',
    'good_till',
    'multi_condition',
    'parent_child',
    'stop_take',
    'trailing_exit',
    'scheduled_quantity',
]);

const TERMINAL_STATES = new Set(['cancelled', 'completed', 'expired', 'failed']);
const TERMINAL_REASON_STATES = new Map<string, ReadonlySet<string>>([
    [
        'STRATEGY_TERMINAL_IMPORTED',
        new Set(['cancelled', 'completed', 'expired', 'failed']),
    ],
    ['STRATEGY_CANCELLED_WITHOUT_SIDE_EFFECTS', new Set(['cancelled'])],
]);

export interface SmartOrderHistoryItem {
    readonly type: 'strategy';
    readonly strategyId: string;
    readonly strategyKind: SmartOrderStrategyKind;
    readonly state: 'cancelled' | 'completed' | 'expired' | 'failed';
    readonly maskedAccountLabel: string;
    readonly reasonCode: string;
    readonly revision: number;
    readonly createdAtEpochMs: number;
    readonly updatedAtEpochMs: number;
    readonly terminalAtEpochMs: number;
    readonly exchangeEpochMs: number | null;
    readonly brokerEpochMs: number | null;
    readonly receiveEpochMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]) {
    const keys = Object.keys(record).sort();
    return (
        keys.length === expected.length &&
        keys.every((key, index) => key === [...expected].sort()[index])
    );
}

function safeEpoch(value: unknown, nullable = false): number | null {
    if (nullable && value === null) return null;
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new SmartOrderLocalApiError(502, 'invalid_history_result');
    }
    return value as number;
}

function parseHistoryItem(value: unknown): SmartOrderHistoryItem {
    if (
        !isRecord(value) ||
        !exactKeys(value, [
            'brokerEpochMs',
            'createdAtEpochMs',
            'exchangeEpochMs',
            'maskedAccountLabel',
            'reasonCode',
            'receiveEpochMs',
            'revision',
            'state',
            'strategyId',
            'strategyKind',
            'terminalAtEpochMs',
            'type',
            'updatedAtEpochMs',
        ]) ||
        value.type !== 'strategy' ||
        typeof value.strategyId !== 'string' ||
        !TOKEN.test(value.strategyId) ||
        typeof value.strategyKind !== 'string' ||
        !STRATEGY_KINDS.has(value.strategyKind as SmartOrderStrategyKind) ||
        typeof value.state !== 'string' ||
        !TERMINAL_STATES.has(value.state) ||
        typeof value.reasonCode !== 'string' ||
        !REASON_CODE.test(value.reasonCode) ||
        typeof value.maskedAccountLabel !== 'string' ||
        !value.maskedAccountLabel.startsWith('固定帳號') ||
        value.maskedAccountLabel.length > 80
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_history_result');
    }

    const parsed = Object.freeze({
        type: 'strategy',
        strategyId: value.strategyId,
        strategyKind: value.strategyKind as SmartOrderStrategyKind,
        state: value.state as SmartOrderHistoryItem['state'],
        maskedAccountLabel: value.maskedAccountLabel,
        reasonCode: value.reasonCode,
        revision: safeEpoch(value.revision) as number,
        createdAtEpochMs: safeEpoch(value.createdAtEpochMs) as number,
        updatedAtEpochMs: safeEpoch(value.updatedAtEpochMs) as number,
        terminalAtEpochMs: safeEpoch(value.terminalAtEpochMs) as number,
        exchangeEpochMs: safeEpoch(value.exchangeEpochMs, true),
        brokerEpochMs: safeEpoch(value.brokerEpochMs, true),
        receiveEpochMs: safeEpoch(value.receiveEpochMs) as number,
    });
    if (
        !TERMINAL_REASON_STATES.get(parsed.reasonCode)?.has(parsed.state) ||
        parsed.createdAtEpochMs > parsed.updatedAtEpochMs ||
        parsed.terminalAtEpochMs > parsed.updatedAtEpochMs ||
        parsed.receiveEpochMs !== parsed.updatedAtEpochMs ||
        (parsed.exchangeEpochMs !== null &&
            parsed.exchangeEpochMs > parsed.receiveEpochMs) ||
        (parsed.brokerEpochMs !== null &&
            parsed.brokerEpochMs > parsed.receiveEpochMs) ||
        (parsed.exchangeEpochMs !== null &&
            parsed.brokerEpochMs !== null &&
            parsed.exchangeEpochMs > parsed.brokerEpochMs)
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_history_result');
    }
    return parsed;
}

export async function fetchSmartOrderHistory(): Promise<
    readonly SmartOrderHistoryItem[]
> {
    assertSmartOrderBrowserGatewayAvailable();
    const response = await fetch(HISTORY_ROUTE, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
        throw new SmartOrderLocalApiError(response.status, 'invalid_history_result');
    }
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
        const code =
            isRecord(payload) && typeof payload.code === 'string'
                ? payload.code
                : 'history_request_failed';
        throw new SmartOrderLocalApiError(response.status, code);
    }
    if (
        !isRecord(payload) ||
        !exactKeys(payload, [
            'accountIdentifiersExposed',
            'history',
            'journalPayloadExposed',
            'schemaVersion',
            'source',
        ]) ||
        payload.schemaVersion !== SMART_ORDER_HISTORY_PROJECTION_SCHEMA_VERSION ||
        payload.source !== 'runtime_repository' ||
        payload.accountIdentifiersExposed !== false ||
        payload.journalPayloadExposed !== false ||
        !Array.isArray(payload.history) ||
        payload.history.length > HISTORY_LIMIT
    ) {
        throw new SmartOrderLocalApiError(502, 'invalid_history_result');
    }
    return Object.freeze(payload.history.map(parseHistoryItem));
}
