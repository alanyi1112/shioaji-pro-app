import type { BollingerResponse } from '../lib/stock-screener-bollinger-api';
import type { UniverseStock } from '../lib/stock-screener-domain';
import { bollingerSortMetric } from '../lib/stock-screener-bollinger-query';
import { bollingerStageLabels } from './stock-screener-bollinger-editor';
import * as styles from './stock-screener-panel.css';

const reasonLabels: Record<string, string> = { source_contract_pending: '兩市場來源契約尚未通過，正式下載／發布未啟用',
    schema_pending: '新價量資料庫尚未初始化', v8_preparation_pending: '尚未發布布林三階段報告', history_pending: '所需官方歷史尚未備齊',
    same_session_legacy_pending: '其他啟用條件尚無同日同母體資料，該分支為無法判定', new_session_pending: '新一期尚未備齊，以下為舊日期報告',
    calendar_authority_pending: '官方交易日 authority 尚未通過', universe_contract_pending: '普通股母體尚未通過驗證',
    calendar_closure_pending: '臨時休市公告尚未驗證，暫停歷史準備與發布',
    calendar_closure_review_required: '官方休市公告的日期或適用範圍需確認，未將空資料當作休市',
    invalid_closure_feed_coverage: '官方公告清單不完整，暫不更新交易日判定',
    invalid_closure_schema: '官方公告格式未通過驗證，保留交易日缺口',
    invalid_closure_date: '官方公告日期不合法，暫不排除交易日',
    invalid_closure_feed_year: '官方公告年份與查詢不符，暫不更新交易日',
    calendar_publication_review_required: '官方交易日窗口已更正，舊報告不可當作新窗口完成',
    broker_budget_pending: '本輪備援額度／限流檢查未放行；已取得資料保留，等待背景重驗',
    broker_budget_or_rate_denied: '本輪備援額度／限流檢查未放行；已取得資料保留，等待背景重驗',
    broker_rate_limited: '共用請求速率已達上限；已取得資料保留，冷卻後由背景續跑',
    run_budget: '本輪已達有界下載上限；已取得資料保留，下一輪背景續跑',
    source_cooldown: '來源仍在冷卻期間；已取得資料保留，不提前重試',
    source_attempts_exhausted: '來源已達重試上限，停止自動重試；已取得資料保留，須排除缺口來源原因並以可稽核方式處理，尚未發布完整報告',
    broker_policy_pending: '集中額度政策與其他工作承諾尚未驗證',
    broker_intraday_reserved: '盤前／盤中不補建日行情歷史，保留行情額度，盤後再續跑', source_selection_pending: '逐市場／日期來源選擇尚未備齊' };
export function StockScreenerBollingerResults({ response, filter, onFilter, onPick, onAdd, targetAvailable, statuses }: {
    response: BollingerResponse; filter: string; onFilter: (s: string) => void; onPick: (s: UniverseStock) => void;
    onAdd: (s: UniverseStock) => void; targetAvailable: boolean; statuses: Record<string, { status: string; message: string }>; }) {
    const totals = response.counts?.total;
    const backup = response.sourceEvidence?.selections.filter(s => s.provider === 'shioaji-daily-quotes') ?? [];
    const amountPolicy = response.sourceVolumeTolerances?.some(c => c.turnoverToleranceNtd === 1);
    return <section aria-label='布林三階段結果' className={styles.results}>
        <div role='status' className={styles.status}>
            <strong>布林三階段 · {response.state === 'ready' ? '已發布' : response.state === 'stale' ? '舊日期報告（禁止操作）' : '等待完整資料'}</strong>
            <div>預期資料日 {response.expectedSessionDate ?? '未確認'} · 有效資料日 {response.effectiveSessionDate ?? '尚無報告'}</div>
            {backup.length > 0 && <div>Shioaji 日行情備援 · 有效資料日 {response.effectiveSessionDate} · {new Set(backup.map(s => s.sessionDate)).size} 日歷史使用備援。
                {backup.some(s => s.switchReason === 'official_contract_pending') ? '官方來源契約尚待驗證。' : '官方來源失敗／冷卻；原失敗紀錄保留。'}</div>}
            {!!response.sourceConflicts?.length && <div className={styles.criticalStatus}>已知來源核對衝突 {response.sourceConflicts.length} 筆；目前報告仍引用原凍結來源，未暗中覆寫。
                <details><summary>衝突日期與來源 hash（唯讀）</summary><pre>{JSON.stringify(response.sourceConflicts, null, 2)}</pre></details></div>}
            {!!response.sourceVolumeTolerances?.length && <div>{amountPolicy ? '量／金額來源核對' : '成交量來源差異 ≤1%'}，容差檢查通過 {response.sourceVolumeTolerances.length} 筆；策略仍使用原凍結成交量，未校正原值。
                {amountPolicy && <div>新版來源核對允許量差 ≤1%、成交金額差 ≤1 元；策略仍使用原凍結金額，不放寬價量策略門檻。</div>}
                <details><summary>{amountPolicy ? '量／金額' : '成交量'}容差證據（唯讀，每筆最多列出 20 檔）</summary><pre>{JSON.stringify(response.sourceVolumeTolerances, null, 2)}</pre></details></div>}
            {response.reason && response.reason !== 'none' && <div>{reasonLabels[response.reason] ?? response.reason}</div>}
            {response.preparation?.reason && response.preparation.reason !== 'none' && <div>{reasonLabels[response.preparation.reason] ?? response.preparation.reason}</div>}
            {(response.requiredDays || response.preparation?.plannedDays) && <div>所需 {response.requiredDays ?? response.preparation?.plannedDays} 日 · 已備 {response.availableDays ?? response.preparation?.availableDays ?? 0} 日</div>}
            {response.preparation?.nextAttemptAt && <div>最早重試時間：{new Date(response.preparation.nextAttemptAt).toLocaleString('zh-TW', {timeZone:'Asia/Taipei',hour12:false})}（台北時間；由背景排程重新驗證）</div>}
            {response.legacyJoin && response.legacyJoin.reason !== 'none' && <div className={styles.criticalStatus}>{reasonLabels[response.legacyJoin.reason] ?? response.legacyJoin.reason}</div>}
            {totals && <div>策略母體 {totals.total} · 壓縮 {totals.compressing} · 準備 {totals.preparing} · 突破 {totals.breakout} · 未符合 {totals.notMatched} · 無法判定 {totals.unknown}</div>}
            {response.combinationCounts && <div>與其他條件組合：符合 {response.combinationCounts.matched} · 未符合 {response.combinationCounts.notMatched} · 無法判定 {response.combinationCounts.unknown}（非策略原始分類數）</div>}
        </div>
        {response.sourceEvidence && <details><summary>逐市場／日期來源、切換原因與版本證據（唯讀）</summary><pre>{JSON.stringify(response.sourceEvidence, null, 2)}</pre></details>}
        <div className={styles.controls} aria-label='布林分類切換'>{(['all', 'compressing', 'preparing', 'breakout', 'unknown', 'notMatched'] as const).map(stage =>
            <button type='button' key={stage} aria-pressed={filter === stage} onClick={() => onFilter(stage)}>{stage === 'all' ? '全部' : bollingerStageLabels[stage]}</button>)}</div>
        <p className={styles.note}>分類切換查詢同一期全市場底稿；策略原始分類數不變。</p>
        {response.rows.filter(r => filter === 'all' || r.outcome.stage === filter).map(row => {
            const stock: UniverseStock = { symbol: row.symbol, code: row.code, name: row.name, market: row.market, kind: 'ordinary' };
            const metric = bollingerSortMetric(row.outcome, 'percentilePosition'), percentile = metric && typeof metric === 'object'
                ? (Number(metric.numerator) / Number(metric.denominator) * 100).toFixed(1) : '—';
            const volume = bollingerSortMetric(row.outcome, 'breakoutVolumeRatio'), ratio = volume && typeof volume === 'object'
                ? (Number(volume.numerator) / Number(volume.denominator)).toFixed(2) : '—';
            return <article className={styles.row} key={row.symbol}>
                <div className={styles.rowTop}><button type='button' className={styles.rowAction} disabled={!targetAvailable || !response.canUseResults || response.state !== 'ready'} onClick={() => onPick(stock)}>
                    <strong>{row.code} {row.name} · <span data-bollinger-stage={row.outcome.stage}
                        className={row.outcome.stage === 'compressing' || row.outcome.stage === 'preparing' || row.outcome.stage === 'breakout'
                            ? styles.bollingerResultStage[row.outcome.stage] : undefined}>{bollingerStageLabels[row.outcome.stage]}</span></strong><span>{row.outcome.date} · {row.market}</span>
                    <span>BBW {row.outcome.setup.bbw?.toFixed(4) ?? '—'} · 前期百分位位置 {percentile}% · b {row.outcome.setup.b?.toFixed(3) ?? '—'} · 突破量 {ratio}×</span>
                    {response.legacyJoin && <span>組合結果：{row.verdict === 'pass' ? '符合' : row.verdict === 'fail' ? '未符合' : '無法判定'}</span>}
                </button><button type='button' className={styles.addButton} disabled={!response.canUseResults || response.state !== 'ready' || ['pending', 'complete'].includes(statuses[row.symbol]?.status ?? '')} onClick={() => onAdd(stock)}>
                    {statuses[row.symbol]?.status === 'complete' ? '已加入' : statuses[row.symbol]?.status === 'pending' ? '加入中…' : ['partial', 'failed'].includes(statuses[row.symbol]?.status ?? '') ? '重試加入' : '加入清單'}</button></div>
                {row.outcome.stage === 'unknown' && <p className={styles.criticalStatus}>無法判定，必要資料缺漏；不能視為未符合。請查逐條件證據。</p>}
                {statuses[row.symbol] && <p role='status' className={styles.addStatus}>{statuses[row.symbol]!.message}</p>}
                <details><summary>布林三階段逐條件證據</summary><pre>{JSON.stringify(row.outcome, null, 2)}</pre></details>
                {row.legacyEvidence != null && <details><summary>同日其他條件證據</summary><pre>{JSON.stringify(row.legacyEvidence, null, 2)}</pre></details>}
            </article>;
        })}
    </section>;
}
