import { describe, expect, it, vi } from 'vitest';
import {
    clearPivotStatesForIndicator,
    getPivotProductState,
    getPivotProductStateVersion,
    pivotProductKey,
    setPivotProductState,
    subscribePivotProductStates,
} from './pivot-projection-state';
import type { PivotReferenceDay } from './traditional-pivot';

const reference: PivotReferenceDay = {
    date: '2026-08-07',
    high: 110,
    low: 90,
    close: 100,
    firstTime: 1,
    lastTime: 2,
    status: 'completed',
    applicationDate: '2026-08-10',
    applicationStartTime: 3,
    levels: { p: 100, r1: 110, r2: 120, r3: 130, s1: 90, s2: 80, s3: 70 },
};

describe('product-scoped Pivot state', () => {
    it('key 包含 indicator/security/exchange/code 且不含 timeframe', () => {
        const key = pivotProductKey('pivot-1', {
            security_type: 'STK',
            exchange: 'TSE',
            code: ' 2330 ',
        });
        expect(key).toBe('pivot-1|STK|TSE|2330');
        expect(key).not.toContain('1440');
    });

    it('同商品多圖訂閱同一 projection，不同商品隔離且相同值不重送', () => {
        const listener = vi.fn();
        const unsubscribe = subscribePivotProductStates(listener);
        const firstKey = pivotProductKey('pivot-1', {
            security_type: 'STK',
            exchange: 'TSE',
            code: '2330',
        });
        const otherKey = pivotProductKey('pivot-1', {
            security_type: 'STK',
            exchange: 'TSE',
            code: '2303',
        });
        const before = getPivotProductStateVersion();
        setPivotProductState({
            key: firstKey,
            indicatorId: 'pivot-1',
            reference,
            pinned: false,
        });
        setPivotProductState({
            key: firstKey,
            indicatorId: 'pivot-1',
            reference: { ...reference },
            pinned: false,
        });
        expect(getPivotProductState(firstKey)?.reference.date).toBe(
            '2026-08-07',
        );
        expect(getPivotProductState(otherKey)).toBeNull();
        expect(getPivotProductStateVersion()).toBe(before + 1);
        expect(listener).toHaveBeenCalledTimes(1);
        clearPivotStatesForIndicator('pivot-1');
        expect(getPivotProductState(firstKey)).toBeNull();
        unsubscribe();
    });
});
