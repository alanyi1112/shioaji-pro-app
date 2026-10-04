import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';
import { createDynamicDailyCohortPlan, validateDynamicDailyCohortPlan,
    writeDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))));

function item(code, position, enabled = true) {
    return { contract: { security_type: 'STK', region: 'TW', exchange: 'TSE',
        code, target_code: null }, enabled,
    thresholdOverride: null, source: 'manual' };
}

function config(codes) {
    const result = validateIntradayMonitorConfig({ schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision: 9, globalThreshold: '1.5', items: codes.map((code, index) => item(code, index)) });
    expect(result.ok).toBe(true);
    return result.value;
}

const authority = { schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
    current: true, isTradingDate: true, tradeDate: '2026-09-30',
    previousTradeDate: '2026-09-29', sourceVersions: ['official-fixture'],
    observedAt: '2026-09-29T13:35:00+08:00' };
const approval = { decision: 'go', approvedActiveLimit: 160, approvalHash: 'a'.repeat(64) };

function plan(savedConfig, overrides = {}) {
    return createDynamicDailyCohortPlan({ config: savedConfig, authority, approval,
        createdAt: '2026-09-29T13:36:00+08:00', ...overrides });
}

function rehash(value) {
    const { planHash, ...body } = value;
    return { ...body, planHash: createHash('sha256').update(canonicalJson(body,
        { maximumBytes: 1024 * 1024 })).digest('hex') };
}

describe('動態每日監控候選 plan', () => {
    it('合法名單重排不改變入選集合，亦不依歷史固定名單驗證', () => {
        const first = plan(config(['2330', '2317', '2454']));
        const reordered = plan(config(['2454', '2330', '2317']));
        expect(first.selected.map((entry) => entry.canonicalSymbol).sort()).toEqual(
            reordered.selected.map((entry) => entry.canonicalSymbol).sort());
        expect(first.planHash).not.toBe(reordered.planHash);
        expect(validateDynamicDailyCohortPlan(first)).toBe(true);
    });

    it('200 檔設定只選前 160 檔，另列 40 檔候補，不暗中補位', () => {
        const codes = Array.from({ length: 200 }, (_, index) => String(1000 + index));
        const value = plan(config(codes));
        expect(value.selected).toHaveLength(160);
        expect(value.waiting).toHaveLength(40);
        expect(value.waiting[0]).toMatchObject({ canonicalSymbol: '1160.TW', reason: 'waiting_capacity' });
        expect(validateDynamicDailyCohortPlan(value)).toBe(true);
    });

    it('不支援 KBar 的五碼合約保留在排除名單，不使合法 plan 失效', () => {
        const value = plan(config(['2330', '12345']));
        expect(value.selected.map((entry) => entry.canonicalSymbol)).toEqual(['2330.TW']);
        expect(value.excluded).toMatchObject([{ canonicalSymbol: '12345.TW',
            reason: 'kbar_contract_unsupported' }]);
        expect(validateDynamicDailyCohortPlan(value)).toBe(true);
    });

    it('拒絕沒有官方交易日或容量核准的 plan', () => {
        expect(() => plan(config(['2330']), { authority: { ...authority, current: false } }))
            .toThrow('daily_plan_calendar_authority_invalid');
        expect(() => plan(config(['2330']), { approval: { ...approval, approvedActiveLimit: 20 } }))
            .toThrow('daily_plan_input_invalid');
    });

    it('即使重算 hash，仍拒絕冒充的商品順序、位置與交易所', () => {
        const original = plan(config(['2330', '2317']));
        expect(validateDynamicDailyCohortPlan(rehash({ ...original,
            selected: [...original.selected].reverse() }))).toBe(false);
        expect(validateDynamicDailyCohortPlan(rehash({ ...original,
            selected: original.selected.map((entry) => ({ ...entry, position: 0 })) })))
            .toBe(false);
        expect(validateDynamicDailyCohortPlan(rehash({ ...original,
            selected: [{ ...original.selected[0], exchange: 'OTC' },
                original.selected[1]] }))).toBe(false);
    });

    it('不可變候選 plan 原子保存，相同內容重試冪等', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'intraday-daily-plan-'));
        roots.push(root);
        const value = plan(config(['2330', '2317']));
        const first = await writeDynamicDailyCohortPlan(root, value);
        const second = await writeDynamicDailyCohortPlan(root, value);
        expect(first).toEqual(second);
        expect(JSON.parse(await readFile(first.path, 'utf8'))).toEqual(value);
    });
});
