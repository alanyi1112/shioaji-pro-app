import { BLOCK_META, type Workspace } from './workspace';
import type { ContractInfo } from './types/contract';
import type { ScreenerChartSelectionState } from './screener-chart-selection';

export interface HmrIdentity {
    code: string; security_type: ContractInfo['security_type'];
    region: string; exchange: ContractInfo['exchange']; target_code: string | null;
}
export interface HmrPeriod { index: number; dailyGeneration?: number }
export interface HmrChartViewport {
    identity: string; anchorTime: number; from: number; to: number;
    autoScale: boolean; priceRange?: { from: number; to: number }; paneHeights: number[];
}
export interface HmrView {
    workspace: Workspace; selected: HmrIdentity | null;
    charts: Record<string, { identity: HmrIdentity; generation: number }>;
    dailyCharts: string[]; periods: Record<string, HmrPeriod>;
    activeListId?: string; viewports?: Record<string, HmrChartViewport>;
}
interface Envelope { version: 1; scope: string; savedAt: number; view: HmrView }
export const HMR_TTL_MS = 60_000;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(s) && !['__proto__', 'prototype', 'constructor'].includes(s);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
export const hmrIdentity = (c: ContractInfo): HmrIdentity => ({
    code: c.code, security_type: c.security_type, region: c.region ?? 'TW',
    exchange: c.exchange, target_code: c.target_code ?? null,
});
const identityKey = (a: HmrIdentity) => JSON.stringify([a.region,a.security_type,a.exchange,a.code,a.target_code]);
export const sameHmrIdentity = (a: HmrIdentity, c: ContractInfo) =>
    identityKey(a) === identityKey(hmrIdentity(c));
const cleanIdentity = (i: HmrIdentity): HmrIdentity => ({
    code:i.code, region:i.region, exchange:i.exchange,
    security_type:i.security_type, target_code:i.target_code,
});
/** Explicit allowlist: imported profiles cannot smuggle quotes/accounts into handoff. */
function cleanView(v: HmrView): HmrView {
    const layoutKeys = new Set(['i','x','y','w','h','minW','minH','maxW','maxH','static','isDraggable','isResizable','moved','resizeHandles','isBounded']);
    return {
        workspace: {
            blocks: v.workspace.blocks.map(b => ({
                id:b.id, type:b.type, pin:b.pin,
                ...(['distribution','flow'].includes(b.pulseVisualization ?? '') ? {pulseVisualization:b.pulseVisualization} : {}),
                ...(b.pulseIndex === 'IX0001' || b.pulseIndex === 'IX0043' ? {pulseIndex:b.pulseIndex} : {}),
                ...(Array.isArray(b.pulseSections) ? {pulseSections:b.pulseSections.filter(s => ['stocks','industries','flow'].includes(s))} : {}),
                ...(isRecord(b.pulseWeights) ? {pulseWeights:Object.fromEntries(Object.entries(b.pulseWeights).filter(([k,n]) => ['stocks','industries','flow'].includes(k) && typeof n === 'number' && Number.isFinite(n)))} : {}),
            })),
            layout: v.workspace.layout.map(l => Object.fromEntries(Object.entries(l).filter(([key,value]) => layoutKeys.has(key)
                && (key === 'i' ? typeof value === 'string'
                    : key === 'resizeHandles' ? Array.isArray(value) && value.every(v => ['s','w','e','n','sw','nw','se','ne'].includes(v))
                    : ['static','isDraggable','isResizable','moved','isBounded'].includes(key) ? typeof value === 'boolean'
                    : typeof value === 'number' && Number.isFinite(value)))) as unknown as Workspace['layout'][number]),
        },
        ...(v.activeListId ? {activeListId:v.activeListId} : {}),
        ...(v.viewports ? {viewports:Object.fromEntries(Object.entries(v.viewports).map(([key,p]) => [key,{identity:p.identity,anchorTime:p.anchorTime,from:p.from,to:p.to,autoScale:p.autoScale,
            ...(p.priceRange ? {priceRange:{from:p.priceRange.from,to:p.priceRange.to}} : {}),paneHeights:[...p.paneHeights]}]))} : {}),
        selected:v.selected ? cleanIdentity(v.selected) : null,
        charts:Object.fromEntries(Object.entries(v.charts).map(([key,c]) => [key,{identity:cleanIdentity(c.identity),generation:c.generation}])),
        dailyCharts:[...v.dailyCharts],
        periods:Object.fromEntries(Object.entries(v.periods).map(([key,p]) => [key,{index:p.index,...(p.dailyGeneration === undefined ? {} : {dailyGeneration:p.dailyGeneration})}])),
    };
}
function validIdentity(v: unknown): v is HmrIdentity {
    return isRecord(v) && id(v.code) && ['STK','FUT','OPT','WRT','IND'].includes(String(v.security_type))
        && ['TW','US','HK','JP'].includes(String(v.region))
        && [null,'TSE','OTC','OES','TAIFEX'].some(exchange => exchange === v.exchange)
        && (v.target_code === null || id(v.target_code));
}
export function validViewport(v: unknown): v is HmrChartViewport {
    return isRecord(v) && typeof v.identity === 'string' && v.identity.length <= 300 &&
        typeof v.anchorTime === 'number' && Number.isFinite(v.anchorTime) && v.anchorTime > 0 &&
        typeof v.from === 'number' && Number.isFinite(v.from) && Math.abs(v.from) <= 1_000_000 &&
        typeof v.to === 'number' && Number.isFinite(v.to) && Math.abs(v.to) <= 1_000_000 && v.from < v.to &&
        typeof v.autoScale === 'boolean' && Array.isArray(v.paneHeights) && v.paneHeights.length <= 64 &&
        v.paneHeights.every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100_000) &&
        (v.priceRange === undefined || (isRecord(v.priceRange) && typeof v.priceRange.from === 'number' &&
            typeof v.priceRange.to === 'number' && Number.isFinite(v.priceRange.from) &&
            Number.isFinite(v.priceRange.to) && v.priceRange.from < v.priceRange.to));
}
function validView(v: unknown): v is HmrView {
    if (!isRecord(v) || !isRecord(v.workspace) || !Array.isArray(v.workspace.blocks)
        || !Array.isArray(v.workspace.layout) || v.workspace.blocks.length > 64
        || v.workspace.layout.length > 64 || !isRecord(v.charts) || !isRecord(v.periods)
        || !Array.isArray(v.dailyCharts) || (v.selected !== null && !validIdentity(v.selected))) return false;
    if (v.activeListId !== undefined && !id(v.activeListId)) return false;
    const ids = new Set<string>();
    for (const b of v.workspace.blocks) {
        if (!isRecord(b) || !id(b.id) || ids.has(b.id) || !Object.hasOwn(BLOCK_META, String(b.type))
            || (b.pin !== null && !id(b.pin))) return false;
        ids.add(b.id);
    }
    if (!v.workspace.layout.every(l => isRecord(l) && ids.has(String(l.i))
        && ['x','y','w','h'].every(k => typeof l[k] === 'number' && Number.isFinite(l[k])))) return false;
    const charts = v.workspace.blocks.filter(b => b.type === 'chart');
    for (const [key,c] of Object.entries(v.charts)) {
        if (!id(key) || !charts.some(b => b.id === key && b.pin === null) || !isRecord(c)
            || !validIdentity(c.identity) || !integer(c.generation)) return false;
    }
    if (v.viewports !== undefined && (!isRecord(v.viewports) || !Object.entries(v.viewports).every(([key,p]) => charts.some(b => b.id === key) && validViewport(p)))) return false;
    if (!v.dailyCharts.every(key => id(key) && charts.some(b => b.id === key))) return false;
    return Object.entries(v.periods).every(([key,p]) => id(key) && charts.some(b => b.id === key)
        && isRecord(p) && integer(p.index) && p.index <= 4
        && (p.dailyGeneration === undefined || integer(p.dailyGeneration)));
}
export function createHmrViewStore(options: {
    scope: string; storage?: Pick<Storage,'getItem'|'setItem'|'removeItem'>;
    now?: () => number; reload?: boolean; previous?: HmrView | null;
}) {
    const now = options.now ?? Date.now, key = 'shioaji:hmr-view:1:' + options.scope;
    let view: HmrView | null = options.previous && validView(options.previous) ? cleanView(options.previous) : null;
    try {
        const raw = options.storage?.getItem(key);
        options.storage?.removeItem(key); // consume even invalid/stale envelopes
        if (!view && options.reload && raw && raw.length <= 262144) {
            const e: unknown = JSON.parse(raw);
            if (isRecord(e) && e.version === 1 && e.scope === options.scope && integer(e.savedAt)
                && now() >= e.savedAt && now() - e.savedAt <= HMR_TTL_MS && validView(e.view))
                view = cleanView(e.view);
        }
    } catch { /* storage unavailable: keep normal operation */ }
    return {
        read: () => view ? structuredClone(view) : null,
        commit(next: HmrView) {
            if (!validView(next)) { view = null; return false; }
            view = cleanView(next); return true;
        },
        period(key: string) { return view?.periods[key] ? { ...view.periods[key] } : undefined; },
        setPeriod(key: string, period: HmrPeriod) {
            if (!view || !view.workspace.blocks.some(b => b.id === key && b.type === 'chart')) return;
            const next = structuredClone(view); next.periods[key] = { ...period };
            if (validView(next)) view = next;
        },
        viewport(key: string) { return view?.viewports?.[key] ? structuredClone(view.viewports[key]) : undefined; },
        setViewport(key: string, viewport: HmrChartViewport) {
            if (!view || !view.workspace.blocks.some(b => b.id === key && b.type === 'chart') || !validViewport(viewport)) return;
            view.viewports = { ...view.viewports, [key]: structuredClone(viewport) };
        },
        beforeFullReload() {
            if (!view || !options.storage) return false;
            try {
                const bytes = JSON.stringify({ version: 1, scope: options.scope, savedAt: now(), view } satisfies Envelope);
                options.storage.setItem(key, bytes);
                return options.storage.getItem(key) === bytes;
            } catch { return false; }
        },
    };
}
export type HmrViewStore = ReturnType<typeof createHmrViewStore>;
export interface HmrHotPort {
    data: Record<string, unknown>;
    on: (event: 'vite:beforeFullReload', handler: () => void) => void;
    off: (event: 'vite:beforeFullReload', handler: () => void) => void;
    dispose: (handler: (data: Record<string, unknown>) => void) => void;
}
/** Narrow Vite adapter: hot.data stays in-page; only full reload arms storage. */
export function attachHmrViewStore(hot: HmrHotPort, options: Parameters<typeof createHmrViewStore>[0]) {
    const store = createHmrViewStore({ ...options, previous: hot.data.view as HmrView | undefined });
    const checkpoint = () => store.beforeFullReload();
    hot.on('vite:beforeFullReload', checkpoint);
    hot.dispose(data => { data.view = store.read(); hot.off('vite:beforeFullReload', checkpoint); });
    return store;
}

export function captureHmrView(workspace: Workspace, selected: ContractInfo | null,
    charts: Record<string, ScreenerChartSelectionState>, dailyCharts: Set<string>,
    periods: HmrView['periods'], continuity: Pick<HmrView,'activeListId'|'viewports'> = {}): HmrView {
    const targets = workspace.blocks.filter(b => b.type === 'chart');
    return {
        ...(continuity.activeListId ? {activeListId:continuity.activeListId} : {}),
        ...(continuity.viewports ? {viewports:Object.fromEntries(Object.entries(continuity.viewports).filter(([key]) => targets.some(b => b.id === key)))} : {}),
        workspace: structuredClone(workspace), selected: selected ? hmrIdentity(selected) : null,
        charts: Object.fromEntries(Object.entries(charts).filter(([key]) => targets.some(b => b.id === key && !b.pin))
            .map(([key,c]) => [key, { identity: hmrIdentity(c.contract), generation: c.generation }])),
        dailyCharts: [...dailyCharts].filter(key => targets.some(b => b.id === key)),
        periods: Object.fromEntries(Object.entries(periods).filter(([key]) => targets.some(b => b.id === key))),
    };
}
/** Resolve the complete original set before any activation/commit. No retry or quote I/O. */
export async function resolveHmrView(view: HmrView, resolve: (i: HmrIdentity) => Promise<ContractInfo>,
    owns: () => boolean) {
    const originals = [view.selected, ...Object.values(view.charts).map(c => c.identity)].filter((i): i is HmrIdentity => i !== null);
    const contracts = new Map<string, ContractInfo>();
    for (const identity of originals) {
        if (!owns()) return null;
        const key = identityKey(identity);
        if (contracts.has(key)) continue;
        const contract = await resolve(identity);
        if (!owns()) return null;
        if (!sameHmrIdentity(identity, contract)) throw new Error('HMR 原商品身分不一致；未改選或新增訂閱');
        contracts.set(key, contract);
    }
    if (!owns()) return null;
    return {
        selected: view.selected ? contracts.get(identityKey(view.selected))! : null,
        charts: Object.fromEntries(Object.entries(view.charts).map(([key,c]) => [key, {
            contract: contracts.get(identityKey(c.identity))!, generation: c.generation,
            snapshotError: 'HMR 後尚無可驗證 Snapshot；不回放舊行情',
        }] satisfies [string, ScreenerChartSelectionState])),
        contracts: [...contracts.values()],
    };
}
