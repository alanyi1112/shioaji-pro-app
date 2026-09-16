/** 盤中相對成交量監控的純 domain；不得在此模組讀取行情或建立 subscription。 */

export const INTRADAY_MONITOR_CONFIG_SCHEMA =
    'intraday-monitor-config/1' as const;
export const INTRADAY_MONITOR_ADMISSION_SCHEMA =
    'intraday-monitor-admission/1' as const;
export const INTRADAY_MONITOR_LEASE_SCHEMA =
    'intraday-monitor-lease/1' as const;
export const INTRADAY_MONITOR_OBSERVATION_SCHEMA =
    'intraday-monitor-observation/1' as const;
export const INTRADAY_MONITOR_BASELINE_SCHEMA =
    'intraday-monitor-baseline/1' as const;
export const INTRADAY_MONITOR_BOOTSTRAP_MANIFEST_SCHEMA =
    'intraday-monitor-bootstrap-manifest/1' as const;
export const INTRADAY_MONITOR_TRIGGER_SCHEMA =
    'intraday-monitor-trigger/1' as const;
export const INTRADAY_MONITOR_CAPACITY_SCHEMA =
    'intraday-monitor-capacity/1' as const;

export const INTRADAY_MONITOR_MAX_CONFIGURED = 200 as const;
export const INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT = 160 as const;
export const INTRADAY_MONITOR_REQUIRED_HEADROOM = 40 as const;
export const INTRADAY_MONITOR_DEFAULT_THRESHOLD = '1.5' as const;

export type IntradayMonitorSource =
    | 'manual'
    | 'watchlist'
    | 'after_market_screener';

export type IntradayMonitorReasonCode =
    | 'none'
    | 'disabled'
    | 'gate_evidence_missing'
    | 'ownership_incomplete'
    | 'pilot_limit'
    | 'kbar_contract_unsupported'
    | 'capacity_exhausted'
    | 'subscription_confirmation_pending'
    | 'subscription_confirmation_unknown'
    | 'baseline_missing'
    | 'baseline_incomplete'
    | 'stream_disconnected'
    | 'continuity_unproven'
    | 'invalid_observation'
    | 'stale_generation'
    | 'revision_conflict';

export type IntradayMonitorAdmissionKind =
    | 'disabled'
    | 'waiting_gate'
    | 'waiting_pilot_limit'
    | 'waiting_capacity'
    | 'waiting_baseline'
    | 'active'
    | 'degraded';

export interface TaiwanRegularLotStockContract {
    securityType: 'STK';
    region: 'TW';
    exchange: 'TSE' | 'OTC';
    code: string;
    targetCode: null;
    canonicalSymbol: string;
}

export interface EffectiveIntradayThreshold {
    decimal: string;
    hundredths: number;
    source: 'global' | 'item_override';
}

export interface IntradayMonitorCandidateItem {
    position: number;
    contract: TaiwanRegularLotStockContract;
    enabled: boolean;
    thresholdOverride: string | null;
    effectiveThreshold: EffectiveIntradayThreshold;
    source: IntradayMonitorSource;
}

export interface IntradayMonitorConfig {
    schemaVersion: typeof INTRADAY_MONITOR_CONFIG_SCHEMA;
    revision: number;
    globalThreshold: string;
    items: readonly IntradayMonitorCandidateItem[];
}

export interface IntradayMonitorAdmissionState {
    schemaVersion: typeof INTRADAY_MONITOR_ADMISSION_SCHEMA;
    canonicalSymbol: string;
    state: IntradayMonitorAdmissionKind;
    reasonCode: IntradayMonitorReasonCode;
    connectionGeneration: string | null;
    physicalKey: string | null;
    updatedAt: string;
}

export interface IntradayMonitorPageLease {
    schemaVersion: typeof INTRADAY_MONITOR_LEASE_SCHEMA;
    leaseId: string;
    clientId: string;
    generation: string;
    acquiredAt: string;
    expiresAt: string;
}

export interface IntradayMonitorMinuteObservation {
    schemaVersion: typeof INTRADAY_MONITOR_OBSERVATION_SCHEMA;
    contract: TaiwanRegularLotStockContract;
    tradeDate: string;
    minuteKey: string;
    exchangeTime: string;
    receivedTime: string;
    connectionGeneration: string;
    sequence: number;
    cumulativeVolume: number;
    unit: 'common_lot';
    source:
        | 'shioaji-tick-stk'
        | 'shioaji-kbar-stream'
        | 'shioaji-kbars-bootstrap';
    sourceVersion: string;
    simtrade: false;
    intradayOdd: false;
    continuity: 'complete' | 'partial';
}

export type IntradayMonitorBootstrapReasonCode =
    | 'none'
    | 'coverage_unverified'
    | 'invalid_payload'
    | 'request_failed'
    | 'request_timeout'
    | 'total_deadline_exceeded';

export interface IntradayMonitorBootstrapManifest {
    schemaVersion: typeof INTRADAY_MONITOR_BOOTSTRAP_MANIFEST_SCHEMA;
    kind: 'baseline' | 'today';
    canonicalSymbol: string;
    tradeDate: string;
    timeZone: 'Asia/Taipei';
    source: 'shioaji-kbars';
    sourceVersion: string;
    sourceUnit: 'common_lot';
    canonicalUnit: 'common_lot';
    requestedMinuteStart: string;
    requestedMinuteEnd: string;
    actualMinuteStart: string | null;
    actualMinuteEnd: string | null;
    expectedMinuteCount: number;
    actualMinuteCount: number;
    coverageReceipt: 'verified' | 'unavailable';
    completeness: 'complete' | 'incomplete';
    monitoringEffectiveFrom: string | null;
    earlierMinutesBackfilled: boolean;
    reasonCode: IntradayMonitorBootstrapReasonCode;
    payloadHash: string;
    fetchedAt: string;
}

export interface IntradayMonitorBaselineMinute {
    minuteKey: string;
    cumulativeVolume: number;
    provenance: 'observed' | 'carry_forward' | 'known_zero';
}

export interface IntradayMonitorBaseline {
    schemaVersion: typeof INTRADAY_MONITOR_BASELINE_SCHEMA;
    canonicalSymbol: string;
    tradeDate: string;
    timeZone: 'Asia/Taipei';
    source: string;
    sourceVersion: string;
    sourceUnit: 'common_lot';
    canonicalUnit: 'common_lot';
    expectedMinuteCount: number;
    completeness: 'complete' | 'incomplete';
    rows: readonly IntradayMonitorBaselineMinute[];
    payloadHash: string;
    fetchedAt: string;
}

export interface IntradayMonitorTriggerEvent {
    schemaVersion: typeof INTRADAY_MONITOR_TRIGGER_SCHEMA;
    eventId: string;
    eventHash: string;
    kind: 'live' | 'historical';
    tradeDate: string;
    baselineTradeDate: string;
    canonicalSymbol: string;
    exchange: 'TSE' | 'OTC';
    minuteKey: string;
    configRevision: number;
    threshold: string;
    currentCumulativeVolume: number;
    previousCumulativeVolume: number;
    unit: 'common_lot';
    sourceVersion: string;
    formulaVersion: string;
    completeness: 'complete';
    createdAt: string;
}

export interface IntradayMonitorCapacityStatus {
    schemaVersion: typeof INTRADAY_MONITOR_CAPACITY_SCHEMA;
    gate0EvidenceCurrent: boolean;
    globalOwnershipComplete: boolean;
    subscriptionTransportAuthority: boolean;
    configured: number;
    eligible: number;
    active: number;
    waiting: number;
    degraded: number;
    confirmedPhysicalUsage: number | null;
    confirmedOtherPhysicalUsage: number | null;
    localPhysicalLimit: typeof INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT;
    requiredHeadroom: typeof INTRADAY_MONITOR_REQUIRED_HEADROOM;
    availableForMonitor: number;
    connectionGeneration: string | null;
    evidenceAt: string | null;
}

export interface IntradayMonitorConfigError {
    path: string;
    code:
        | 'invalid_schema'
        | 'revision_conflict'
        | 'invalid_revision'
        | 'invalid_threshold'
        | 'invalid_items'
        | 'too_many_items'
        | 'invalid_contract'
        | 'duplicate_contract'
        | 'invalid_enabled'
        | 'invalid_source';
}

export type IntradayMonitorConfigValidation =
    | { ok: true; value: IntradayMonitorConfig }
    | { ok: false; errors: readonly IntradayMonitorConfigError[] };

type UnknownRecord = Record<string, unknown>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MINUTE_KEY = /^(?:09:(?:0\d|[1-5]\d)|1[0-2]:[0-5]\d|13:(?:[0-2]\d|30))$/;
const EXCHANGE_TIME = /^\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/;
const CONTRACT_CODE = /^\d{4,6}[A-Z]?$/;
const OPAQUE_ID = /^[A-Za-z0-9_-]{16,128}$/;
const CONNECTION_GENERATION_ID = /^[A-Za-z0-9:_-]{16,128}$/;
const HASH = /^[a-f0-9]{64}$/;

function record(value: unknown): UnknownRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as UnknownRecord)
        : null;
}

function exactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
    const expected = new Set(keys);
    return (
        Object.keys(value).length === expected.size &&
        Object.keys(value).every((key) => expected.has(key))
    );
}

function safeCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

function revision(value: unknown): value is number {
    return safeCount(value);
}

function isoDate(value: unknown): value is string {
    if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function instant(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        ISO_INSTANT.test(value) &&
        Number.isFinite(Date.parse(value))
    );
}

export function parseIntradayThreshold(
    value: unknown,
): { decimal: string; hundredths: number } | null {
    if (
        typeof value !== 'string' ||
        !/^(?:[1-9]\d?|100)(?:\.\d{1,2})?$/.test(value)
    ) {
        return null;
    }
    const [whole = '', fraction = ''] = value.split('.');
    const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (hundredths < 100 || hundredths > 10_000) return null;
    const canonicalFraction = String(hundredths % 100)
        .padStart(2, '0')
        .replace(/0+$/, '');
    return {
        decimal: `${Math.floor(hundredths / 100)}${canonicalFraction ? `.${canonicalFraction}` : ''}`,
        hundredths,
    };
}

export function parseTaiwanRegularLotStockContract(
    value: unknown,
): TaiwanRegularLotStockContract | null {
    const input = record(value);
    if (
        !input ||
        !exactKeys(input, [
            'security_type',
            'region',
            'exchange',
            'code',
            'target_code',
        ]) ||
        input.security_type !== 'STK' ||
        input.region !== 'TW' ||
        (input.exchange !== 'TSE' && input.exchange !== 'OTC') ||
        typeof input.code !== 'string' ||
        !CONTRACT_CODE.test(input.code) ||
        input.target_code !== null
    ) {
        return null;
    }
    return Object.freeze({
        securityType: 'STK',
        region: 'TW',
        exchange: input.exchange,
        code: input.code,
        targetCode: null,
        canonicalSymbol: `${input.code}.${input.exchange === 'TSE' ? 'TW' : 'TWO'}`,
    });
}

export function isTaiwanRegularLotStockContract(
    value: unknown,
): value is TaiwanRegularLotStockContract {
    const input = record(value);
    return Boolean(
        input &&
            exactKeys(input, [
                'securityType',
                'region',
                'exchange',
                'code',
                'targetCode',
                'canonicalSymbol',
            ]) &&
            input.securityType === 'STK' &&
            input.region === 'TW' &&
            (input.exchange === 'TSE' || input.exchange === 'OTC') &&
            typeof input.code === 'string' &&
            CONTRACT_CODE.test(input.code) &&
            input.targetCode === null &&
            input.canonicalSymbol ===
                `${input.code}.${input.exchange === 'TSE' ? 'TW' : 'TWO'}`,
    );
}

export function validateIntradayMonitorConfig(
    value: unknown,
    expectedRevision?: number,
): IntradayMonitorConfigValidation {
    const input = record(value);
    const errors: IntradayMonitorConfigError[] = [];
    if (
        !input ||
        !exactKeys(input, [
            'schemaVersion',
            'revision',
            'globalThreshold',
            'items',
        ]) ||
        input.schemaVersion !== INTRADAY_MONITOR_CONFIG_SCHEMA
    ) {
        return { ok: false, errors: [{ path: '$', code: 'invalid_schema' }] };
    }
    if (!revision(input.revision)) {
        errors.push({ path: '$.revision', code: 'invalid_revision' });
    } else if (
        expectedRevision !== undefined &&
        input.revision !== expectedRevision
    ) {
        errors.push({ path: '$.revision', code: 'revision_conflict' });
    }
    const globalThreshold = parseIntradayThreshold(input.globalThreshold);
    if (!globalThreshold) {
        errors.push({
            path: '$.globalThreshold',
            code: 'invalid_threshold',
        });
    }
    if (!Array.isArray(input.items)) {
        errors.push({ path: '$.items', code: 'invalid_items' });
        return { ok: false, errors };
    }
    if (input.items.length > INTRADAY_MONITOR_MAX_CONFIGURED) {
        errors.push({ path: '$.items', code: 'too_many_items' });
    }

    const seen = new Set<string>();
    const normalized: IntradayMonitorCandidateItem[] = [];
    input.items.forEach((rawItem, position) => {
        const item = record(rawItem);
        const path = `$.items[${position}]`;
        if (
            !item ||
            !exactKeys(item, [
                'contract',
                'enabled',
                'thresholdOverride',
                'source',
            ])
        ) {
            errors.push({ path, code: 'invalid_schema' });
            return;
        }
        const contract = parseTaiwanRegularLotStockContract(item.contract);
        if (!contract) {
            errors.push({ path: `${path}.contract`, code: 'invalid_contract' });
        } else if (seen.has(contract.canonicalSymbol)) {
            errors.push({
                path: `${path}.contract`,
                code: 'duplicate_contract',
            });
        } else {
            seen.add(contract.canonicalSymbol);
        }
        if (typeof item.enabled !== 'boolean') {
            errors.push({ path: `${path}.enabled`, code: 'invalid_enabled' });
        }
        const thresholdOverride =
            item.thresholdOverride === null
                ? null
                : parseIntradayThreshold(item.thresholdOverride);
        if (item.thresholdOverride !== null && !thresholdOverride) {
            errors.push({
                path: `${path}.thresholdOverride`,
                code: 'invalid_threshold',
            });
        }
        if (
            item.source !== 'manual' &&
            item.source !== 'watchlist' &&
            item.source !== 'after_market_screener'
        ) {
            errors.push({ path: `${path}.source`, code: 'invalid_source' });
        }
        if (
            contract &&
            typeof item.enabled === 'boolean' &&
            (item.thresholdOverride === null || thresholdOverride) &&
            (item.source === 'manual' ||
                item.source === 'watchlist' ||
                item.source === 'after_market_screener') &&
            globalThreshold
        ) {
            const effective = thresholdOverride ?? globalThreshold;
            normalized.push(
                Object.freeze({
                    position,
                    contract,
                    enabled: item.enabled,
                    thresholdOverride: thresholdOverride?.decimal ?? null,
                    effectiveThreshold: Object.freeze({
                        decimal: effective.decimal,
                        hundredths: effective.hundredths,
                        source: thresholdOverride ? 'item_override' : 'global',
                    }),
                    source: item.source,
                }),
            );
        }
    });

    if (errors.length > 0) return { ok: false, errors };
    return {
        ok: true,
        value: Object.freeze({
            schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
            revision: input.revision as number,
            globalThreshold: globalThreshold!.decimal,
            items: Object.freeze(normalized),
        }),
    };
}

export function isIntradayMonitorMinuteObservation(
    value: unknown,
): value is IntradayMonitorMinuteObservation {
    const input = record(value);
    return Boolean(
        input &&
            exactKeys(input, [
                'schemaVersion',
                'contract',
                'tradeDate',
                'minuteKey',
                'exchangeTime',
                'receivedTime',
                'connectionGeneration',
                'sequence',
                'cumulativeVolume',
                'unit',
                'source',
                'sourceVersion',
                'simtrade',
                'intradayOdd',
                'continuity',
            ]) &&
            input.schemaVersion === INTRADAY_MONITOR_OBSERVATION_SCHEMA &&
            isTaiwanRegularLotStockContract(input.contract) &&
            isoDate(input.tradeDate) &&
            typeof input.minuteKey === 'string' &&
            MINUTE_KEY.test(input.minuteKey) &&
            typeof input.exchangeTime === 'string' &&
            EXCHANGE_TIME.test(input.exchangeTime) &&
            instant(input.receivedTime) &&
            typeof input.connectionGeneration === 'string' &&
            CONNECTION_GENERATION_ID.test(input.connectionGeneration) &&
            Number.isSafeInteger(input.sequence) &&
            Number(input.sequence) > 0 &&
            safeCount(input.cumulativeVolume) &&
            input.unit === 'common_lot' &&
            (input.source === 'shioaji-tick-stk' ||
                input.source === 'shioaji-kbar-stream' ||
                input.source === 'shioaji-kbars-bootstrap') &&
            typeof input.sourceVersion === 'string' &&
            input.sourceVersion.length > 0 &&
            input.simtrade === false &&
            input.intradayOdd === false &&
            (input.continuity === 'complete' || input.continuity === 'partial'),
    );
}

export function isIntradayMonitorBootstrapManifest(
    value: unknown,
): value is IntradayMonitorBootstrapManifest {
    const input = record(value);
    if (
        !input ||
        !exactKeys(input, [
            'schemaVersion',
            'kind',
            'canonicalSymbol',
            'tradeDate',
            'timeZone',
            'source',
            'sourceVersion',
            'sourceUnit',
            'canonicalUnit',
            'requestedMinuteStart',
            'requestedMinuteEnd',
            'actualMinuteStart',
            'actualMinuteEnd',
            'expectedMinuteCount',
            'actualMinuteCount',
            'coverageReceipt',
            'completeness',
            'monitoringEffectiveFrom',
            'earlierMinutesBackfilled',
            'reasonCode',
            'payloadHash',
            'fetchedAt',
        ]) ||
        input.schemaVersion !== INTRADAY_MONITOR_BOOTSTRAP_MANIFEST_SCHEMA ||
        (input.kind !== 'baseline' && input.kind !== 'today') ||
        typeof input.canonicalSymbol !== 'string' ||
        !/^\d{4,6}[A-Z]?\.(?:TW|TWO)$/.test(input.canonicalSymbol) ||
        !isoDate(input.tradeDate) ||
        input.timeZone !== 'Asia/Taipei' ||
        input.source !== 'shioaji-kbars' ||
        typeof input.sourceVersion !== 'string' ||
        input.sourceVersion.length < 1 ||
        input.sourceVersion.length > 128 ||
        input.sourceUnit !== 'common_lot' ||
        input.canonicalUnit !== 'common_lot' ||
        typeof input.requestedMinuteStart !== 'string' ||
        !MINUTE_KEY.test(input.requestedMinuteStart) ||
        typeof input.requestedMinuteEnd !== 'string' ||
        !MINUTE_KEY.test(input.requestedMinuteEnd) ||
        input.requestedMinuteStart > input.requestedMinuteEnd ||
        (input.actualMinuteStart !== null &&
            (typeof input.actualMinuteStart !== 'string' ||
                !MINUTE_KEY.test(input.actualMinuteStart))) ||
        (input.actualMinuteEnd !== null &&
            (typeof input.actualMinuteEnd !== 'string' ||
                !MINUTE_KEY.test(input.actualMinuteEnd))) ||
        !safeCount(input.expectedMinuteCount) ||
        !safeCount(input.actualMinuteCount) ||
        Number(input.actualMinuteCount) > Number(input.expectedMinuteCount) ||
        (input.coverageReceipt !== 'verified' &&
            input.coverageReceipt !== 'unavailable') ||
        (input.completeness !== 'complete' &&
            input.completeness !== 'incomplete') ||
        (input.monitoringEffectiveFrom !== null &&
            (typeof input.monitoringEffectiveFrom !== 'string' ||
                !MINUTE_KEY.test(input.monitoringEffectiveFrom))) ||
        typeof input.earlierMinutesBackfilled !== 'boolean' ||
        ![
            'none',
            'coverage_unverified',
            'invalid_payload',
            'request_failed',
            'request_timeout',
            'total_deadline_exceeded',
        ].includes(String(input.reasonCode)) ||
        typeof input.payloadHash !== 'string' ||
        !HASH.test(input.payloadHash) ||
        !instant(input.fetchedAt)
    ) {
        return false;
    }
    const hasActualRange =
        input.actualMinuteStart !== null && input.actualMinuteEnd !== null;
    if (
        hasActualRange !== (Number(input.actualMinuteCount) > 0) ||
        (hasActualRange && input.actualMinuteStart! > input.actualMinuteEnd!) ||
        (input.completeness === 'complete' &&
            (input.coverageReceipt !== 'verified' ||
                input.reasonCode !== 'none' ||
                Number(input.actualMinuteCount) !==
                    Number(input.expectedMinuteCount))) ||
        (input.kind === 'baseline' &&
            (input.monitoringEffectiveFrom !== null ||
                input.earlierMinutesBackfilled !== false)) ||
        (input.kind === 'today' && input.monitoringEffectiveFrom === null) ||
        (input.kind === 'today' &&
            input.earlierMinutesBackfilled !==
                (input.completeness === 'complete'))
    ) {
        return false;
    }
    return true;
}

export function isIntradayMonitorPageLease(
    value: unknown,
): value is IntradayMonitorPageLease {
    const input = record(value);
    return Boolean(
        input &&
            exactKeys(input, [
                'schemaVersion',
                'leaseId',
                'clientId',
                'generation',
                'acquiredAt',
                'expiresAt',
            ]) &&
            input.schemaVersion === INTRADAY_MONITOR_LEASE_SCHEMA &&
            typeof input.leaseId === 'string' &&
            OPAQUE_ID.test(input.leaseId) &&
            typeof input.clientId === 'string' &&
            OPAQUE_ID.test(input.clientId) &&
            typeof input.generation === 'string' &&
            OPAQUE_ID.test(input.generation) &&
            instant(input.acquiredAt) &&
            instant(input.expiresAt) &&
            Date.parse(input.expiresAt as string) >
                Date.parse(input.acquiredAt as string),
    );
}

export function isIntradayMonitorBaseline(
    value: unknown,
): value is IntradayMonitorBaseline {
    const input = record(value);
    if (
        !input ||
        !exactKeys(input, [
            'schemaVersion',
            'canonicalSymbol',
            'tradeDate',
            'timeZone',
            'source',
            'sourceVersion',
            'sourceUnit',
            'canonicalUnit',
            'expectedMinuteCount',
            'completeness',
            'rows',
            'payloadHash',
            'fetchedAt',
        ]) ||
        input.schemaVersion !== INTRADAY_MONITOR_BASELINE_SCHEMA ||
        typeof input.canonicalSymbol !== 'string' ||
        !/^\d{4,6}[A-Z]?\.(?:TW|TWO)$/.test(input.canonicalSymbol) ||
        !isoDate(input.tradeDate) ||
        input.timeZone !== 'Asia/Taipei' ||
        typeof input.source !== 'string' ||
        !input.source ||
        typeof input.sourceVersion !== 'string' ||
        !input.sourceVersion ||
        input.sourceUnit !== 'common_lot' ||
        input.canonicalUnit !== 'common_lot' ||
        !safeCount(input.expectedMinuteCount) ||
        (input.completeness !== 'complete' &&
            input.completeness !== 'incomplete') ||
        !Array.isArray(input.rows) ||
        typeof input.payloadHash !== 'string' ||
        !HASH.test(input.payloadHash) ||
        !instant(input.fetchedAt)
    ) {
        return false;
    }
    let previousMinute = '';
    let previousVolume = -1;
    for (const rawRow of input.rows) {
        const row = record(rawRow);
        if (
            !row ||
            !exactKeys(row, [
                'minuteKey',
                'cumulativeVolume',
                'provenance',
            ]) ||
            typeof row.minuteKey !== 'string' ||
            !MINUTE_KEY.test(row.minuteKey) ||
            row.minuteKey <= previousMinute ||
            !safeCount(row.cumulativeVolume) ||
            Number(row.cumulativeVolume) < previousVolume ||
            (row.provenance !== 'observed' &&
                row.provenance !== 'carry_forward' &&
                row.provenance !== 'known_zero')
        ) {
            return false;
        }
        previousMinute = row.minuteKey;
        previousVolume = Number(row.cumulativeVolume);
    }
    return input.rows.length <= Number(input.expectedMinuteCount);
}

export function isIntradayMonitorTriggerEvent(
    value: unknown,
): value is IntradayMonitorTriggerEvent {
    const input = record(value);
    return Boolean(
        input &&
            exactKeys(input, [
                'schemaVersion',
                'eventId',
                'eventHash',
                'kind',
                'tradeDate',
                'baselineTradeDate',
                'canonicalSymbol',
                'exchange',
                'minuteKey',
                'configRevision',
                'threshold',
                'currentCumulativeVolume',
                'previousCumulativeVolume',
                'unit',
                'sourceVersion',
                'formulaVersion',
                'completeness',
                'createdAt',
            ]) &&
            input.schemaVersion === INTRADAY_MONITOR_TRIGGER_SCHEMA &&
            typeof input.eventId === 'string' &&
            OPAQUE_ID.test(input.eventId) &&
            typeof input.eventHash === 'string' &&
            HASH.test(input.eventHash) &&
            (input.kind === 'live' || input.kind === 'historical') &&
            isoDate(input.tradeDate) &&
            isoDate(input.baselineTradeDate) &&
            input.baselineTradeDate !== input.tradeDate &&
            typeof input.canonicalSymbol === 'string' &&
            /^\d{4,6}[A-Z]?\.(?:TW|TWO)$/.test(input.canonicalSymbol) &&
            (input.exchange === 'TSE' || input.exchange === 'OTC') &&
            input.canonicalSymbol.endsWith(
                input.exchange === 'TSE' ? '.TW' : '.TWO',
            ) &&
            typeof input.minuteKey === 'string' &&
            MINUTE_KEY.test(input.minuteKey) &&
            revision(input.configRevision) &&
            parseIntradayThreshold(input.threshold) &&
            safeCount(input.currentCumulativeVolume) &&
            safeCount(input.previousCumulativeVolume) &&
            Number(input.previousCumulativeVolume) > 0 &&
            input.unit === 'common_lot' &&
            typeof input.sourceVersion === 'string' &&
            input.sourceVersion.length > 0 &&
            typeof input.formulaVersion === 'string' &&
            input.formulaVersion.length > 0 &&
            input.completeness === 'complete' &&
            instant(input.createdAt),
    );
}

export function isIntradayMonitorAdmissionState(
    value: unknown,
): value is IntradayMonitorAdmissionState {
    const input = record(value);
    const states: IntradayMonitorAdmissionKind[] = [
        'disabled',
        'waiting_gate',
        'waiting_pilot_limit',
        'waiting_capacity',
        'waiting_baseline',
        'active',
        'degraded',
    ];
    return Boolean(
        input &&
            exactKeys(input, [
                'schemaVersion',
                'canonicalSymbol',
                'state',
                'reasonCode',
                'connectionGeneration',
                'physicalKey',
                'updatedAt',
            ]) &&
            input.schemaVersion === INTRADAY_MONITOR_ADMISSION_SCHEMA &&
            typeof input.canonicalSymbol === 'string' &&
            /^\d{4,6}[A-Z]?\.(?:TW|TWO)$/.test(input.canonicalSymbol) &&
            states.includes(input.state as IntradayMonitorAdmissionKind) &&
            typeof input.reasonCode === 'string' &&
            [
                'none',
                'disabled',
                'gate_evidence_missing',
                'ownership_incomplete',
                'pilot_limit',
                'kbar_contract_unsupported',
                'capacity_exhausted',
                'subscription_confirmation_pending',
                'subscription_confirmation_unknown',
                'baseline_missing',
                'baseline_incomplete',
                'stream_disconnected',
                'continuity_unproven',
                'invalid_observation',
                'stale_generation',
                'revision_conflict',
            ].includes(input.reasonCode) &&
            (input.connectionGeneration === null ||
                (typeof input.connectionGeneration === 'string' &&
                    CONNECTION_GENERATION_ID.test(input.connectionGeneration))) &&
            (input.physicalKey === null ||
                (typeof input.physicalKey === 'string' &&
                    input.physicalKey.length > 0)) &&
            instant(input.updatedAt),
    );
}

export function isIntradayMonitorCapacityStatus(
    value: unknown,
): value is IntradayMonitorCapacityStatus {
    const input = record(value);
    if (
        !input ||
        !exactKeys(input, [
            'schemaVersion',
            'gate0EvidenceCurrent',
            'globalOwnershipComplete',
            'subscriptionTransportAuthority',
            'configured',
            'eligible',
            'active',
            'waiting',
            'degraded',
            'confirmedPhysicalUsage',
            'confirmedOtherPhysicalUsage',
            'localPhysicalLimit',
            'requiredHeadroom',
            'availableForMonitor',
            'connectionGeneration',
            'evidenceAt',
        ]) ||
        input.schemaVersion !== INTRADAY_MONITOR_CAPACITY_SCHEMA ||
        typeof input.gate0EvidenceCurrent !== 'boolean' ||
        typeof input.globalOwnershipComplete !== 'boolean' ||
        typeof input.subscriptionTransportAuthority !== 'boolean' ||
        ![
            input.configured,
            input.eligible,
            input.active,
            input.waiting,
            input.degraded,
            input.availableForMonitor,
        ].every(safeCount) ||
        (input.confirmedPhysicalUsage !== null &&
            !safeCount(input.confirmedPhysicalUsage)) ||
        (input.confirmedOtherPhysicalUsage !== null &&
            !safeCount(input.confirmedOtherPhysicalUsage)) ||
        input.localPhysicalLimit !== INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT ||
        input.requiredHeadroom !== INTRADAY_MONITOR_REQUIRED_HEADROOM ||
        (input.connectionGeneration !== null &&
            (typeof input.connectionGeneration !== 'string' ||
                !CONNECTION_GENERATION_ID.test(input.connectionGeneration))) ||
        (input.evidenceAt !== null && !instant(input.evidenceAt))
    ) {
        return false;
    }
    if (
        Number(input.configured) > INTRADAY_MONITOR_MAX_CONFIGURED ||
        Number(input.eligible) > Number(input.configured) ||
        Number(input.active) > Number(input.eligible) ||
        Number(input.active) + Number(input.waiting) + Number(input.degraded) >
            Number(input.configured)
    ) {
        return false;
    }
    const gateReady =
        input.gate0EvidenceCurrent &&
        input.globalOwnershipComplete &&
        input.subscriptionTransportAuthority;
    if (!gateReady) {
        return (
            input.active === 0 &&
            input.availableForMonitor === 0 &&
            input.confirmedPhysicalUsage === null &&
            input.confirmedOtherPhysicalUsage === null &&
            input.connectionGeneration === null
        );
    }
    if (
        input.confirmedPhysicalUsage === null ||
        input.confirmedOtherPhysicalUsage === null ||
        input.connectionGeneration === null ||
        input.evidenceAt === null
    ) {
        return false;
    }
    return (
        Number(input.confirmedPhysicalUsage) <=
            INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT &&
        Number(input.availableForMonitor) ===
            Math.max(
                0,
                INTRADAY_MONITOR_LOCAL_PHYSICAL_LIMIT -
                    Number(input.confirmedPhysicalUsage),
            )
    );
}
