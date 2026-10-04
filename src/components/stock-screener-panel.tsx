import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CRITERIA, effectiveCriteria, validateCriteria, type Criteria, type HolderMode, type ReasonCode, type UniverseStock } from '../lib/stock-screener-domain';
import { decodeScreenerResponse, screenerSearchV3, screenerSearchV4, screenerSearchV5, screenerSearchV6, screenerSearchV7, type ScreenerQuery, type ScreenerQueryV3,
    type ScreenerQueryV4, type ScreenerQueryV5, type ScreenerQueryV6, type ScreenerResponseV3, type ScreenerResponseV4, type ScreenerResponseV5,
    type ScreenerQueryV7, type ScreenerResponseV6, type ScreenerResponseV7, type ScreenerResultRowV4, type ScreenerResultRowV5,
    type ScreenerResultRowV6, type ScreenerResultRowV7 } from '../lib/stock-screener-api';
import {
    DEFAULT_CRITERIA_V3, isV3Preference,
    type TechnicalUnknownReason,
} from '../lib/stock-screener-technical-patterns';
import {
    criteriaFingerprintV4, DEFAULT_CRITERIA_V4, effectiveCriteriaV4, isV4Preference, validateCriteriaV4,
    type CriteriaV4, type DivergenceDirection, type DivergenceSource, type MaMode, type V4UnknownReason,
} from '../lib/stock-screener-v4';
import {
    LONG_TERM_LAYOUT_PRESET, criteriaFingerprintV5, effectiveCriteriaV5, isV5Preference, migrateCriteriaV4ToV5,
    type ChipConditionKey, type V5Reason,
} from '../lib/stock-screener-v5';
import {
    criteriaFingerprintV6, effectiveCriteriaV6, isV6Preference, migrateCriteriaV5ToV6, validateCriteriaV6,
    type CriteriaV6, type V6Reason,
} from '../lib/stock-screener-v6';
import {
    criteriaFingerprintV7, effectiveCriteriaV7, isV7Preference, migrateCriteriaV6ToV7, validateCriteriaV7,
    type CriteriaV7, type V7Reason,
} from '../lib/stock-screener-v7';
import type { ScreenerListSyncResult } from '../lib/stock-screener-list-sync';
import { stockScreenerVolumeComparison } from '../lib/stock-screener-volume-comparison';
import {
    disableAllStockScreenerConditions, enabledStockScreenerConditions,
    firstEnabledStockScreenerCondition, stockScreenerConditionSummary,
    type StockScreenerConditionId,
} from '../lib/stock-screener-condition-ui';
import { StockScreenerConditionAccordion } from './stock-screener-condition-accordion';
import * as styles from './stock-screener-panel.css';
import { DEFAULT_BOLLINGER_SQUEEZE, validateCriteriaV8, type BollingerSqueezeCriteria } from '../lib/stock-screener-v8';
import { BOLLINGER_PREFS, loadBollingerPreference, bollingerSearch, decodeBollingerResponse,
    type BollingerQueryDraft, type BollingerResponse, type BollingerDailyProfileView } from '../lib/stock-screener-bollinger-api';
import { StockScreenerBollingerResults } from './stock-screener-bollinger-results';

const PREFS = 'sj-pro-stock-screener-v7';
const V6_PREFS = 'sj-pro-stock-screener-v6';
const V5_PREFS = 'sj-pro-stock-screener-v5';
const V4_PREFS = 'sj-pro-stock-screener-v4';
const V3_PREFS = 'sj-pro-stock-screener-v3';
const V2_PREFS = 'sj-pro-stock-screener-v2';
const V1_PREFS = 'sj-pro-stock-screener-v1';
const INITIAL_QUERY: ScreenerQueryV7 = { criteria: migrateCriteriaV6ToV7(migrateCriteriaV5ToV6(migrateCriteriaV4ToV5(DEFAULT_CRITERIA_V4))), sort: 'code', direction: 'asc', resultState: 'pass' };
const reasonLabels: Record<ReasonCode, string> = {
    none: '', period_pending: '比較期尚未備齊', missing_current: '缺本期', missing_previous: '缺前期',
    date_mismatch: '期別不符', incompatible_source: '來源口徑不一致', invalid_volume: '成交量無效',
    zero_previous_volume: '前日成交量為零', incomplete_tdcc: '17 級資料不齊', invalid_tdcc: '持股合計驗證未通過',
    missing_turnover: '缺當日成交值', invalid_turnover: '成交值來源或單位無效', history_pending: '所需 TDCC 歷史尚在補足',
};
const states = { ready: '資料已備齊', partial: '部分商品無法判定', pending: '等待完整比較資料', stale: '資料已過期，以下為保留快照', unavailable: '本機資料服務無法使用' };
const statusReasons: Record<string, string> = {
    schema_pending: '選股資料庫尚未初始化；不會以自選清單代替全市場。',
    bootstrap_pending: '尚未發布全市場選股快照。',
    period_pending: '啟用條件所需的相鄰兩日或兩週資料尚未備齊。',
    source_not_published: '等待官方新一期資料；以下保留原快照的真實比較日期。',
    awaiting_twse: '上櫃資料已完成，仍在等待上市（TWSE）官方日報。',
    awaiting_tpex: '上市資料已完成，仍在等待上櫃（TPEx）官方日報。',
    invalid_source: '官方日報的日期、欄位或全市場涵蓋率驗證未通過，未發布新一期結果。',
    source_blocked: '官方來源目前阻擋自動讀取，已封鎖舊結果操作。',
    rate_limited: '官方來源要求降低請求頻率，將依冷卻時間稍後重試。',
    publication_probe_exhausted: '今日官方日報探測次數已達上限，保留最後合法快照且不再自動請求。',
    snapshot_version_pending: '等待 v2 全市場快照；不會以 v1 結果套用新條件。',
    v3_preparation_pending: '技術型態所需 60 個交易日全市場 OHLC 尚在背景補足；不會以 v2 資料套用 v3 公式。',
    v2_snapshot_pending: '最新共同交易日的日量／持股快照尚未發布。',
    mixed_session_dates: '日量與技術型態日期不一致，已封鎖舊結果操作並等待同一期資料。',
    universe_coverage_pending: '技術 OHLC 尚未涵蓋目前全市場母體，已保留最後合法快照。',
    v4_preparation_pending: '均線與背離所需 130 個交易日全市場 OHLCV 尚在背景補足；不會以 v3 資料套用 v4 公式。',
    ohlcv_v4_bootstrap_pending: '全市場 130 日 OHLCV 尚未完成，已封鎖 v4 發布。',
    v3_snapshot_pending: 'v4 必須建立在同一期合法 v3 快照上，目前仍在等待。',
    v5_preparation_pending: '全市場籌碼歷史與 TDCC 完整週期尚在準備；舊快照不會冒充本期結果。',
    chip_history_pending: '投信與融資融券的 21 個相鄰交易日尚未備齊。',
    tdcc_universe_coverage_pending: 'TDCC 最新週期尚未涵蓋完整選股母體。',
    v6_preparation_pending: '外資／投信反轉所需的 21 個交易日新 mapping 尚在驗證；v5 結果仍保留可用。',
    institutional_v2_history_pending: 'TWSE／TPEx 外資與投信欄位的新 mapping 歷史尚未完整驗證。',
    v7_preparation_pending: 'BOLL／RSI／KD／MACD 的 v7 全市場快照尚未發布；不會以舊版資料套用新公式。',
};
const publicationReasonLabels: Record<string, string> = {
    source_not_published: '官方尚未發布', invalid_report_date: '報表日期不符', invalid_report_schema: '報表欄位不符',
    invalid_universe_coverage: '全市場涵蓋不足', rate_limited: '官方要求冷卻', source_blocked: '來源阻擋',
};
const technicalReasonLabels: Record<TechnicalUnknownReason, string> = {
    missing_ohlcv: '缺少相鄰交易日 OHLC', invalid_ohlcv: 'OHLC 驗證未通過', insufficient_history: '上市日數或有效歷史不足',
    non_adjacent_sessions: '官方交易日期序不相鄰', containment_direction_unknown: '包含關係方向無法唯一判定',
};
const v4ReasonLabels: Record<V4UnknownReason, string> = {
    ...technicalReasonLabels, none: '', missing_volume: '缺少官方成交股數', invalid_volume: '官方成交股數驗證未通過',
    indicator_warmup: '指標暖機期不足', pivot_unconfirmed: '最新 price pivot 尚未取得右側 2 根確認 K 棒',
};
const holderModeLabels: Record<HolderMode, string> = {
    'weekly-increase': '單週增加', 'decrease-to-increase': '持股比例由減轉增', 'increase-to-decrease': '持股比例由增轉減',
};
const maModeLabels: Record<MaMode, string> = {
    'bullish-preparation': '多頭準備突破', 'golden-cross': '黃金交叉', 'bearish-preparation': '空頭準備跌破',
    'death-cross': '死亡交叉', 'any-bullish': '任一多頭訊號', 'any-bearish': '任一空頭訊號',
};
const divergenceSourceLabels: Record<DivergenceSource, string> = {
    obv: 'OBV', rsi5: 'RSI5', rsi10: 'RSI10', 'kd-k': 'KD-K', 'macd-line': 'MACD line', 'macd-histogram': 'MACD 能量柱',
};
const divergenceDirectionLabels: Record<DivergenceDirection, string> = { bullish: '底背離', bearish: '頂背離', any: '任一方向' };
const v5ReasonLabels: Record<V5Reason, string> = {
    none: '', history_gap: 'TDCC 相鄰週資料不足', incomplete_tdcc: 'TDCC 級距不完整', missing_source_row: '官方來源缺列',
    insufficient_history: '有效歷史不足', issued_shares_invalid: '已發行普通股數無效', non_adjacent_sessions: '交易日期不相鄰',
    indicator_warmup: '均線暖機不足', invalid_ratio: '比率無效', invalid_balance: '融資或融券餘額無效', mixed_session_dates: '資料日期不一致',
};
const v6ReasonLabels: Record<V6Reason, string> = {
    none: '', non_adjacent_sessions: '交易日期不相鄰', missing_source_row: '官方來源缺列', insufficient_history: '有效歷史不足',
    issued_shares_invalid: '已發行普通股數無效', invalid_ratio: '比率無效', invalid_volume: '成交量無效', invalid_close: '收盤價無效',
    mapping_unverified: '法人欄位 mapping 尚未驗證', mixed_session_dates: '資料日期不一致',
};
const v7ReasonLabels: Record<V7Reason, string> = {
    none: '', missing_ohlcv: '缺少官方 OHLCV', invalid_ohlcv: '官方 OHLCV 驗證未通過',
    non_adjacent_sessions: '官方交易日期序不相鄰', indicator_warmup: '指標暖機期不足',
    zero_bollinger_width: '布林通道寬度為零', missing_volume: '量能基準日不足',
    invalid_volume: '官方成交股數無效', zero_volume_baseline: '量能基準平均為零',
};
const chipConditionLabels: Record<ChipConditionKey, string> = {
    largeHolderTrend: '千張大戶比例趨勢', largeHolderConcentration: '千張大戶集中', retailHolderDecline: '10 張以下散戶下降',
    trustOwnership: '投信買超占股本', priceMargin: '價漲融資不增', shortMarginRatio: '券資比', closeHigh: '收盤新高', closeSmaBreakout: '收盤突破 SMA',
};
const chipConditionKeys = Object.keys(chipConditionLabels) as ChipConditionKey[];
const resultStateLabels: Record<ScreenerQueryV7['resultState'], string> = { pass: '符合條件', unknown: '無法判定', fail: '不符合' };
const sortLabels: Record<ScreenerQueryV7['sort'], string> = {
    code: '股票代碼', volumeMultiple: '成交量倍數', turnover: '成交值', holderChange: '最新持股變化', holderStreak: '反轉前週數',
    confirmationDate: '型態確認日', algorithm: '分型算法', direction: '型態方向', outsideDistance: '通道外距離', maSpread: '最新均線 spread',
    pivotDate: '背離確認日', priceDifference: '背離價差', largeHolderRatio: '千張大戶比例', trustOwnershipPct: '投信買超占股本',
    shortMarginRatio: '券資比', closeHighDays: '新高期間', smaPeriod: '突破均線週期',
    foreignTodayNetBuy: '外資今日淨買超', trustTodayNetBuy: '投信今日淨買超', trustRecoveryPct: '投信回補強度',
    trustParticipationPct: '投信成交參與率',
    bollDistance: '收盤與布林中軌距離', rsiFast: 'RSI5', kdFast: 'KD-K', macdDif: 'MACD DIF', volumeRatio: '條件內量能倍數',
};
const validV2Sort = (value: unknown): value is ScreenerQuery['sort'] => ['code', 'volumeMultiple', 'turnover', 'holderChange', 'holderStreak'].includes(String(value));
function migrateV1Criteria(value: unknown): Criteria | null {
    if (!value || typeof value !== 'object') return null;
    const old = value as { mode?: unknown; volume?: { enabled?: unknown; threshold?: unknown }; holder?: { enabled?: unknown; threshold?: unknown } };
    const criteria: Criteria = { mode: old.mode as Criteria['mode'],
        volume: { ...DEFAULT_CRITERIA.volume, enabled: old.volume?.enabled as boolean, threshold: old.volume?.threshold as string },
        holder: { ...DEFAULT_CRITERIA.holder, enabled: old.holder?.enabled as boolean, threshold: old.holder?.threshold as string } };
    return validateCriteria(criteria) ? criteria : null;
}
function toV3(query: ScreenerQuery): ScreenerQueryV3 {
    return { ...query, criteria: { ...query.criteria,
        volume: { ...query.criteria.volume, turnover: { ...query.criteria.volume.turnover } },
        holder: { ...query.criteria.holder, turnover: { ...query.criteria.holder.turnover } },
        fractal: { ...DEFAULT_CRITERIA_V3.fractal }, bollReversal: { ...DEFAULT_CRITERIA_V3.bollReversal } } };
}
function toV4(query: ScreenerQueryV3): ScreenerQueryV4 {
    return { ...query, criteria: { ...query.criteria,
        volume: { ...query.criteria.volume, turnover: { ...query.criteria.volume.turnover } },
        holder: { ...query.criteria.holder, turnover: { ...query.criteria.holder.turnover } },
        fractal: { ...query.criteria.fractal }, bollReversal: { ...query.criteria.bollReversal },
        ma: { ...DEFAULT_CRITERIA_V4.ma }, divergence: { ...DEFAULT_CRITERIA_V4.divergence } } };
}
function toV5(query: ScreenerQueryV4): ScreenerQueryV5 {
    return { ...query, criteria: migrateCriteriaV4ToV5(query.criteria) };
}
function savePreferences(query: ScreenerQueryV7) {
    localStorage.setItem(PREFS, JSON.stringify({ version: 7, query: { ...query, cursor: undefined } }));
    const criteria: CriteriaV4 = {
        mode: query.criteria.mode, volume: query.criteria.volume, holder: query.criteria.holder,
        fractal: query.criteria.fractal, bollReversal: query.criteria.bollReversal,
        ma: query.criteria.ma, divergence: query.criteria.divergence,
    };
    const allowed = ['code', 'volumeMultiple', 'turnover', 'holderChange', 'holderStreak', 'confirmationDate', 'algorithm',
        'direction', 'outsideDistance', 'maSpread', 'pivotDate', 'priceDifference'];
    localStorage.setItem(V4_PREFS, JSON.stringify({ version: 4, query: { criteria,
        sort: allowed.includes(query.sort) ? query.sort : 'code', direction: query.direction, resultState: query.resultState } }));
}
function loadLegacyPreferences(): ScreenerQueryV7 {
    try {
        const saved = JSON.parse(localStorage.getItem(PREFS) ?? 'null');
        if (isV7Preference(saved)) {
            return { criteria: effectiveCriteriaV7(saved.query.criteria), sort: saved.query.sort, direction: saved.query.direction, resultState: saved.query.resultState };
        }
        const v6 = JSON.parse(localStorage.getItem(V6_PREFS) ?? 'null');
        if (isV6Preference(v6)) {
            const query: ScreenerQueryV7 = { criteria: migrateCriteriaV6ToV7(effectiveCriteriaV6(v6.query.criteria)),
                sort: v6.query.sort, direction: v6.query.direction, resultState: v6.query.resultState };
            try { savePreferences(query); } catch { /* Migration remains usable in memory. */ }
            return query;
        }
        const v5 = JSON.parse(localStorage.getItem(V5_PREFS) ?? 'null');
        if (isV5Preference(v5)) {
            const query: ScreenerQueryV7 = { criteria: migrateCriteriaV6ToV7(migrateCriteriaV5ToV6(effectiveCriteriaV5(v5.query.criteria))),
                sort: v5.query.sort as ScreenerQueryV7['sort'], direction: v5.query.direction, resultState: v5.query.resultState };
            try { savePreferences(query); } catch { /* Migration remains usable in memory. */ }
            return query;
        }
        const v4 = JSON.parse(localStorage.getItem(V4_PREFS) ?? 'null');
        if (isV4Preference(v4)) {
            const query = { ...toV5({ criteria: effectiveCriteriaV4(v4.query.criteria), sort: v4.query.sort, direction: v4.query.direction, resultState: v4.query.resultState }),
                criteria: migrateCriteriaV6ToV7(migrateCriteriaV5ToV6(toV5({ criteria: effectiveCriteriaV4(v4.query.criteria), sort: v4.query.sort, direction: v4.query.direction, resultState: v4.query.resultState }).criteria)) } as ScreenerQueryV7;
            try { savePreferences(query); } catch { /* Migration remains usable in memory. */ }
            return query;
        }
        const v3 = JSON.parse(localStorage.getItem(V3_PREFS) ?? 'null');
        if (isV3Preference(v3)) {
            const legacy = toV5(toV4({ criteria: effectiveCriteria(v3.query.criteria) as typeof v3.query.criteria,
                sort: v3.query.sort, direction: v3.query.direction, resultState: v3.query.resultState }));
            const query = { ...legacy, criteria: migrateCriteriaV6ToV7(migrateCriteriaV5ToV6(legacy.criteria)) } as ScreenerQueryV7;
            try { savePreferences(query); } catch { /* Migration remains usable in memory. */ }
            return query;
        }
        const v2 = JSON.parse(localStorage.getItem(V2_PREFS) ?? 'null');
        if (v2?.version === 2 && validateCriteria(v2.query?.criteria) && validV2Sort(v2.query?.sort)
            && ['asc', 'desc'].includes(v2.query.direction) && ['pass', 'unknown', 'fail'].includes(v2.query.resultState)) {
            const legacy = toV5(toV4(toV3({ criteria: v2.query.criteria, sort: v2.query.sort, direction: v2.query.direction, resultState: v2.query.resultState })));
            const query = { ...legacy, criteria: migrateCriteriaV6ToV7(migrateCriteriaV5ToV6(legacy.criteria)) } as ScreenerQueryV7;
            try { savePreferences(query); } catch { /* Migration remains usable in memory. */ }
            return query;
        }
        const v1 = JSON.parse(localStorage.getItem(V1_PREFS) ?? 'null');
        const migrated = v1?.version === 1 ? migrateV1Criteria(v1.query?.criteria) : null;
        if (migrated && validV2Sort(v1.query?.sort) && ['asc', 'desc'].includes(v1.query.direction)
            && ['pass', 'unknown', 'fail'].includes(v1.query.resultState)) {
            const legacy = toV5(toV4(toV3({ criteria: migrated, sort: v1.query.sort, direction: v1.query.direction, resultState: v1.query.resultState })));
            const query = { ...legacy, criteria: migrateCriteriaV6ToV7(migrateCriteriaV5ToV6(legacy.criteria)) } as ScreenerQueryV7;
            try { savePreferences(query); } catch { /* Migration remains usable in memory. */ }
            return query;
        }
    } catch { /* Device-local preferences never prevent opening the panel. */ }
    return INITIAL_QUERY;
}
function loadPreferences(): ScreenerQueryV7 {
    const legacy = loadLegacyPreferences();
    try {
        const v8 = loadBollingerPreference(localStorage);
        if (v8) { const { bollSqueezeStages: _, ...criteria } = v8.criteria;
            return { ...legacy, criteria, direction: v8.direction,
                resultState: v8.resultState === 'unknown' ? 'unknown' : v8.resultState === 'notMatched' ? 'fail' : 'pass' }; }
    } catch { /* Device-local storage may be unavailable. */ }
    return legacy;
}
const fingerprint = (query: ScreenerQueryV7) => validateCriteriaV7(query.criteria)
    ? `${criteriaFingerprintV7(query.criteria)}|${query.sort}|${query.direction}|${query.resultState}` : 'invalid';
const shares = (value: string | null) => value === null ? '—' : `${value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} 股`;
const missingCount = (value: { missingByCondition: object }, key: string) =>
    Number((value.missingByCondition as Record<string, number>)[key] ?? 0);

export interface StockScreenerPanelProps {
    targets: { id: string; label: string }[];
    onPick: (stock: UniverseStock, targetId: string) => Promise<boolean>;
    onOpenChart: () => Promise<string | undefined> | string | undefined;
    onTargetChange: () => void;
    onAddToWatchlist: (stock: UniverseStock) => Promise<ScreenerListSyncResult>;
    chartConnectionMessage?: string;
    snapshotVolumesByCode?: Record<string, { date: string | null; lots: number }>;
}

type AddState = { status: 'pending' | ScreenerListSyncResult['status']; message: string };

export function StockScreenerPanel({ targets, onPick, onOpenChart, onTargetChange, onAddToWatchlist, chartConnectionMessage, snapshotVolumesByCode }: StockScreenerPanelProps) {
    const initialDraft = useRef<ScreenerQueryV7 | null>(null);
    if (initialDraft.current === null) initialDraft.current = loadPreferences();
    const [draft, setDraft] = useState(initialDraft.current);
    const [bollinger, setBollinger] = useState<BollingerSqueezeCriteria>(() => loadBollingerPreference(localStorage)?.criteria.bollSqueezeStages ?? structuredClone(DEFAULT_BOLLINGER_SQUEEZE));
    const [bollingerSort, setBollingerSort] = useState<BollingerQueryDraft['sort']>(() => loadBollingerPreference(localStorage)?.sort ?? 'code');
    const [bollingerResponse, setBollingerResponse] = useState<BollingerResponse | null>(null);
    const [bollingerApplied, setBollingerApplied] = useState<BollingerQueryDraft | null>(null);
    const [dailyProfile, setDailyProfile] = useState<BollingerDailyProfileView | null>(null);
    const [profileReady, setProfileReady] = useState(false);
    const [profileBusy, setProfileBusy] = useState(false);
    const [profileMessage, setProfileMessage] = useState('');
    const [activeCondition, setActiveCondition] = useState<StockScreenerConditionId>(() => firstEnabledStockScreenerCondition({ ...initialDraft.current!.criteria, bollSqueezeStages: bollinger }));
    const [draftActionMessage, setDraftActionMessage] = useState('');
    const [applied, setApplied] = useState<ScreenerQueryV7 | null>(null);
    const [response, setResponse] = useState<ScreenerResponseV3 | ScreenerResponseV4 | ScreenerResponseV5 | ScreenerResponseV6 | ScreenerResponseV7 | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [storageError, setStorageError] = useState(false);
    const [targetId, setTargetId] = useState('');
    const [selectionMessage, setSelectionMessage] = useState('');
    const [addStates, setAddStates] = useState<Record<string, AddState>>({});
    const [cursors, setCursors] = useState<string[]>(['']);
    const [page, setPage] = useState(0);
    const generation = useRef(0);
    const pickingGeneration = useRef(0);
    const pendingAdds = useRef(new Set<string>());
    const controller = useRef<AbortController | null>(null);
    const effectiveTarget = targets.some((target) => target.id === targetId) ? targetId : targets.length === 1 ? targets[0]!.id : '';
    const uiCriteria = { ...draft.criteria, bollSqueezeStages: bollinger };
    const valid = validateCriteriaV8(uiCriteria);
    const dirty = applied !== null && fingerprint(draft) !== fingerprint(applied);
    const enabledConditions = enabledStockScreenerConditions(uiCriteria);
    useEffect(() => {
        const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
        fetch('/api/stock-screener/daily-profile?version=8', { signal: abort.signal, credentials: 'same-origin' })
            .then(async r => { if (!r.ok) throw new Error(); const value = await r.json();
                if (value.version !== 8 || value.profile !== null && (!Number.isSafeInteger(value.profile?.revision) || !validateCriteriaV8(value.profile.criteria))) throw new Error();
                if (!abort.signal.aborted) { setDailyProfile(value.profile); setProfileReady(true); } })
            .catch(() => { if (!abort.signal.aborted) setProfileMessage('每日設定接口尚未就緒；不影響舊版選股。'); })
            .finally(() => clearTimeout(timer));
        return () => { abort.abort(); clearTimeout(timer); };
    }, []);

    useEffect(() => () => { generation.current++; pickingGeneration.current++; controller.current?.abort(); }, []);
    useEffect(() => {
        // No saved results are trusted after reload; this is a read-only status check.
        const abort = new AbortController();
        const ticket = ++generation.current;
        const timer = setTimeout(() => abort.abort(), 10000);
        fetch('/api/stock-screener/status?version=7', { signal: abort.signal, credentials: 'same-origin' })
            .then(async (res) => { if (!res.ok) throw new Error(); return decodeScreenerResponse(await res.json()); })
            .then((result) => { if (generation.current === ticket) setResponse(result); })
            .catch(() => { if (generation.current === ticket) setError(abort.signal.aborted ? '本機選股資料服務查詢逾時' : '無法連線本機選股資料服務'); })
            .finally(() => clearTimeout(timer));
        return () => { abort.abort(); clearTimeout(timer); };
    }, []);

    const bollingerQuery = (): BollingerQueryDraft => ({ criteria: uiCriteria, sort: bollingerSort, direction: draft.direction,
        resultState: draft.resultState === 'pass' ? 'matched' : draft.resultState === 'fail' ? 'notMatched' : 'unknown' });
    async function runBollinger(query: BollingerQueryDraft, cursor?: string, pinnedSnapshot?: string) {
        if (!validateCriteriaV8(query.criteria) || !query.criteria.bollSqueezeStages.enabled) return;
        const ticket = ++generation.current; controller.current?.abort();
        const abort = new AbortController(); controller.current = abort; const timer = setTimeout(() => abort.abort(), 12000);
        setBusy(true); setError('');
        try {
            const r = await fetch(`/api/stock-screener/results?${bollingerSearch(query, cursor, pinnedSnapshot ?? (cursor ? bollingerResponse?.snapshotId ?? undefined : undefined))}`,
                { signal: abort.signal, credentials: 'same-origin' });
            const raw = await r.json(); if (!r.ok) throw new Error(r.status === 409 ? '快照或分頁設定已更新，請重新篩選' : '布林價量查詢尚未就緒');
            const result = decodeBollingerResponse(raw); if (generation.current !== ticket) return;
            setBollingerResponse(result); setBollingerApplied(query); setResponse(null); setApplied(null);
            try { localStorage.setItem(BOLLINGER_PREFS, JSON.stringify({ version: 8, query })); setStorageError(false); } catch { setStorageError(true); }
        } catch (e) { if (generation.current === ticket) setError(e instanceof Error ? e.message : '布林查詢失敗'); }
        finally { clearTimeout(timer); if (generation.current === ticket) setBusy(false); }
    }
    async function saveDailyProfile(enabled = true) {
        const profileCriteria = enabled ? uiCriteria : dailyProfile?.criteria;
        if (!profileReady || profileBusy || !profileCriteria || !validateCriteriaV8(profileCriteria) || enabled && !bollinger.enabled) return;
        setProfileBusy(true); setProfileMessage('');
        const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
        try {
            const r = await fetch('/api/stock-screener/daily-profile?version=8', { method: 'PUT', signal: abort.signal, credentials: 'same-origin',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: dailyProfile?.revision ?? 0, enabled, criteria: profileCriteria }) });
            const value = await r.json(); if (!r.ok) throw new Error(r.status === 409 ? '每日設定已被其他視窗更新，請重新載入後確認' : '每日設定儲存失敗');
            if (value.version !== 8 || !Number.isSafeInteger(value.profile?.revision) || !validateCriteriaV8(value.profile.criteria)) throw new Error('每日設定回應無效');
            setDailyProfile(value.profile); setProfileMessage(`已儲存每日策略 revision ${value.profile.revision}；${enabled ? '背景依官方資料與有界預算準備' : '已停用'}。沒有立即下載。`);
        } catch (e) { setProfileMessage(e instanceof Error ? e.message : '每日設定儲存失敗'); }
        finally { clearTimeout(timer); setProfileBusy(false); }
    }

    async function run(query: ScreenerQueryV7, cursor = '', nextPage = 0) {
        if (!validateCriteriaV7(query.criteria)) return;
        const requestedQuery = query;
        query = { ...query, criteria: effectiveCriteriaV7(query.criteria) };
        const needsV7 = (['bollPosition', 'rsiCross', 'kdCross', 'macdSignal'] as const).some((key) => query.criteria[key].enabled);
        const needsV6 = query.criteria.foreignReversal.enabled || query.criteria.trustReversal.enabled;
        const needsV5 = (['largeHolderTrend', 'largeHolderConcentration', 'retailHolderDecline', 'trustOwnership',
            'priceMargin', 'shortMarginRatio', 'closeHigh', 'closeSmaBreakout'] as ChipConditionKey[]).some((key) => query.criteria[key].enabled);
        const needsV4 = query.criteria.ma.enabled || query.criteria.divergence.enabled;
        if (!needsV7 && ['bollDistance', 'rsiFast', 'kdFast', 'macdDif', 'volumeRatio'].includes(query.sort)) query = { ...query, sort: 'code' };
        if (!needsV6 && ['foreignTodayNetBuy', 'trustTodayNetBuy', 'trustRecoveryPct', 'trustParticipationPct'].includes(query.sort)) query = { ...query, sort: 'code' };
        if (!needsV5 && ['largeHolderRatio', 'trustOwnershipPct', 'shortMarginRatio', 'closeHighDays', 'smaPeriod'].includes(query.sort)) query = { ...query, sort: 'code' };
        if (!needsV5 && !needsV4 && ['maSpread', 'pivotDate', 'priceDifference'].includes(query.sort)) query = { ...query, sort: 'code' };
        if (query.sort !== requestedQuery.sort) setDraft(current => current === requestedQuery ? { ...current, sort: query.sort } : current);
        const ticket = ++generation.current;
        controller.current?.abort();
        const abort = new AbortController(); controller.current = abort;
        const timer = setTimeout(() => abort.abort(), 12000);
        setBusy(true); setError('');
        try {
            const search = needsV7 ? screenerSearchV7({ ...query, cursor: cursor || undefined })
                : needsV6 ? screenerSearchV6({ ...query, cursor: cursor || undefined } as ScreenerQueryV6)
                : needsV5 ? screenerSearchV5({ ...query, cursor: cursor || undefined } as ScreenerQueryV5)
                : needsV4 ? screenerSearchV4({ ...query, sort: query.sort as ScreenerQueryV4['sort'], cursor: cursor || undefined })
                : screenerSearchV3({ ...query, criteria: query.criteria, sort: query.sort as ScreenerQueryV3['sort'], cursor: cursor || undefined });
            const res = await fetch(`/api/stock-screener/results?${search}`, { signal: abort.signal, credentials: 'same-origin' });
            const raw = await res.json();
            if (!res.ok) throw new Error(['snapshot_expired','snapshot_version_expired'].includes(raw.reason) ? '快照已更新，請重新開始篩選' : /^[a-z_]{1,64}$/.test(raw.reason ?? '') ? `選股查詢失敗（${raw.reason}）` : '本機資料服務無法使用，請稍後重試');
            const result = decodeScreenerResponse(raw);
            if (needsV7 && result.version !== 7) throw new Error('v7 全市場技術訊號資料尚未備齊');
            if (!needsV7 && needsV6 && result.version !== 6) throw new Error('v6 全市場法人反轉資料尚未備齊');
            if (!needsV7 && !needsV6 && needsV5 && result.version !== 5) throw new Error('v5 全市場籌碼資料尚未備齊');
            if (!needsV7 && !needsV6 && !needsV5 && needsV4 && result.version !== 4) throw new Error('v4 選股資料尚未備齊');
            if (ticket !== generation.current) return;
            setResponse(result); setApplied(query); setPage(nextPage); setBollingerResponse(null); setBollingerApplied(null);
            if (!cursor) setCursors(['']);
            else setCursors((old) => [...old.slice(0, nextPage), cursor]);
            try { savePreferences(query);
                localStorage.setItem(BOLLINGER_PREFS, JSON.stringify({ version: 8, query: { criteria: { ...query.criteria, bollSqueezeStages: bollinger }, sort: bollingerSort,
                    direction: query.direction, resultState: query.resultState === 'pass' ? 'matched' : query.resultState === 'fail' ? 'notMatched' : 'unknown' } })); setStorageError(false); }
            catch { setStorageError(true); }
        } catch (e) {
            if (ticket === generation.current) setError(abort.signal.aborted ? '查詢逾時，請稍後重試' : (e instanceof Error ? e.message : '查詢失敗'));
        } finally { clearTimeout(timer); if (ticket === generation.current) setBusy(false); }
    }
    async function pick(stock: UniverseStock) {
        const ticket = ++pickingGeneration.current;
        setSelectionMessage('正在解析圖表商品…');
        try { const success = await onPick(stock, effectiveTarget); if (ticket === pickingGeneration.current) setSelectionMessage(success ? `已在指定 K 線圖開啟 ${stock.code} ${stock.name}` : '圖表選擇已取消'); }
        catch (e) { if (ticket === pickingGeneration.current) setSelectionMessage(e instanceof Error ? e.message : '開啟圖表失敗'); }
    }
    async function addToWatchlist(stock: UniverseStock) {
        if (pendingAdds.current.has(stock.symbol)) return;
        pendingAdds.current.add(stock.symbol);
        setAddStates((old) => ({ ...old, [stock.symbol]: { status: 'pending', message: '加入中…' } }));
        try {
            const result = await onAddToWatchlist(stock);
            setAddStates((old) => ({ ...old, [stock.symbol]: {
                status: result.status,
                message: result.message,
            } }));
        } catch (cause) {
            setAddStates((old) => ({ ...old, [stock.symbol]: {
                status: 'failed',
                message: cause instanceof Error ? cause.message : '加入 Shioaji 與 MultiView 清單失敗，可重試',
            } }));
        } finally {
            pendingAdds.current.delete(stock.symbol);
        }
    }
    const rows = applied ? response?.rows ?? [] : [];
    const counts = applied && ['ready', 'partial'].includes(response?.state ?? '') ? response?.counts : null;
    const responseOperational = response?.state === 'ready' || response?.state === 'partial';
    return <div className={styles.root} data-testid='stock-screener-panel'>
        <p className={styles.note}>收盤後選股 · 全部上市／上櫃普通股（不限定自選清單）</p>
        <details className={styles.note}><summary>範圍與排除商品</summary>排除 ETF、ETN、權證、特別股、TDR、興櫃及海外股票；停牌但未下市櫃的普通股仍列入母體，缺比較資料時標示無法判定。</details>
        <form onSubmit={(event) => { event.preventDefault(); if (bollinger.enabled) void runBollinger(bollingerQuery()); else void run(draft); }}>
            <div className={styles.draftToolbar}><div className={styles.controls}><button type='button' onClick={() => {
                const criteria: CriteriaV7 = { ...migrateCriteriaV6ToV7(migrateCriteriaV5ToV6(LONG_TERM_LAYOUT_PRESET)),
                    largeHolderTrend: { ...LONG_TERM_LAYOUT_PRESET.largeHolderTrend },
                    retailHolderDecline: { ...LONG_TERM_LAYOUT_PRESET.retailHolderDecline },
                    priceMargin: { ...LONG_TERM_LAYOUT_PRESET.priceMargin } };
                setDraft({ ...draft, criteria }); setBollinger(current => ({ ...current, enabled: false })); setActiveCondition(firstEnabledStockScreenerCondition(criteria)); setDraftActionMessage('已套用「長線佈局」草稿；按「開始篩選」後才查詢。');
            }}>套用「長線佈局」草稿</button>
                <button type='button' disabled={!enabledConditions.length} onClick={() => {
                    const cancelled = enabledConditions.length;
                    setDraft((current) => ({ ...current, criteria: disableAllStockScreenerConditions(current.criteria) }));
                    setBollinger(current => ({ ...current, enabled: false }));
                    setActiveCondition('volume');
                    setDraftActionMessage(`已取消 ${cancelled} 個草稿條件；目前結果尚未變更。`);
                }}>全部取消</button>
                <strong aria-label='已選條件數'>已選 {enabledConditions.length} 項</strong></div>
                {!!enabledConditions.length && <div className={styles.selectedConditions} aria-label='已選條件摘要'>{enabledConditions.map((condition) =>
                    <span key={condition.id}>{condition.label} · {stockScreenerConditionSummary(uiCriteria, condition.id)}</span>)}</div>}
            </div>
            {draftActionMessage && <p role='status' className={styles.note}>{draftActionMessage}</p>}
            <StockScreenerConditionAccordion criteria={uiCriteria} activeCondition={activeCondition}
                onActiveConditionChange={setActiveCondition} onChange={(value) => { const { bollSqueezeStages, ...criteria } = value;
                    if (bollSqueezeStages) setBollinger(bollSqueezeStages); setDraft((current) => ({ ...current, criteria })); setDraftActionMessage(''); }} />
            <details className={styles.settingsDetails}>
                <summary>結果設定 · {draft.criteria.mode === 'all' ? 'AND' : 'OR'} · {resultStateLabels[draft.resultState]} · {bollinger.enabled ? '布林排序' : sortLabels[draft.sort]} · {draft.direction === 'asc' ? '由小到大' : '由大到小'}</summary>
            <div className={styles.controls}>
                <select aria-label='條件組合' value={draft.criteria.mode} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, mode: e.target.value as 'all' | 'any' } })}><option value='all'>全部符合（AND）</option><option value='any'>任一符合（OR）</option></select>
                <select aria-label='結果種類' value={draft.resultState} onChange={(e) => setDraft({ ...draft, resultState: e.target.value as ScreenerQueryV4['resultState'] })}><option value='pass'>符合條件</option><option value='unknown'>無法判定</option><option value='fail'>不符合</option></select>
                <select hidden={bollinger.enabled} aria-label='選股排序' value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value as ScreenerQueryV7['sort'] })}><option value='code'>股票代碼</option><option value='volumeMultiple'>成交量倍數</option><option value='turnover'>成交值</option><option value='holderChange'>最新持股變化</option><option value='holderStreak'>反轉前週數</option><option value='confirmationDate'>型態確認日</option><option value='algorithm'>分型算法</option><option value='direction'>型態方向</option><option value='outsideDistance'>通道外距離</option><option value='maSpread'>最新均線 spread</option><option value='pivotDate'>背離確認日</option><option value='priceDifference'>背離價差</option><option value='largeHolderRatio'>千張大戶比例</option><option value='trustOwnershipPct'>投信買超占股本</option><option value='shortMarginRatio'>券資比</option><option value='closeHighDays'>新高期間</option><option value='smaPeriod'>突破均線週期</option><option value='foreignTodayNetBuy'>外資今日淨買超</option><option value='trustTodayNetBuy'>投信今日淨買超</option><option value='trustRecoveryPct'>投信回補強度</option><option value='trustParticipationPct'>投信成交參與率</option><option value='bollDistance'>布林中軌距離</option><option value='rsiFast'>RSI5</option><option value='kdFast'>KD-K</option><option value='macdDif'>MACD DIF</option><option value='volumeRatio'>條件內量能倍數</option></select>
                <select aria-label='排序方向' value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as 'asc' | 'desc' })}><option value='asc'>由小到大</option><option value='desc'>由大到小</option></select>
            </div>
            </details>
            <div className={styles.submitRow}><button type='submit' disabled={!valid || busy}>{busy ? '篩選中…' : '開始篩選'}</button></div>
            {bollinger.enabled && <div className={styles.controls}>
                <label>布林結果排序 <select aria-label='布林結果排序' value={bollingerSort} onChange={e => setBollingerSort(e.target.value as BollingerQueryDraft['sort'])}>
                    <option value='code'>股票代碼</option><option value='bbw'>帶寬 BBW</option><option value='percentilePosition'>前期百分位位置</option><option value='b'>上軌位置 b</option><option value='breakoutVolumeRatio'>突破量倍數</option><option value='momentum'>動能</option></select></label>
                <button type='button' disabled={!valid || !profileReady || profileBusy} onClick={() => void saveDailyProfile()}>套用至每日自動篩選</button>
            </div>}
            {dailyProfile && <p className={styles.note}>每日策略 revision {dailyProfile.revision} · {dailyProfile.enabled ? '已啟用' : '已停用'}（獨立於本頁草稿）
                {dailyProfile.enabled && <button type='button' disabled={profileBusy} onClick={() => void saveDailyProfile(false)}>停用每日布林策略</button>}</p>}
            {profileMessage && <p role='status' className={styles.note}>{profileMessage}</p>}
            {bollingerApplied && (JSON.stringify(bollingerApplied.criteria) !== JSON.stringify(uiCriteria) || bollingerApplied.sort !== bollingerSort || bollingerApplied.direction !== draft.direction) && <p role='status'>布林條件尚未套用；下方保留上次查詢，每日設定未變。</p>}
            {!valid && <p role='alert'>至少啟用一項條件且參數必須合法；籌碼比例最多兩位小數，連續週數 1–12，投信 5–10 日，價量／融資 1–20 日，新高 2–120 日。</p>}
            {dirty && <p role='status'>條件尚未套用；下方仍是上次篩選結果。</p>}
        </form>
        <div className={styles.status} role='status' aria-live='polite'>
            <strong>{error || (bollingerResponse ? '布林查詢已完成，日期與完整性詳見下方' : response ? states[response.state] : '尚未查詢資料')}</strong>
            {applied && <div>已套用 {enabledStockScreenerConditions(applied.criteria).length} 項 · {applied.criteria.mode === 'all' ? '全部符合（AND）' : '任一符合（OR）'}</div>}
            {response && statusReasons[response.reason] && <div>{statusReasons[response.reason]}</div>}
            {response?.expectedSessionDate && response.expectedSessionDate !== (response.effectiveSessionDate ?? response.anchors.daily?.current)
                && <div className={styles.criticalStatus}>資料日期尚未同步：有效 {response.effectiveSessionDate ?? response.anchors.daily?.current ?? '未提供'} · 預期 {response.expectedSessionDate}</div>}
            {response?.sessionReadiness && response.sessionReadiness.phase !== 'complete' && (['TWSE', 'TPEx'] as const).map((market) => {
                const publication = response.sessionReadiness!.markets[market];
                const label = publication.status === 'complete' ? '已完成' : publication.status === 'pending' ? '等待發布'
                    : publication.status === 'rate-limited' ? '冷卻中' : publication.status === 'blocked' ? '來源阻擋' : '驗證失敗';
                return <div key={market}>{market}：{label}{publication.reason ? `（${publicationReasonLabels[publication.reason] ?? '來源驗證未通過'}）` : ''}；最後合法日期 {publication.reportDate ?? response.effectiveSessionDate ?? '無'}</div>;
            })}
            {(applied || response) && <details className={styles.evidenceDetails}>
            <summary>資料範圍與完整性{response?.effectiveSessionDate || response?.anchors.daily?.current ? ` · 有效 ${response.effectiveSessionDate ?? response.anchors.daily?.current}` : ''}{response?.expectedSessionDate && response.expectedSessionDate !== (response.effectiveSessionDate ?? response.anchors.daily?.current) ? ` · 預期 ${response.expectedSessionDate}` : ''}</summary>
            {applied && <div>已套用：{[
                applied.criteria.volume.enabled ? `成交量 ≥ ${applied.criteria.volume.threshold} 倍${applied.criteria.volume.turnover.enabled ? `且成交值 ≥ ${applied.criteria.volume.turnover.minimumWan} 萬` : ''}` : '',
                applied.criteria.holder.enabled ? `${holderModeLabels[applied.criteria.holder.mode]}${applied.criteria.holder.mode === 'weekly-increase' ? '' : `（前 ${applied.criteria.holder.streakWeeks} 週）`} ≥ ${applied.criteria.holder.threshold} 百分點${applied.criteria.holder.turnover.enabled ? `且成交值 ≥ ${applied.criteria.holder.turnover.minimumWan} 萬` : ''}` : '',
                applied.criteria.fractal.enabled ? `K 棒分型（${applied.criteria.fractal.algorithm === 'raw-three' ? '原始三 K' : applied.criteria.fractal.algorithm === 'chan-containment' ? '纏論包含處理' : '任一算法'}／${applied.criteria.fractal.direction === 'bottom' ? '底' : applied.criteria.fractal.direction === 'top' ? '頂' : '任一方向'}）` : '',
                applied.criteria.bollReversal.enabled ? `布林反轉 K（${applied.criteria.bollReversal.mode === 'lower-bullish' ? '下軌陽 K＋下影' : applied.criteria.bollReversal.mode === 'upper-bearish' ? '上軌陰 K＋上影' : '任一型態'}）` : '',
                applied.criteria.ma.enabled ? `${maModeLabels[applied.criteria.ma.mode]}（${applied.criteria.ma.compressionDays} 日／spread ≤ ${applied.criteria.ma.maxSpreadPct}%）` : '',
                applied.criteria.divergence.enabled ? `${divergenceSourceLabels[applied.criteria.divergence.source]} ${divergenceDirectionLabels[applied.criteria.divergence.direction]}${applied.criteria.divergence.source === 'macd-histogram' && applied.criteria.divergence.requireZeroReset ? '＋零軸重置' : ''}` : '',
                applied.criteria.bollPosition.enabled ? `布林位置（${stockScreenerConditionSummary(applied.criteria, 'bollPosition')}）` : '',
                applied.criteria.rsiCross.enabled ? `RSI（${stockScreenerConditionSummary(applied.criteria, 'rsiCross')}）` : '',
                applied.criteria.kdCross.enabled ? `KD（${stockScreenerConditionSummary(applied.criteria, 'kdCross')}）` : '',
                applied.criteria.macdSignal.enabled ? `MACD（${stockScreenerConditionSummary(applied.criteria, 'macdSignal')}）` : '',
                applied.criteria.largeHolderTrend.enabled ? `千張大戶 ${applied.criteria.largeHolderTrend.minimumRatioPct}–${applied.criteria.largeHolderTrend.maximumRatioPct}% 且連升 ${applied.criteria.largeHolderTrend.weeks} 週` : '',
                applied.criteria.largeHolderConcentration.enabled ? `千張大戶人數減、持股增 ${applied.criteria.largeHolderConcentration.weeks} 週` : '',
                applied.criteria.retailHolderDecline.enabled ? `10 張以下散戶比例下降 ${applied.criteria.retailHolderDecline.weeks} 週` : '',
                applied.criteria.trustOwnership.enabled ? `投信 ${applied.criteria.trustOwnership.days} 日買超占股本 ≥ ${applied.criteria.trustOwnership.minimumPct}%` : '',
                applied.criteria.priceMargin.enabled ? `近 ${applied.criteria.priceMargin.days} 日價漲且融資不增` : '',
                applied.criteria.shortMarginRatio.enabled ? `券資比 ≥ ${applied.criteria.shortMarginRatio.minimumPct}%` : '',
                applied.criteria.closeHigh.enabled ? `收盤創 ${applied.criteria.closeHigh.days} 日新高` : '',
                applied.criteria.closeSmaBreakout.enabled ? `收盤突破 SMA${applied.criteria.closeSmaBreakout.period}` : '',
            ].filter(Boolean).join(applied.criteria.mode === 'all' ? ' 且 ' : ' 或 ')}</div>}
            {response?.preparation && <div>{response.preparation.version === 4 ? 'OHLCV 130 日準備' : 'OHLC 60 日準備'}：{response.preparation.processed}/{response.preparation.target} · 剩餘 {response.preparation.remaining} · 失敗 {response.preparation.failed} · 逾期 {response.preparation.overdue}</div>}
            {response?.anchors.daily && <div>成交量比較：{response.anchors.daily.previous} → {response.anchors.daily.current}</div>}
            {(response?.effectiveSessionDate || response?.anchors.daily?.current) && <div>有效資料日：{response.effectiveSessionDate ?? response.anchors.daily?.current}</div>}
            {response?.expectedSessionDate && response.expectedSessionDate !== (response.effectiveSessionDate ?? response.anchors.daily?.current)
                && <div>預期資料日：{response.expectedSessionDate}</div>}
            {response?.anchors.weekly && <div>持股：{response.anchors.weekly.previous} → {response.anchors.weekly.current}</div>}
            {!!response?.anchors.weeklyPeriods?.length && <div>TDCC 歷史窗：{response.anchors.weeklyPeriods.join('、')}</div>}
            {response?.technicalAnchors && <div>技術型態：{response.technicalAnchors.sessions[0]} → {response.technicalAnchors.through}（{response.technicalAnchors.sessions.length} 個交易日）</div>}
            {response && 'chipCoverage' in response && response.chipCoverage && <div>籌碼覆蓋：TDCC {response.chipCoverage.tdcc.covered}/{response.chipCoverage.tdcc.target} · 股本 {response.chipCoverage.issuedShares.valid}/{response.chipCoverage.issuedShares.target} · 上市投信／信用 {response.chipCoverage.daily.TWSE.institutional}/{response.chipCoverage.daily.TWSE.margin} · 上櫃投信／信用 {response.chipCoverage.daily.TPEx.institutional}/{response.chipCoverage.daily.TPEx.margin}</div>}
            {response?.version === 7 && response.technicalCoverage && <div>v7 技術覆蓋：上市 {response.technicalCoverage.TWSE.covered}/{response.technicalCoverage.TWSE.target}（缺交易日 {response.technicalCoverage.TWSE.continuityUnknown}、暖機不足 {response.technicalCoverage.TWSE.indicatorWarmupUnknown}）· 上櫃 {response.technicalCoverage.TPEx.covered}/{response.technicalCoverage.TPEx.target}（缺交易日 {response.technicalCoverage.TPEx.continuityUnknown}、暖機不足 {response.technicalCoverage.TPEx.indicatorWarmupUnknown}）</div>}
            {response && !response.anchors.daily && <div>日量比較期：未提供</div>}
            {response && !response.anchors.weekly && <div>持股比較期：未提供</div>}
            {response?.createdAt && <div>快照建置：{new Date(response.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</div>}
            {counts && <>
                <div>母體 {counts.total} · 符合 {counts.matched} · 不符合 {counts.notMatched} · 無法判定 {counts.unknown}</div>
                <div>可判定 {counts.evaluated} 檔（符合＋不符合）</div>
                <div>欄位缺漏（可重疊）：日量 {counts.missingByCondition['volume-multiple']} · 持股 {counts.missingByCondition['large-holder-weekly-pp']} · 分型 {counts.missingByCondition.fractal} · 布林 {counts.missingByCondition['boll-reversal']}{'ma' in counts.missingByCondition && 'divergence' in counts.missingByCondition ? ` · 均線 ${counts.missingByCondition.ma} · 背離 ${counts.missingByCondition.divergence}` : ''}{'largeHolderTrend' in counts.missingByCondition ? ` · 千張趨勢 ${missingCount(counts, 'largeHolderTrend')} · 大戶集中 ${missingCount(counts, 'largeHolderConcentration')} · 散戶 ${missingCount(counts, 'retailHolderDecline')} · 投信 ${missingCount(counts, 'trustOwnership')} · 價融 ${missingCount(counts, 'priceMargin')} · 券資比 ${missingCount(counts, 'shortMarginRatio')} · 新高 ${missingCount(counts, 'closeHigh')} · 突破 SMA ${missingCount(counts, 'closeSmaBreakout')}` : ''}{response?.version === 7 ? ` · 布林位置 ${response.counts?.missingByCondition.bollPosition} · RSI ${response.counts?.missingByCondition.rsiCross} · KD ${response.counts?.missingByCondition.kdCross} · MACD ${response.counts?.missingByCondition.macdSignal}` : ''}</div>
                {response?.byMarket && <div>上市 {response.byMarket.TWSE.total} · 上櫃 {response.byMarket.TPEx.total}</div>}
            </>}
            </details>}
            {storageError && <div>瀏覽器無法保存偏好；本次結果不受影響。</div>}
        </div>
        <div className={styles.resultToolbar} aria-label='結果圖表工具列'>
            <label>目標 K 線圖 <select aria-label='目標 K 線圖' value={effectiveTarget} onChange={(e) => { pickingGeneration.current++; onTargetChange(); setTargetId(e.target.value); setSelectionMessage(''); }}>
                <option value=''>請選擇圖表</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
            </select></label>
            <button type='button' onClick={() => { void Promise.resolve(onOpenChart()).then((id) => { if (id) setTargetId(id); }, (cause: unknown) => setSelectionMessage(cause instanceof Error ? cause.message : '無法新增日 K 圖')); }}>新增日 K 圖</button>
        </div>
        {!targets.length && <p className={styles.note}>{chartConnectionMessage ?? '目前沒有未鎖定圖表，請新增日 K 圖，或解鎖既有圖表。'}</p>}
        {selectionMessage && <p role='status'>{selectionMessage}</p>}
        {bollingerResponse && <>
            <StockScreenerBollingerResults response={bollingerResponse} filter={bollingerApplied?.stage ?? 'all'}
                onFilter={stage => { if (bollingerApplied) void runBollinger({ ...bollingerApplied,
                    stage: stage as BollingerQueryDraft['stage'], resultState: 'all' }, undefined, bollingerResponse.snapshotId ?? undefined); }}
                onPick={stock => void pick(stock)} onAdd={stock => void addToWatchlist(stock)} targetAvailable={!!effectiveTarget} statuses={addStates} />
            {bollingerResponse.nextCursor && <button type='button' disabled={busy} onClick={() => { if (bollingerApplied) void runBollinger(bollingerApplied, bollingerResponse.nextCursor!); }}>布林下一頁</button>}
        </>}
        <div className={styles.results} aria-label='選股結果'>
            {rows.map((row) => {
                const addState = addStates[row.symbol];
                const technicalV4 = 'technicalV4' in row ? (row as ScreenerResultRowV4).technicalV4 : null;
                const chipV5 = 'chipV5' in row ? (row as ScreenerResultRowV5).chipV5 : null;
                const institutionalV6 = 'institutionalV6' in row ? (row as ScreenerResultRowV6).institutionalV6 : null;
                const technicalV7 = 'technicalV7' in row ? (row as ScreenerResultRowV7).technicalV7 : null;
                const snapshotVolume = snapshotVolumesByCode?.[row.code];
                const volumeComparison = stockScreenerVolumeComparison({
                    officialShares: row.volume.current,
                    officialDate: row.volume.currentDate,
                    snapshotLots: snapshotVolume?.lots ?? null,
                    snapshotDate: snapshotVolume?.date ?? null,
                });
                return <div className={styles.row} key={row.symbol}>
                <div className={styles.rowTop}>
                <button type='button' className={styles.rowAction} disabled={!effectiveTarget || !responseOperational} onClick={() => void pick(row)} aria-label={`在指定 K 線圖開啟 ${row.code} ${row.name}`}>
                <strong>{row.code} {row.name} · {row.market === 'TWSE' ? '上市' : '上櫃'}</strong>
                {applied?.criteria.volume.enabled && <span>日量 P {row.volume.previousDate ?? '日期未提供'} {shares(row.volume.previous)} → D {row.volume.currentDate ?? '日期未提供'} {shares(row.volume.current)} · {row.volume.multiple === null ? reasonLabels[row.volume.reason ?? 'period_pending'] : `${row.volume.multiple.toFixed(4)} 倍`}</span>}
                {volumeComparison && <span data-screener-volume-difference>同日成交量差異：官方盤後 {volumeComparison.officialLots} 張 − Shioaji Snapshot {volumeComparison.snapshotLots} 張 = {volumeComparison.differenceLots} 張</span>}
                {applied?.criteria.holder.enabled && <span>{holderModeLabels[row.holder.mode]} · {row.holder.changePp === null ? reasonLabels[row.holder.reason ?? 'history_pending'] : `${row.holder.changePp >= 0 ? '+' : ''}${row.holder.changePp.toFixed(2)} 百分點`}{row.holder.streakWeeks ? ` · 前 ${row.holder.streakWeeks} 週` : ''}</span>}
                {applied?.criteria.holder.enabled && row.holder.series.length > 0 && <span>持股歷史 {row.holder.series.map((point) => `${point.date} ${point.ratio}%`).join(' → ')}</span>}
                {applied?.criteria.fractal.enabled && row.technical.fractal && <span>分型：{row.technical.fractal.verdict === 'unknown'
                    ? technicalReasonLabels[row.technical.fractal.reason as TechnicalUnknownReason]
                    : row.technical.fractal.evidence ? `${row.technical.fractal.evidence.algorithm === 'raw-three' ? '原始三 K' : '纏論包含處理'} · ${row.technical.fractal.evidence.direction === 'bottom' ? '底分型' : '頂分型'} · 中心 ${row.technical.fractal.evidence.centerDate} · 確認 ${row.technical.fractal.evidence.confirmationDate}` : '不符合'}</span>}
                {applied?.criteria.bollReversal.enabled && row.technical.bollReversal && <span>布林反轉：{row.technical.bollReversal.verdict === 'unknown'
                    ? technicalReasonLabels[row.technical.bollReversal.reason as TechnicalUnknownReason]
                    : row.technical.bollReversal.evidence ? `${row.technical.bollReversal.evidence.mode === 'lower-bullish' ? '下軌陽 K＋下影' : '上軌陰 K＋上影'} · ${row.technical.bollReversal.evidence.current.sessionDate} · 通道外距離 ${row.technical.bollReversal.evidence.outsideDistance}` : '不符合'}</span>}
                {applied?.criteria.ma.enabled && technicalV4?.ma && <span>均線：{technicalV4.ma.verdict === 'unknown'
                    ? v4ReasonLabels[technicalV4.ma.reason]
                    : technicalV4.ma.evidence ? `${maModeLabels[technicalV4.ma.evidence.mode]} · D ${technicalV4.ma.evidence.current.sessionDate} · SMA5 ${technicalV4.ma.evidence.current.sma5.toFixed(4)} / SMA10 ${technicalV4.ma.evidence.current.sma10.toFixed(4)} / SMA20 ${technicalV4.ma.evidence.current.sma20.toFixed(4)} · spread ${technicalV4.ma.evidence.current.spreadPct.toFixed(4)}%` : '不符合'}</span>}
                {applied?.criteria.divergence.enabled && technicalV4?.divergence && <span>背離：{technicalV4.divergence.verdict === 'unknown'
                    ? v4ReasonLabels[technicalV4.divergence.reason]
                    : technicalV4.divergence.evidence ? `${divergenceSourceLabels[technicalV4.divergence.evidence.source]} ${divergenceDirectionLabels[technicalV4.divergence.evidence.direction]} · ${technicalV4.divergence.evidence.first.sessionDate} → ${technicalV4.divergence.evidence.second.sessionDate} · 間距 ${technicalV4.divergence.evidence.distanceSessions} 日 · 價差 ${technicalV4.divergence.evidence.priceDifferencePct.toFixed(2)}%` : '不符合'}</span>}
                {chipV5 && chipConditionKeys.filter((key) => applied?.criteria[key].enabled).map((key) => {
                    const outcome = chipV5.outcomes[key];
                    return <span key={key}>{chipConditionLabels[key]}：{outcome.verdict === 'pass' ? '符合' : outcome.verdict === 'fail' ? '不符合' : v5ReasonLabels[outcome.reason]}</span>;
                })}
                {institutionalV6 && (['foreignReversal', 'trustReversal'] as const).filter((key) => applied?.criteria[key].enabled).map((key) => {
                    const outcome = institutionalV6.outcomes[key];
                    const label = key === 'foreignReversal' ? '外資連賣後轉買＋爆量換手' : '投信連賣後轉買＋爆量換手';
                    return <span key={key}>{label}：{outcome.verdict === 'pass' ? '符合' : outcome.verdict === 'fail' ? '不符合' : v6ReasonLabels[outcome.reason]}
                        {' · '}D0 {outcome.evidence.today.sessionDate} {shares(outcome.evidence.today.netShares)}
                        {key === 'trustReversal' && outcome.evidence.metrics.recoveryPct !== null ? ` · 回補 ${outcome.evidence.metrics.recoveryPct.toFixed(2)}%` : ''}
                        {key === 'trustReversal' && outcome.evidence.metrics.participationPct !== null ? ` · 成交參與 ${outcome.evidence.metrics.participationPct.toFixed(2)}%` : ''}</span>;
                })}
                {technicalV7 && (['bollPosition', 'rsiCross', 'kdCross', 'macdSignal'] as const).filter((key) => applied?.criteria[key].enabled).map((key) => {
                    const outcome = technicalV7.outcomes[key];
                    const label = key === 'bollPosition' ? '布林位置' : key === 'rsiCross' ? 'RSI 交叉' : key === 'kdCross' ? 'KD 交叉' : 'MACD 訊號';
                    return <span key={key}>{label}：{outcome.verdict === 'pass' ? '符合' : outcome.verdict === 'fail' ? '不符合' : v7ReasonLabels[outcome.reason]}
                        {outcome.volumeConfirmation.enabled ? ` · 量能 ${outcome.volumeConfirmation.verdict === 'pass' ? '符合' : outcome.volumeConfirmation.verdict === 'fail' ? '不符合' : v7ReasonLabels[outcome.volumeConfirmation.reason]}` : ''}</span>;
                })}
                <span className={styles.note}>{row.sources.join('、')}</span>
                </button>
                <button type='button' className={styles.addButton}
                    aria-label={`將 ${row.code} ${row.name} 加入 Shioaji 選股與 MultiView 選股篩選清單`}
                    disabled={!responseOperational || addState?.status === 'pending' || addState?.status === 'complete'}
                    onClick={(event) => { event.stopPropagation(); void addToWatchlist(row); }}>
                    {addState?.status === 'pending' ? '加入中…' : addState?.status === 'complete' ? '已加入' : addState?.status === 'partial' || addState?.status === 'failed' ? '重試加入' : '加入清單'}
                </button>
                </div>
                {addState && <span className={addState.status === 'partial' || addState.status === 'failed' ? styles.addError : styles.addStatus} role={addState.status === 'partial' || addState.status === 'failed' ? 'alert' : 'status'} aria-live='polite'>{addState.message}</span>}
                {applied?.criteria.fractal.enabled && row.technical.fractal?.evidence?.normalizedBars && <details><summary>分型日期映射</summary>{row.technical.fractal.evidence.normalizedBars.map((bar) => <span key={`${bar.rawFrom}-${bar.rawTo}`}>{bar.low}–{bar.high}：{bar.rawDates.join('、')}</span>)}</details>}
                {applied?.criteria.bollReversal.enabled && row.technical.bollReversal?.evidence && <details><summary>P／D OHLC 與 BOLL 證據</summary>
                    {([['P', row.technical.bollReversal.evidence.previous], ['D', row.technical.bollReversal.evidence.current]] as const).map(([label, point]) => <span key={label}>{label} {point.sessionDate} O {point.open} H {point.high} L {point.low} C {point.close} · upper {point.upper} / mid {point.middle} / lower {point.lower}</span>)}
                    <span>下影 {row.technical.bollReversal.evidence.lowerShadow ? '是' : '否'} · 上影 {row.technical.bollReversal.evidence.upperShadow ? '是' : '否'}</span></details>}
                {applied?.criteria.ma.enabled && technicalV4?.ma?.evidence && <details><summary>均線糾結 P／D 證據</summary>
                    <span>糾結窗 {technicalV4.ma.evidence.compressionWindow[0]?.sessionDate} → {technicalV4.ma.evidence.compressionEnd}（{technicalV4.ma.evidence.compressionWindow.length} 日）</span>
                    {([['P', technicalV4.ma.evidence.previous], ['D', technicalV4.ma.evidence.current]] as const).map(([label, point]) => <span key={label}>{label} {point.sessionDate} · C {point.close} · SMA5 {point.sma5.toFixed(6)} / SMA10 {point.sma10.toFixed(6)} / SMA20 {point.sma20.toFixed(6)} · spread {point.spreadPct.toFixed(6)}%</span>)}</details>}
                {applied?.criteria.divergence.enabled && technicalV4?.divergence?.evidence && <details><summary>背離 pivot／指標證據</summary>
                    <span>A {technicalV4.divergence.evidence.first.sessionDate}（確認 {technicalV4.divergence.evidence.first.confirmationDate}）· 價 {technicalV4.divergence.evidence.first.price} · 指標 {technicalV4.divergence.evidence.first.indicator}</span>
                    <span>B {technicalV4.divergence.evidence.second.sessionDate}（確認 {technicalV4.divergence.evidence.second.confirmationDate}）· 價 {technicalV4.divergence.evidence.second.price} · 指標 {technicalV4.divergence.evidence.second.indicator}</span>
                    <span>零軸重置：{technicalV4.divergence.evidence.zeroResetRequired ? technicalV4.divergence.evidence.zeroResetMet ? '符合' : '不符合' : '未要求'} · evidence {technicalV4.evidenceHash.slice(0, 12)}</span></details>}
                {chipV5 && chipConditionKeys.filter((key) => applied?.criteria[key].enabled && chipV5.outcomes[key].evidence).map((key) =>
                    <details key={key}><summary>{chipConditionLabels[key]}證據</summary><pre>{JSON.stringify(chipV5.outcomes[key].evidence, null, 2)}</pre></details>)}
                {institutionalV6 && (['foreignReversal', 'trustReversal'] as const).filter((key) => applied?.criteria[key].enabled).map((key) =>
                    <details key={key}><summary>{key === 'foreignReversal' ? '外資反轉' : '投信反轉'}日期與公式證據</summary>
                        <span>D0：{institutionalV6.outcomes[key].evidence.today.sessionDate}</span>
                        <span>前期賣超：{institutionalV6.outcomes[key].evidence.priorNetRows.map((point) => `${point.sessionDate} ${shares(point.netShares)}`).join('；')}</span>
                        <span>價量基準：{institutionalV6.outcomes[key].evidence.comparisonDates.join('、')}</span>
                        <pre>{JSON.stringify(institutionalV6.outcomes[key].evidence, null, 2)}</pre>
                    </details>)}
                {technicalV7 && (['bollPosition', 'rsiCross', 'kdCross', 'macdSignal'] as const).filter((key) => applied?.criteria[key].enabled).map((key) =>
                    <details key={key}><summary>{key === 'bollPosition' ? '布林位置' : key === 'rsiCross' ? 'RSI 交叉' : key === 'kdCross' ? 'KD 交叉' : 'MACD 訊號'} P／D／量能證據</summary>
                        <pre>{JSON.stringify(technicalV7.outcomes[key], null, 2)}</pre>
                        <span>公式 {technicalV7.outcomes[key].formulaVersion} · evidence {technicalV7.evidenceHash.slice(0, 12)} · through {technicalV7.through}</span>
                    </details>)}
            </div>;})}
            {applied && !busy && !error && ['ready','partial'].includes(response?.state ?? '') && !rows.length && <p>此結果種類沒有商品。{response?.state === 'partial' ? '仍有欄位缺漏，請查看資料不足說明。' : ''}</p>}
        </div>
        {applied && <div className={styles.controls}>
            <button type='button' disabled={page === 0 || busy || dirty} onClick={() => void run(applied, cursors[page - 1], page - 1)}>上一頁</button>
            <span>第 {page + 1} 頁</span>
            <button type='button' disabled={!response?.nextCursor || busy || dirty} onClick={() => void run(applied, response?.nextCursor ?? '', page + 1)}>下一頁</button>
        </div>}
        <details className={styles.methodDetails}><summary>計算口徑與資料來源</summary>
            <p className={styles.note}>千張大戶為 TDCC 第 15 級（1,000,001 股以上），10 張以下散戶為第 1–3 級合計；投信條件使用官方 signed 買賣超與同一 universe revision 的已發行普通股數，券資比使用同日融券餘額除以融資餘額。法人反轉的回補強度是今日淨買超相對前期累計淨賣超，成交參與率是今日投信淨買超除以今日成交量，不是投信持股比例。BOLL、RSI、KD、MACD 技術條件只使用官方未還原日 OHLCV；量能基準排除當日並以股計算。點選商品內容只更換指定圖表；只有明確按下「加入清單」才會同步加入 Shioaji「選股」與 MultiView「選股篩選」，不變更下單商品或目前圖表。</p>
            <p className={styles.note}>來源：<a href='https://openapi.twse.com.tw/' target='_blank' rel='noopener noreferrer'>臺灣證券交易所</a>、<a href='https://www.tpex.org.tw/openapi/' target='_blank' rel='noopener noreferrer'>證券櫃檯買賣中心</a>、<a href='https://data.gov.tw/en/datasets/11452' target='_blank' rel='noopener noreferrer'>臺灣集中保管結算所</a>。僅供資料篩選。</p>
        </details>
    </div>;
}
