export const LEGACY_TRIGGER_STORAGE_KEY = 'sj-pro-triggers';
export const SMART_ORDER_LEGACY_INSPECTION_SCHEMA_VERSION =
    'smart-order-legacy-inspection/2026-08-11.1';

const MAX_LEGACY_TRIGGER_BYTES = 256 * 1024;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,96}$/;
const SAFE_CONTRACT_CODE = /^[A-Za-z0-9._-]{1,32}$/;

type LegacyTriggerKind = 'alert' | 'stop' | 'take';

export interface LegacyTriggerInspectionItem {
    readonly sourceIndex: number;
    readonly legacyId: string | null;
    readonly contractCode: string | null;
    readonly kind: LegacyTriggerKind | 'unknown';
    readonly disposition:
        | 'pure_alert_read_only'
        | 'manual_rebuild_required'
        | 'invalid_ignored';
    readonly reasonCode:
        | 'LEGACY_PURE_ALERT_REVIEW_REQUIRED'
        | 'LEGACY_TRADING_TRIGGER_MISSING_AUTHORITY'
        | 'LEGACY_TRIGGER_INVALID';
}

export interface LegacyTriggerInspection {
    readonly schemaVersion: typeof SMART_ORDER_LEGACY_INSPECTION_SCHEMA_VERSION;
    readonly source: 'browser_local_storage';
    readonly parsed: boolean;
    readonly truncated: boolean;
    readonly totalEntries: number;
    readonly pureAlertCount: number;
    readonly manualRebuildCount: number;
    readonly invalidCount: number;
    readonly items: readonly LegacyTriggerInspectionItem[];
    readonly brokerWriteAuthorized: false;
    readonly automaticallyImported: false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeString(
    value: unknown,
    pattern: RegExp,
): string | null {
    return typeof value === 'string' && pattern.test(value) ? value : null;
}

function classifyLegacyTrigger(
    value: unknown,
    sourceIndex: number,
): LegacyTriggerInspectionItem {
    const record = isRecord(value) ? value : null;
    const kind =
        record?.kind === 'alert' ||
        record?.kind === 'stop' ||
        record?.kind === 'take'
            ? record.kind
            : 'unknown';
    const legacyId = safeString(record?.id, SAFE_ID);
    const contractCode = safeString(record?.code, SAFE_CONTRACT_CODE);
    const conditionValid =
        record?.condition === 'below' || record?.condition === 'above';
    const priceValid =
        typeof record?.price === 'number' &&
        Number.isFinite(record.price) &&
        record.price > 0;

    if (
        kind === 'alert' &&
        legacyId !== null &&
        contractCode !== null &&
        conditionValid &&
        priceValid
    ) {
        return Object.freeze({
            sourceIndex,
            legacyId,
            contractCode,
            kind,
            disposition: 'pure_alert_read_only',
            reasonCode: 'LEGACY_PURE_ALERT_REVIEW_REQUIRED',
        });
    }

    if (kind === 'stop' || kind === 'take') {
        return Object.freeze({
            sourceIndex,
            legacyId,
            contractCode,
            kind,
            disposition: 'manual_rebuild_required',
            reasonCode: 'LEGACY_TRADING_TRIGGER_MISSING_AUTHORITY',
        });
    }

    return Object.freeze({
        sourceIndex,
        legacyId,
        contractCode,
        kind,
        disposition: 'invalid_ignored',
        reasonCode: 'LEGACY_TRIGGER_INVALID',
    });
}

function emptyInspection(input: {
    parsed: boolean;
    truncated: boolean;
}): LegacyTriggerInspection {
    return Object.freeze({
        schemaVersion: SMART_ORDER_LEGACY_INSPECTION_SCHEMA_VERSION,
        source: 'browser_local_storage',
        parsed: input.parsed,
        truncated: input.truncated,
        totalEntries: 0,
        pureAlertCount: 0,
        manualRebuildCount: 0,
        invalidCount: 0,
        items: Object.freeze([]),
        brokerWriteAuthorized: false,
        automaticallyImported: false,
    });
}

/**
 * This parser is intentionally one-way and read-only. It never returns an
 * executable order payload, account reference, unit, confirmation or broker
 * correlation. Callers cannot use its result as Runtime authority.
 */
export function inspectLegacyTriggerJson(
    raw: string | null,
): LegacyTriggerInspection {
    if (raw === null || raw === '') {
        return emptyInspection({ parsed: true, truncated: false });
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_LEGACY_TRIGGER_BYTES) {
        return emptyInspection({ parsed: false, truncated: true });
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw) as unknown;
    } catch {
        return emptyInspection({ parsed: false, truncated: false });
    }
    if (!Array.isArray(parsed)) {
        return emptyInspection({ parsed: false, truncated: false });
    }

    const items = Object.freeze(parsed.map(classifyLegacyTrigger));
    return Object.freeze({
        schemaVersion: SMART_ORDER_LEGACY_INSPECTION_SCHEMA_VERSION,
        source: 'browser_local_storage',
        parsed: true,
        truncated: false,
        totalEntries: items.length,
        pureAlertCount: items.filter(
            (item) => item.disposition === 'pure_alert_read_only',
        ).length,
        manualRebuildCount: items.filter(
            (item) => item.disposition === 'manual_rebuild_required',
        ).length,
        invalidCount: items.filter(
            (item) => item.disposition === 'invalid_ignored',
        ).length,
        items,
        brokerWriteAuthorized: false,
        automaticallyImported: false,
    });
}

export function inspectLegacyTriggerStorage(
    storage: Pick<Storage, 'getItem'>,
): LegacyTriggerInspection {
    try {
        return inspectLegacyTriggerJson(
            storage.getItem(LEGACY_TRIGGER_STORAGE_KEY),
        );
    } catch {
        return emptyInspection({ parsed: false, truncated: false });
    }
}

export const LEGACY_BRACKET_RECOVERY = Object.freeze({
    recoverable: false,
    brokerWriteAuthorized: false,
    reasonCode: 'LEGACY_MEMORY_BRACKET_NOT_RECOVERABLE' as const,
    message:
        '舊版記憶體括號單無法在重新整理或重啟後可靠復原；請人工核對券商委託與部位，再於新 Runtime 重新建立保護。',
});
