import { describe, expect, it } from 'vitest';
import { stockScreenerVolumeComparison } from './stock-screener-volume-comparison';

describe('選股官方盤後與 Shioaji Snapshot 成交量比較', () => {
    it('將官方股數精確換算成張並顯示正差異', () => {
        expect(stockScreenerVolumeComparison({
            officialShares: '2493846', officialDate: '2026-09-02',
            snapshotLots: 2475, snapshotDate: '2026-09-02',
        })).toEqual({ officialLots: '2,493.846', snapshotLots: '2,475', differenceLots: '+18.846' });
    });

    it('保留不足一張的負差異，完全相同時顯示零', () => {
        expect(stockScreenerVolumeComparison({
            officialShares: '299999', officialDate: '2026-09-02',
            snapshotLots: 300, snapshotDate: '2026-09-02',
        })?.differenceLots).toBe('-0.001');
        expect(stockScreenerVolumeComparison({
            officialShares: '300000', officialDate: '2026-09-02',
            snapshotLots: 300, snapshotDate: '2026-09-02',
        })?.differenceLots).toBe('0');
    });

    it('日期不同或任一來源無效時不製造差異', () => {
        expect(stockScreenerVolumeComparison({
            officialShares: '300000', officialDate: '2026-09-01',
            snapshotLots: 300, snapshotDate: '2026-09-02',
        })).toBeNull();
        expect(stockScreenerVolumeComparison({
            officialShares: '3e5', officialDate: '2026-09-02',
            snapshotLots: 300, snapshotDate: '2026-09-02',
        })).toBeNull();
    });
});
