import { describe, expect, it } from 'vitest';
import { dailyBollingerCriteria, dailyBollingerSaveError } from './stock-screener-daily-bollinger-ui';
import { BOLLINGER_STAGES, validateCriteriaV8 } from './stock-screener-v8';

describe('每日布林獨立草稿', () => {
    it('新設定合法且全選，無舊條件混入', () => {
        const value = dailyBollingerCriteria(null);
        expect(validateCriteriaV8(value)).toBe(true);
        expect(value.bollSqueezeStages.stages).toEqual([...BOLLINGER_STAGES]);
        const { bollSqueezeStages, ...legacy } = value;
        expect(bollSqueezeStages.enabled).toBe(true);
        expect(Object.values(legacy).filter(v => typeof v === 'object' && v !== null && 'enabled' in v && v.enabled)).toHaveLength(0);
    });
    it('既有單項、自訂參數與原資料隔離', () => {
        const criteria = dailyBollingerCriteria(null);
        criteria.bollSqueezeStages.stages = ['breakout']; criteria.bollSqueezeStages.breakoutVolumeRatio = '2';
        const profile = { revision: 3, enabled: true, criteria, createdAt: '2026-10-04T00:00:00Z' };
        const cloned = dailyBollingerCriteria(profile);
        expect(cloned).toEqual(criteria); cloned.bollSqueezeStages.stages.push('preparing');
        expect(profile.criteria.bollSqueezeStages.stages).toEqual(['breakout']);
    });
    it('停用的舊profile可明確重新啟用，原profile不變', () => {
        const criteria = dailyBollingerCriteria(null); criteria.volume.enabled = true; criteria.bollSqueezeStages.enabled = false;
        const profile = { revision: 2, enabled: false, criteria, createdAt: '2026-10-04' };
        expect(dailyBollingerCriteria(profile).bollSqueezeStages.enabled).toBe(true);
        expect(profile.criteria.bollSqueezeStages.enabled).toBe(false);
    });
    it.each([[409, undefined, '其他視窗'], [403, 'same_origin_required', '安全檢查'],
        [400, 'invalid_daily_profile', '參數無效'], [503, 'schema_pending', '尚未就緒'],
        [413, 'payload_too_large', '大小限制'], [500, undefined, 'HTTP 500']])('HTTP %s 保留可診斷原因', (status, reason, text) => {
        expect(dailyBollingerSaveError(status as number, reason as string | undefined)).toContain(text);
    });
});
