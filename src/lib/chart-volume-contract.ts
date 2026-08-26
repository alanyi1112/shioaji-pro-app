import { addKbarTurnoverTwd, parseKbarTurnoverTwd } from './kbar-turnover';

export const TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION =
    'taiwan-stock-common-lot/1' as const;

export type TaiwanStockVolumeSourceUnit = 'common_lot' | 'share';

export type TaiwanStockCanonicalVolume = Readonly<{
    status: 'available';
    market: 'TW';
    securityType: 'STK';
    value: number;
    unit: 'common_lot';
    provider: string;
    sourceUnit: TaiwanStockVolumeSourceUnit;
    normalizationRevision: typeof TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION;
}>;

export type TaiwanStockUnavailableVolume = Readonly<{
    status: 'unavailable';
    reason:
        | 'unsupported_market'
        | 'unsupported_security_type'
        | 'provider_unit_mismatch'
        | 'invalid_source_value'
        | 'unknown_provider';
}>;

export type TaiwanStockVolumeNormalization =
    | TaiwanStockCanonicalVolume
    | TaiwanStockUnavailableVolume;

export function isAdvancingTaiwanStockTradeTick(input: Readonly<{
    simtrade?: unknown;
    volume?: unknown;
}>): boolean {
    return (
        input.simtrade === false &&
        typeof input.volume === 'number' &&
        Number.isSafeInteger(input.volume) &&
        input.volume > 0
    );
}

const SHIOAJI_PROVIDERS = new Set([
    'shioaji',
    'shioaji-kbars',
    'shioaji-realtime',
]);

const SHARE_PROVIDERS = new Set([
    'yahoo-chart',
    'yfinance',
    'yfinance+twse-official-tail-v1',
    'twse',
    'tpex',
    'twse-official',
    'tpex-official',
    'twse-mis',
]);

function isShareProvider(provider: string): boolean {
    return SHARE_PROVIDERS.has(provider);
}

export function normalizeTaiwanStockVolume(input: Readonly<{
    market: string;
    securityType: string;
    provider: string;
    sourceUnit: TaiwanStockVolumeSourceUnit;
    value: number;
}>): TaiwanStockVolumeNormalization {
    if (input.market !== 'TW') {
        return { status: 'unavailable', reason: 'unsupported_market' };
    }
    if (input.securityType !== 'STK') {
        return {
            status: 'unavailable',
            reason: 'unsupported_security_type',
        };
    }
    if (!Number.isFinite(input.value) || input.value < 0) {
        return { status: 'unavailable', reason: 'invalid_source_value' };
    }

    const provider = input.provider.trim().toLowerCase();
    let value: number;
    if (SHIOAJI_PROVIDERS.has(provider)) {
        if (input.sourceUnit !== 'common_lot') {
            return {
                status: 'unavailable',
                reason: 'provider_unit_mismatch',
            };
        }
        value = input.value;
    } else if (isShareProvider(provider)) {
        if (input.sourceUnit !== 'share') {
            return {
                status: 'unavailable',
                reason: 'provider_unit_mismatch',
            };
        }
        value = input.value / 1000;
    } else {
        return { status: 'unavailable', reason: 'unknown_provider' };
    }

    return Object.freeze({
        status: 'available',
        market: 'TW',
        securityType: 'STK',
        value,
        unit: 'common_lot',
        provider,
        sourceUnit: input.sourceUnit,
        normalizationRevision: TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION,
    });
}

export function readCurrentTaiwanStockCanonicalVolume(
    value: unknown,
): TaiwanStockCanonicalVolume | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<TaiwanStockCanonicalVolume>;
    if (
        candidate.status !== 'available' ||
        candidate.market !== 'TW' ||
        candidate.securityType !== 'STK' ||
        candidate.unit !== 'common_lot' ||
        candidate.normalizationRevision !==
            TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION ||
        typeof candidate.provider !== 'string' ||
        !candidate.provider ||
        (candidate.sourceUnit !== 'common_lot' &&
            candidate.sourceUnit !== 'share') ||
        typeof candidate.value !== 'number' ||
        !Number.isFinite(candidate.value) ||
        candidate.value < 0
    ) {
        return null;
    }
    const provider = candidate.provider.trim().toLowerCase();
    const trustedProviderUnit =
        (SHIOAJI_PROVIDERS.has(provider) &&
            candidate.sourceUnit === 'common_lot') ||
        (isShareProvider(provider) && candidate.sourceUnit === 'share');
    if (provider !== candidate.provider || !trustedProviderUnit) return null;
    return Object.freeze({
        status: 'available',
        market: 'TW',
        securityType: 'STK',
        value: candidate.value,
        unit: 'common_lot',
        provider,
        sourceUnit: candidate.sourceUnit,
        normalizationRevision: TAIWAN_STOCK_VOLUME_NORMALIZATION_REVISION,
    });
}

export type CommonLotVolumeCursorResult = Readonly<{
    accepted: boolean;
    delta: number;
    turnoverDeltaTwd: number | null;
    turnoverAvailable: boolean;
    reason:
        | 'accepted'
        | 'unseeded'
        | 'identity_mismatch'
        | 'invalid_event'
        | 'old_session'
        | 'session_change_requires_bootstrap'
        | 'old_source_time'
        | 'sequence_not_advanced'
        | 'total_volume_regressed';
}>;

type CommonLotVolumeCursorEvent = Readonly<{
    identity: string;
    sessionDate: string;
    sourceTime: number;
    sequence: number;
    totalVolume: number;
    totalTurnoverTwd?: unknown;
    turnoverTwd?: unknown;
}>;

type CommonLotVolumeCursorState = CommonLotVolumeCursorEvent &
    Readonly<{
        totalTurnoverTwd: number | null;
        turnoverAvailable: boolean;
    }>;

function validCursorEvent(event: CommonLotVolumeCursorEvent): boolean {
    return (
        event.identity.length > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(event.sessionDate) &&
        Number.isFinite(event.sourceTime) &&
        Number.isInteger(event.sequence) &&
        event.sequence >= 0 &&
        Number.isFinite(event.totalVolume) &&
        event.totalVolume >= 0
    );
}

export class CommonLotVolumeCursor {
    private state: CommonLotVolumeCursorState | null = null;

    clear(): void {
        this.state = null;
    }

    private invalidateTurnoverChain(): void {
        if (!this.state || !this.state.turnoverAvailable) return;
        this.state = Object.freeze({
            ...this.state,
            totalTurnoverTwd: null,
            turnoverAvailable: false,
        });
    }

    reset(event: CommonLotVolumeCursorEvent): boolean {
        if (!validCursorEvent(event)) {
            this.clear();
            return false;
        }
        const totalTurnoverTwd = parseKbarTurnoverTwd(
            event.totalTurnoverTwd,
        );
        this.state = Object.freeze({
            ...event,
            totalTurnoverTwd,
            turnoverAvailable: totalTurnoverTwd !== null,
        });
        return true;
    }

    consume(event: CommonLotVolumeCursorEvent): CommonLotVolumeCursorResult {
        if (!validCursorEvent(event)) {
            return {
                accepted: false,
                delta: 0,
                turnoverDeltaTwd: null,
                turnoverAvailable: false,
                reason: 'invalid_event',
            };
        }
        const previous = this.state;
        if (!previous) {
            return {
                accepted: false,
                delta: 0,
                turnoverDeltaTwd: null,
                turnoverAvailable: false,
                reason: 'unseeded',
            };
        }
        if (event.identity !== previous.identity) {
            return {
                accepted: false,
                delta: 0,
                turnoverDeltaTwd: null,
                turnoverAvailable: previous.turnoverAvailable,
                reason: 'identity_mismatch',
            };
        }
        if (event.sessionDate < previous.sessionDate) {
            this.invalidateTurnoverChain();
            return {
                accepted: false,
                delta: 0,
                turnoverDeltaTwd: null,
                turnoverAvailable: false,
                reason: 'old_session',
            };
        }
        if (event.sourceTime < previous.sourceTime) {
            this.invalidateTurnoverChain();
            return {
                accepted: false,
                delta: 0,
                turnoverDeltaTwd: null,
                turnoverAvailable: false,
                reason: 'old_source_time',
            };
        }
        if (
            event.sessionDate === previous.sessionDate &&
            event.sequence <= previous.sequence
        ) {
            this.invalidateTurnoverChain();
            return {
                accepted: false,
                delta: 0,
                turnoverDeltaTwd: null,
                turnoverAvailable: false,
                reason: 'sequence_not_advanced',
            };
        }
        if (event.sessionDate > previous.sessionDate) {
            this.invalidateTurnoverChain();
            return {
                accepted: false,
                delta: 0,
                turnoverDeltaTwd: null,
                turnoverAvailable: false,
                reason: 'session_change_requires_bootstrap',
            };
        }
        if (event.totalVolume < previous.totalVolume) {
            this.invalidateTurnoverChain();
            return {
                accepted: false,
                delta: 0,
                turnoverDeltaTwd: null,
                turnoverAvailable: false,
                reason: 'total_volume_regressed',
            };
        }
        const sourceTotalTurnover = parseKbarTurnoverTwd(
            event.totalTurnoverTwd,
        );
        const sourceTickTurnover = parseKbarTurnoverTwd(event.turnoverTwd);
        const hasSourceTotalTurnover =
            event.totalTurnoverTwd !== undefined;
        const hasSourceTickTurnover = event.turnoverTwd !== undefined;
        let turnoverDeltaTwd: number | null = null;
        let nextTotalTurnoverTwd: number | null = null;
        let turnoverAvailable = previous.turnoverAvailable;
        if (
            (hasSourceTotalTurnover && sourceTotalTurnover === null) ||
            (hasSourceTickTurnover && sourceTickTurnover === null)
        ) {
            turnoverAvailable = false;
        }
        if (turnoverAvailable && previous.totalTurnoverTwd !== null) {
            if (sourceTotalTurnover !== null) {
                if (sourceTotalTurnover >= previous.totalTurnoverTwd) {
                    const cumulativeDelta =
                        sourceTotalTurnover - previous.totalTurnoverTwd;
                    // Bootstrap、React batch 或 transport coalescing 可能讓
                    // sequence 跳號；此時 total_amount 的差額涵蓋多筆成交，
                    // 不可拿最後一筆 amount 強制作相等比較。
                    const singleAcceptedTick =
                        event.sequence === previous.sequence + 1;
                    if (
                        sourceTickTurnover === null ||
                        !singleAcceptedTick ||
                        sourceTickTurnover === cumulativeDelta
                    ) {
                        turnoverDeltaTwd = cumulativeDelta;
                        nextTotalTurnoverTwd = sourceTotalTurnover;
                    } else {
                        turnoverAvailable = false;
                    }
                } else {
                    turnoverAvailable = false;
                }
            } else if (sourceTickTurnover !== null) {
                nextTotalTurnoverTwd = addKbarTurnoverTwd(
                    previous.totalTurnoverTwd,
                    sourceTickTurnover,
                );
                if (nextTotalTurnoverTwd !== null) {
                    turnoverDeltaTwd = sourceTickTurnover;
                } else {
                    turnoverAvailable = false;
                }
            } else {
                turnoverAvailable = false;
            }
        }
        if (!turnoverAvailable) {
            turnoverDeltaTwd = null;
            nextTotalTurnoverTwd = null;
        }
        this.state = Object.freeze({
            ...event,
            totalTurnoverTwd: nextTotalTurnoverTwd,
            turnoverAvailable,
        });
        return {
            accepted: true,
            delta: event.totalVolume - previous.totalVolume,
            turnoverDeltaTwd,
            turnoverAvailable,
            reason: 'accepted',
        };
    }

    snapshot(): CommonLotVolumeCursorState | null {
        return this.state ? Object.freeze({ ...this.state }) : null;
    }
}
