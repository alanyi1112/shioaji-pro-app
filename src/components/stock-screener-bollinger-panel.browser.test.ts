import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { StockScreenerPanel } from './stock-screener-panel';
import { StockScreenerBollingerResults } from './stock-screener-bollinger-results';
import { DEFAULT_CRITERIA_V7 } from '../lib/stock-screener-v7';
import { buildBollingerFrozenFeatures, countBollingerStages, evaluateBollingerStages, migrateCriteriaV7ToV8 } from '../lib/stock-screener-v8';
import { BOLLINGER_PREFS, decodeBollingerResponse, type BollingerQueryDraft, type BollingerResponse } from '../lib/stock-screener-bollinger-api';
import { darkTwClass, vars } from '../theme.css';
import { technicalEvidenceHash } from '../lib/stock-screener-technical-patterns';
import type { BollingerSourceEvidence } from '../lib/stock-screener-source-evidence';
import { BOLLINGER_SOURCE_COMPARISON_POLICY, BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY } from '../lib/stock-screener-source-comparison';
import '../index.css';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// 全部是隔離的 UI fixture，不能用作正式來源／發布驗收。
const sessions = Array.from({ length: 160 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
const c = migrateCriteriaV7ToV8(DEFAULT_CRITERIA_V7);
for (const v of Object.values(c)) if (v && typeof v === 'object' && 'enabled' in v) v.enabled = false;
c.bollSqueezeStages.enabled = true;
const query: BollingerQueryDraft = { criteria: c, sort: 'code', direction: 'asc', resultState: 'matched' };
const f = await buildBollingerFrozenFeatures(sessions.map((sessionDate, i) => ({ sessionDate, open: '100', high: '120', low: '99',
    close: String(100 + i * .1), volumeShares: '1000000', turnoverNtd: '100000000' })), sessions);
const calculated = await evaluateBollingerStages(f, c.bollSqueezeStages);
const rows = [{ symbol: '2449.TW', code: '2449', name: '上市測試股', market: 'TWSE' as const, ordinary: true, verdict: 'pass' as const,
    outcome: { ...calculated, stage: 'compressing' as const }, legacyEvidence: null },
{ symbol: '6488.TWO', code: '6488', name: '上櫃測試股', market: 'TPEx' as const, ordinary: true, verdict: 'unknown' as const,
    outcome: { ...calculated, stage: 'unknown' as const }, legacyEvidence: null }];
const report = { version: 8, state: 'ready', reason: 'none', formulaVersion: f.formulaVersion, sourceMappingVersion: f.sourceMappingVersion,
    snapshotId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', expectedSessionDate: f.through, effectiveSessionDate: f.through,
    canUseResults: true, rows, nextCursor: null, counts: countBollingerStages(rows.map(r => ({ market: r.market, stage: r.outcome.stage }))),
    combinationCounts: { total: 2, matched: 1, notMatched: 0, unknown: 1 } };
const fixtureSelections: BollingerSourceEvidence['selections'] = [];
for (const sessionDate of sessions) for (const market of ['TWSE', 'TPEx'] as const) {
    const content = { policyVersion: 'bollinger-source-selection-v1' as const, universeRevision: 'fixture-u', universeHash: 'a'.repeat(64),
        market, sessionDate, provider: 'shioaji-daily-quotes' as const, mappingVersion: 'shioaji-daily-quotes-shares-twd-v1',
        payloadHash: 'b'.repeat(64), reviewId: 'c'.repeat(64), reviewHash: 'd'.repeat(64), requestedDate: sessionDate, actualDate: sessionDate,
        switchReason: 'official_contract_pending', rowsHash: 'e'.repeat(64), rowCount: 1, officialFailures: [] };
    fixtureSelections.push({ ...content, manifestHash: await technicalEvidenceHash(content) });
}
const fixtureManifest = { policyVersion: 'bollinger-source-selection-v1' as const, universeRevision: 'fixture-u', universeHash: 'a'.repeat(64),
    entries: fixtureSelections.map(s => ({ sessionDate: s.sessionDate, market: s.market, manifestHash: s.manifestHash })) };
const fixtureManifestHash = await technicalEvidenceHash(fixtureManifest);
const backupReport = { ...report, sourceMappingVersion: `bollinger-source-selection-v1:${fixtureManifestHash}`,
    sourceEvidence: { manifest: fixtureManifest, manifestHash: fixtureManifestHash, selections: fixtureSelections },
    sourceConflicts: [{ id: 'f'.repeat(64), market: 'TWSE', sessionDate: f.through, provider: 'official-twse',
        frozenPayloadHash: 'b'.repeat(64), officialPayloadHash: 'a'.repeat(64) }],
    sourceVolumeTolerances: [{ id: '1'.repeat(64), market: 'TWSE', sessionDate: f.through, provider: 'official-twse',
        frozenPayloadHash: 'b'.repeat(64), officialPayloadHash: 'a'.repeat(64),
        comparisonPolicyVersion: BOLLINGER_SOURCE_COMPARISON_POLICY.version, volumeTolerancePercent: 1, toleratedSymbols: 1,
        samples: [{ symbol: '2449.TW', volumeDifferences: [{ field: 'bar.volumeShares', frozenShares: '1000000', officialShares: '1000001', absoluteDifferenceShares: '1', withinTolerance: true }] }] }],
    rows: rows.map(r => ({ ...r, outcome: { ...r.outcome, sourceMappingVersion: `bollinger-source-selection-v1:${fixtureManifestHash}` } })) };
const legacy = { version: 7, state: 'pending', reason: 'v7_preparation_pending', snapshotId: null, universeRevision: null,
    formulaVersion: 'after-market-v7-boll-rsi-kd-macd-1', sourceMappingVersion: 'official-daily-ohlcv-v2', criteriaFingerprint: null,
    expectedSessionDate: null, effectiveSessionDate: null, createdAt: null, anchors: { daily: null, weekly: null, weeklyPeriods: [] },
    technicalAnchors: null, counts: null, byMarket: null, preparation: null, chipCoverage: null, institutionalCoverage: null,
    technicalCoverage: null, rows: [], nextCursor: null };
const amountReport = { ...backupReport, sourceVolumeTolerances: [{ ...backupReport.sourceVolumeTolerances[0],
    comparisonPolicyVersion: BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY.version, turnoverToleranceNtd: 1,
    samples: [{ symbol: '2449.TW', volumeDifferences: [], turnoverDifferences: [{field:'bar.turnoverNtd',
        frozenNtd:'100000000',officialNtd:'100000001',absoluteDifferenceNtd:'1',withinTolerance:true}] }] }] };
let root: Root | null = null;
const originalFont = document.documentElement.style.fontSize;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; vi.unstubAllGlobals(); vi.restoreAllMocks();
    document.body.replaceChildren(); document.documentElement.style.fontSize = originalFont;
    localStorage.removeItem(BOLLINGER_PREFS); localStorage.removeItem('sj-pro-stock-screener-v7'); });
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
async function mount({ enabled = true, state = 'ready', width = 320, font = 32, backup = false, amount = false,
    preparationReason = 'source_contract_pending', profileFailure = 0 } = {}) {
    if (enabled) localStorage.setItem(BOLLINGER_PREFS, JSON.stringify({ version: 8, query }));
    document.documentElement.style.fontSize = `${font}px`;
    const host = document.createElement('div'); host.classList.add(darkTwClass);
    host.style.cssText = `width:${width}px;height:600px;display:flex;flex-direction:column;background:${vars.color.background};color:${vars.color.foreground};font-family:${vars.font.body}`;
    document.body.append(host); root = createRoot(host);
    let profile: { revision: number; enabled: boolean; criteria: typeof c; createdAt: string } | null = null;
    const onPick = vi.fn(async () => true), onOpenChart = vi.fn(() => 'chart'), onTargetChange = vi.fn();
    const onAddToWatchlist = vi.fn(async () => ({ status: 'complete' as const, message: '兩套清單已加入（fixture）',
        shioaji: { status: 'already_present' as const, result: { status: 'already_present' as const, listId: 'fixture' } },
        multiview: { status: 'already_present' as const, result: { status: 'already_present' as const, symbol: '2449.TW', tabId: 'fixture', tabLabel: '選股篩選' } } }));
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), location.href);
        if (url.pathname.endsWith('/daily-profile')) {
            if (init?.method === 'PUT') { const saved = JSON.parse(String(init.body));
                if (profileFailure) return Response.json({ reason: profileFailure === 409 ? 'profile_revision_conflict' : 'same_origin_required' }, { status: profileFailure });
                if (saved.expectedRevision !== (profile?.revision ?? 0)) return Response.json({ reason: 'profile_revision_conflict' }, { status: 409 });
                profile = { revision: saved.expectedRevision + 1, enabled: saved.enabled, criteria: saved.criteria, createdAt: '2026-10-03T04:00:00Z' }; }
            return Response.json({ version: 8, profile, sourceRequests: 0 });
        }
        if (url.pathname.endsWith('/status')) return Response.json(legacy);
        if (url.pathname.endsWith('/results') && url.searchParams.get('version') === '8') {
            const stage = url.searchParams.get('stage') ?? 'all';
            const selectedReport = amount ? amountReport : backup ? backupReport : report;
            return Response.json(state === 'ready' ? { ...selectedReport, rows: selectedReport.rows.filter(r => stage === 'all' || stage === r.outcome.stage) }
                : { ...report, state, reason: state === 'stale' ? 'new_session_pending' : preparationReason, canUseResults: false,
                    ...(preparationReason === 'broker_rate_limited' ? { requiredDays:160,availableDays:2,
                        preparation:{reason:preparationReason,nextAttemptAt:'2026-10-03T15:41:00Z'} } : {}),
                    ...(preparationReason === 'source_attempts_exhausted' ? { requiredDays:145,availableDays:159,
                        preparation:{reason:preparationReason,nextAttemptAt:null} } : {}),
                    ...(state === 'history_pending' ? { requiredDays:290,availableDays:160 } : {}),
                    ...(['pending', 'history_pending'].includes(state) ? { rows: [], nextCursor: null } : {}) });
        }
        throw new Error('測試不允許其他 network／broker 路徑');
    }); vi.stubGlobal('fetch', fetcher);
    await act(async () => { root?.render(createElement(StockScreenerPanel, { targets: [{ id: 'chart', label: '未鎖定圖表' }],
        onPick, onOpenChart, onTargetChange, onAddToWatchlist })); });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    return { host, fetcher, onPick, onOpenChart, onAddToWatchlist, profile: () => profile };
}
describe('布林三階段 UI（隔離 fixture）', () => {
    it.each(['dark-tw', 'dark-intl', 'midnight-tw', 'midnight-intl', 'light-tw', 'light-intl'])('%s 結果階段獨立著色，對比至少4.5且保留無法判定文字', async theme => {
        const { themeClasses } = await import('../theme.css');
        const host = document.createElement('div'); host.className = themeClasses[theme]!;
        host.style.background = vars.color.panel; host.style.color = vars.color.foreground;
        document.body.append(host); root = createRoot(host);
        const response = decodeBollingerResponse(structuredClone(report));
        response.rows = (['compressing', 'preparing', 'breakout', 'unknown', 'notMatched'] as const).map(stage => ({
            ...response.rows[0]!, symbol: `fixture-${stage}`, outcome: { ...response.rows[0]!.outcome, stage },
        }));
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        const onPick = vi.fn(), onAdd = vi.fn();
        await act(async () => root?.render(createElement(StockScreenerBollingerResults, {
            response, filter: 'all', onFilter: vi.fn(), onPick, onAdd, targetAvailable: true, statuses: {},
        })));
        const labels = ['正在壓縮', '準備突破', '今日正式突破', '無法判定', '未符合'];
        const spans = [...host.querySelectorAll<HTMLElement>('[data-bollinger-stage]')];
        expect(spans.map(s => s.textContent)).toEqual(labels);
        const luminance = (color: string) => {
            const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {
                const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
            });
            return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
        };
        const colors = spans.slice(0, 3).map(s => getComputedStyle(s).color);
        expect(new Set(colors).size).toBe(3);
        for (const background of [vars.color.panel, vars.color.muted]) {
            host.style.background = background;
            const bg = luminance(getComputedStyle(host).backgroundColor);
            for (const span of spans.slice(0, 3)) {
                const fg = luminance(getComputedStyle(span).color);
                expect((Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05)).toBeGreaterThanOrEqual(4.5);
                expect(getComputedStyle(span).fontWeight).toBe('700');
            }
        }
        expect(spans[3]!.className).toBe(''); expect(spans[4]!.className).toBe('');
        await act(async () => spans[0]!.closest('button')!.click());
        expect(onPick).toHaveBeenCalledTimes(1); expect(onAdd).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    });
    it('每日獨立按鈕不受手動全部取消影響，PUT明確保存 stages 與 revision', async () => {
        const { host, fetcher, profile } = await mount();
        await act(async () => button(host, '全部取消').click());
        const details = host.querySelector<HTMLDetailsElement>('[aria-label="每日布林策略設定"]')!;
        await act(async () => details.querySelector('summary')!.click());
        const stageButtons = host.querySelectorAll<HTMLButtonElement>('[aria-label="每日布林三階段選擇"] button');
        await act(async () => { stageButtons[0]!.click(); stageButtons[1]!.click(); });
        expect(fetcher.mock.calls.filter(([,init]) => init?.method === 'PUT')).toHaveLength(0);
        await act(async () => button(host, '儲存每日策略').click());
        expect(profile()?.criteria.bollSqueezeStages.stages).toEqual(['breakout']);
        expect(profile()?.revision).toBe(1); expect(profile()?.enabled).toBe(true);
        expect(fetcher.mock.calls.filter(([,init]) => init?.method === 'PUT')).toHaveLength(1);
        expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/results'))).toHaveLength(0);
    });
    it.each([[409, '其他視窗'], [403, '安全檢查']])('每日HTTP %s 失敗保持未儲存且不自動重試', async (profileFailure, text) => {
        const { host, fetcher, profile } = await mount({ profileFailure });
        const details = host.querySelector<HTMLDetailsElement>('[aria-label="每日布林策略設定"]')!;
        await act(async () => details.querySelector('summary')!.click());
        await act(async () => button(host, '儲存每日策略').click());
        expect(host.textContent).toContain(text); expect(profile()).toBeNull();
        expect(fetcher.mock.calls.filter(([,init]) => init?.method === 'PUT')).toHaveLength(1);
        expect(host.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(3);
    });
    it('擴窗待準備顯示所需與已備日數，不顯示可操作股票或寫入每日設定', async () => {
        const { host, fetcher, onPick, onAddToWatchlist } = await mount({ state: 'history_pending', preparationReason: 'history_pending' });
        await act(async () => button(host, '開始篩選').click());
        expect(host.textContent).toContain('所需 290 日 · 已備 160 日');
        expect(host.textContent).toContain('所需官方歷史尚未備齊');
        expect(host.textContent).not.toContain('invalid_v8_response');
        expect(host.querySelectorAll('[aria-label="布林三階段結果"] article')).toHaveLength(0);
        expect(onPick).not.toHaveBeenCalled(); expect(onAddToWatchlist).not.toHaveBeenCalled();
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    });
    it('金額1元新版證據顯示原值；decoder拒絕2元／假差異／錯政策，無來源或寫入', async () => {
        expect(decodeBollingerResponse(amountReport).sourceVolumeTolerances?.[0]?.turnoverToleranceNtd).toBe(1);
        type Tolerance = NonNullable<BollingerResponse['sourceVolumeTolerances']>[number];
        for (const tamper of [(r: Tolerance)=>{r.turnoverToleranceNtd=2;},
            (r: Tolerance)=>{r.samples[0]!.turnoverDifferences![0]!.officialNtd='100000002';},
            (r: Tolerance)=>{r.samples[0]!.turnoverDifferences![0]!.absoluteDifferenceNtd='0';},
            (r: Tolerance)=>{r.comparisonPolicyVersion='unverified-policy';}]) {
            const changed=decodeBollingerResponse(structuredClone(amountReport)); tamper(changed.sourceVolumeTolerances![0]!);
            expect(()=>decodeBollingerResponse(changed)).toThrow();
        }
        const {host,fetcher,onPick}=await mount({amount:true});
        await act(async()=>button(host,'開始篩選').click());
        expect(host.textContent).toContain('成交金額差 ≤1 元');
        expect(host.textContent).toContain('策略仍使用原凍結金額');
        const pane=host.querySelector<HTMLElement>('[data-testid="stock-screener-panel"]')!;
        expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth+1);
        expect(host.querySelector('[aria-label="布林三階段結果"] [role="status"]')?.closest('details')).toBeNull();
        const detail=[...host.querySelectorAll('summary')].find(s=>s.textContent?.includes('容差證據'))!;
        await act(async()=>detail.click());expect(detail.parentElement?.textContent).toContain('100000001');
        [...host.querySelectorAll<HTMLElement>('[aria-label="布林三階段結果"] [role="status"] div')]
            .find(el=>el.textContent?.startsWith('新版來源核對允許'))!.scrollIntoView({block:'center'});
        await page.getByTestId('stock-screener-panel').screenshot({path:'bollinger-amount-source-320px-fixture.png'});
        expect(fetcher.mock.calls.filter(([,init])=>init?.method==='PUT')).toHaveLength(0);expect(onPick).not.toHaveBeenCalled();
    });
    it('備援與來源衝突警告不收合；320px 特大字級可展開完整來源，查詢零寫入與自動跳圖', async () => {
        const { host, fetcher, onPick, onAddToWatchlist } = await mount({ backup: true });
        await act(async () => button(host, '開始篩選').click());
        const pane = host.querySelector<HTMLElement>('[data-testid="stock-screener-panel"]')!;
        const status = host.querySelector<HTMLElement>('[aria-label="布林三階段結果"] [role="status"]')!;
        expect(status.textContent).toContain('Shioaji 日行情備援'); expect(status.textContent).toContain('160 日歷史使用備援');
        expect(status.textContent).toContain('官方來源契約尚待驗證'); expect(status.textContent).toContain('已知來源核對衝突 1 筆');
        expect(status.textContent).toContain('成交量來源差異 ≤1%，容差檢查通過 1 筆');
        expect(status.textContent).toContain('策略仍使用原凍結成交量，未校正原值');
        const tolerance = [...host.querySelectorAll('summary')].find(s => s.textContent?.startsWith('成交量容差證據'))!;
        await act(async () => tolerance.click());
        expect(tolerance.parentElement?.textContent).toContain('1000001');
        expect(tolerance.parentElement?.textContent).toContain(BOLLINGER_SOURCE_COMPARISON_POLICY.version);
        expect(status.closest('details')).toBeNull();
        const evidence = [...host.querySelectorAll('summary')].find(s => s.textContent === '逐市場／日期來源、切換原因與版本證據（唯讀）')!;
        expect(evidence.parentElement?.hasAttribute('open')).toBe(false); evidence.focus();
        await act(async () => userEvent.keyboard('{Enter}'));
        expect(evidence.parentElement?.hasAttribute('open')).toBe(true);
        expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
        await act(async () => userEvent.keyboard('{Enter}'));
        status.scrollIntoView();
        console.log('BOLLINGER_BACKUP_UI', JSON.stringify({ height: pane.clientHeight, width: pane.clientWidth, scrollWidth: pane.scrollWidth,
            warningInDetails: !!status.closest('details'), requests: fetcher.mock.calls.length }));
        console.log('BOLLINGER_BACKUP_SCREENSHOT', await page.getByTestId('stock-screener-panel').screenshot({ path: 'bollinger-backup-source-320px-fixture.png' }));
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
        expect(onPick).not.toHaveBeenCalled(); expect(onAddToWatchlist).not.toHaveBeenCalled();
    });
    it('預設关闭，啟用前不展開；鍵盤啟用後才展開，主要與進階分離', async () => {
        const { host, fetcher } = await mount({ enabled: false });
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-controls="screener-condition-group-technical"]')!.click());
        const toggle = host.querySelector<HTMLButtonElement>('[aria-controls="screener-condition-bollSqueezeStages"]')!;
        await act(async () => toggle.click()); expect(toggle.getAttribute('aria-expanded')).toBe('false');
        const enable = host.querySelector<HTMLInputElement>('[aria-label="啟用布林壓縮與突破"]')!; enable.focus();
        await act(async () => userEvent.keyboard(' ')); expect(enable.checked).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('true'); expect(host.querySelector('[aria-label="帶寬基準回看"]')).not.toBeNull();
        const advanced = [...host.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent === '布林進階參數與公式')!;
        expect(advanced.open).toBe(false);
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
        expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/results'))).toHaveLength(0);
    });
    it('手動查詢不儲存daily profile／自動開圖；分類查詢固定同一期，手動加入雙清單', async () => {
        const { host, fetcher, onPick, onAddToWatchlist, profile } = await mount();
        await act(async () => button(host, '開始篩選').click());
        expect(host.textContent).toContain('策略母體 2'); expect(onPick).not.toHaveBeenCalled(); expect(profile()).toBeNull();
        await act(async () => button(host, '正在壓縮').click());
        const request = new URL(String(fetcher.mock.calls.at(-1)![0]), location.href);
        expect(request.searchParams.get('snapshotId')).toBe(report.snapshotId); expect(request.searchParams.get('stage')).toBe('compressing');
        expect(request.searchParams.get('cursor')).toBeNull(); expect(host.textContent).not.toContain('6488 上櫃測試股');
        await act(async () => host.querySelector<HTMLButtonElement>('article button')!.click());
        expect(onPick).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: '2449', kind: 'ordinary' }), 'chart');
        await act(async () => button(host, '加入清單').click()); expect(onAddToWatchlist).toHaveBeenCalledOnce();
        expect(button(host, '已加入').disabled).toBe(true);
        expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('/api/stock-screener/'))).toBe(true);
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    });
    it('明確套用才儲存revision；修改／全部取消不變daily profile，非法草稿仍可停用原策略', async () => {
        const { host, fetcher, profile } = await mount();
        await act(async () => button(host, '套用至每日自動篩選').click()); expect(profile()?.revision).toBe(1);
        expect(profile()?.enabled).toBe(true);
        await act(async () => button(host, '全部取消').click()); expect(profile()?.enabled).toBe(true);
        expect(button(host, '開始篩選').disabled).toBe(true);
        await act(async () => button(host, '停用每日布林策略').click()); expect(profile()?.revision).toBe(2); expect(profile()?.enabled).toBe(false);
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2);
        expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/results'))).toHaveLength(0);
        expect(host.textContent).toContain('沒有立即下載');
    });
    it('320px／600px高／32px根字級，內部捲動、警告和鍵盤焦點不被進階內容隱藏', async () => {
        const { host } = await mount({ state: 'stale' });
        await act(async () => button(host, '開始篩選').click());
        const pane = host.querySelector<HTMLElement>('[data-testid="stock-screener-panel"]')!;
        expect(pane.clientHeight).toBeLessThanOrEqual(600); expect(pane.scrollHeight).toBeGreaterThan(pane.clientHeight);
        expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
        const warning = host.querySelector<HTMLElement>('[aria-label="布林三階段結果"] [role="status"]')!;
        expect(warning.closest('details')).toBeNull(); expect(warning.textContent).toContain('舊日期報告');
        expect([...host.querySelectorAll<HTMLButtonElement>('article button')].every(b => b.disabled)).toBe(true);
        const advanced = [...host.querySelectorAll('summary')].find(s => s.textContent === '布林進階參數與公式')!;
        advanced.focus(); await act(async () => userEvent.keyboard('{Enter}')); expect(advanced.parentElement?.hasAttribute('open')).toBe(true);
        expect(document.activeElement).toBe(advanced); expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
        await act(async () => userEvent.keyboard('{Enter}')); expect(advanced.parentElement?.hasAttribute('open')).toBe(false);
        host.querySelector<HTMLElement>('[aria-label="帶寬基準回看"]')!.scrollIntoView();
        console.log('BOLLINGER_UI_DOM', JSON.stringify({ hostWidth: host.clientWidth, height: pane.clientHeight,
            scrollHeight: pane.scrollHeight, width: pane.clientWidth, scrollWidth: pane.scrollWidth,
            font: getComputedStyle(document.documentElement).fontSize, warningInDetails: !!warning.closest('details') }));
        console.log('BOLLINGER_UI_EDITOR', await page.getByTestId('stock-screener-panel').screenshot({ path: 'bollinger-editor-320px-600px-32px-fixture.png' }));
        warning.scrollIntoView();
        console.log('BOLLINGER_UI_EVIDENCE', await page.getByTestId('stock-screener-panel').screenshot({ path: 'bollinger-320px-600px-32px-fixture.png' }));
    });
    it('pending 顯示來源契約限制，不顯示可操作結果，GET不寫背景設定', async () => {
        const { host, fetcher, onPick, onAddToWatchlist } = await mount({ state: 'pending' });
        await act(async () => button(host, '開始篩選').click());
        expect(host.textContent).toContain('兩市場來源契約尚未通過'); expect(host.querySelector('article')).toBeNull();
        expect(onPick).not.toHaveBeenCalled(); expect(onAddToWatchlist).not.toHaveBeenCalled();
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    });
    it('全域限流明示保留已備資料與台北重試時間，不冒稱完全未下載', async () => {
        const {host,fetcher} = await mount({state:'pending',preparationReason:'broker_rate_limited'});
        await act(async () => button(host,'開始篩選').click());
        expect(host.textContent).toContain('共用請求速率已達上限');
        expect(host.textContent).toContain('已取得資料保留'); expect(host.textContent).toContain('已備 2 日');
        expect(host.textContent).toContain('23:41:00'); expect(host.textContent).not.toContain('未下載');
        expect(fetcher.mock.calls.filter(([,init]) => init?.method === 'PUT')).toHaveLength(0);
    });
    it('來源嘗試耗盡明示停止自動重試，不誤導為正常冷卻或可操作結果', async () => {
        const {host,fetcher,onPick,onAddToWatchlist} = await mount({state:'pending',preparationReason:'source_attempts_exhausted'});
        await act(async () => button(host,'開始篩選').click());
        const status = host.querySelector<HTMLElement>('[aria-label="布林三階段結果"] [role="status"]')!;
        expect(status.textContent).toContain('來源已達重試上限，停止自動重試');
        expect(status.textContent).toContain('已取得資料保留');
        expect(status.textContent).toContain('須排除缺口來源原因');
        expect(status.textContent).toContain('已備 159 日');
        expect(status.textContent).not.toContain('最早重試時間');
        expect(status.textContent).not.toContain('冷卻後');
        expect(status.closest('details')).toBeNull(); expect(host.querySelector('article')).toBeNull();
        expect(fetcher.mock.calls.filter(([,init])=>init?.method==='PUT')).toHaveLength(0);
        expect(onPick).not.toHaveBeenCalled(); expect(onAddToWatchlist).not.toHaveBeenCalled();
    });
    it.each([
        ['calendar_closure_pending','臨時休市公告尚未驗證'],
        ['calendar_closure_review_required','官方休市公告的日期或適用範圍需確認'],
        ['calendar_publication_review_required','官方交易日窗口已更正'],
    ])('官方公告Gate %s 明示原因且不展開可操作結果、不寫設定或跳圖',async(reason,message)=>{
        const {host,fetcher,onPick,onAddToWatchlist}=await mount({state:'pending',preparationReason:reason});
        await act(async()=>button(host,'開始篩選').click());
        const status=host.querySelector<HTMLElement>('[aria-label="布林三階段結果"] [role="status"]')!;
        expect(status.textContent).toContain(message);expect(status.closest('details')).toBeNull();
        expect(host.querySelector('article')).toBeNull();
        expect(fetcher.mock.calls.filter(([,init])=>init?.method==='PUT')).toHaveLength(0);
        expect(onPick).not.toHaveBeenCalled();expect(onAddToWatchlist).not.toHaveBeenCalled();
    });
    it('240px窄格／600px高／特大字級，主要輸入仍在面板內且可鍵盤操作', async () => {
        const { host } = await mount({ width: 240 });
        const pane = host.querySelector<HTMLElement>('[data-testid="stock-screener-panel"]')!;
        const input = host.querySelector<HTMLInputElement>('[aria-label="带寬百分位"], [aria-label="帶寬百分位"]')!;
        expect(input).not.toBeNull(); input.focus(); await act(async () => userEvent.keyboard('{ArrowUp}'));
        expect(document.activeElement).toBe(input); expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
        const bounds = pane.getBoundingClientRect(), box = input.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(bounds.left); expect(box.right).toBeLessThanOrEqual(bounds.right);
        expect(pane.clientHeight).toBeLessThanOrEqual(600);
    });
});
