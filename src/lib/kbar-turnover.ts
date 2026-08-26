export type KbarTurnoverWanDisplay = Readonly<{
    value: string;
    accessibleName: string;
}>;

const CANONICAL_INTEGER_DECIMAL = /^(?:0|[1-9]\d*)(?:\.0+)?$/;

/**
 * 只接受可精確表示的非負整數元值。字串形態保留給 Shioaji Decimal
 * 序列化結果；空白、指數、正負號與小數元一律拒絕。
 */
export function parseKbarTurnoverTwd(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    if (
        typeof value !== 'string' ||
        !CANONICAL_INTEGER_DECIMAL.test(value)
    ) {
        return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function addKbarTurnoverTwd(
    left: number | null,
    right: number | null,
): number | null {
    if (left === null || right === null) return null;
    const total = left + right;
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

export function formatKbarTurnoverWan(
    turnoverTwd: number | null,
): KbarTurnoverWanDisplay {
    if (turnoverTwd === null || parseKbarTurnoverTwd(turnoverTwd) === null) {
        return Object.freeze({ value: '—', accessibleName: '成交值 —' });
    }
    if (turnoverTwd === 0) {
        return Object.freeze({
            value: '0萬',
            accessibleName: '成交值 0萬元',
        });
    }
    if (turnoverTwd < 1_000) {
        return Object.freeze({
            value: '<0.1萬',
            accessibleName: '成交值小於 0.1萬元',
        });
    }
    const wan = turnoverTwd / 10_000;
    const formatted =
        wan >= 100
            ? Math.round(wan).toLocaleString('en-US')
            : wan.toLocaleString('en-US', {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
              });
    return Object.freeze({
        value: `${formatted}萬`,
        accessibleName: `成交值 ${formatted}萬元`,
    });
}
