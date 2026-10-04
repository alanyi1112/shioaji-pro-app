/** 操作者的兩日期契約診斷。不是正式 history admission，不啟用 profile、不發布、不免除舊債務。 */
import { createHash, randomUUID } from 'node:crypto';
import { createDailyQuotesFetcher, parseDailyQuotes, projectDailyQuotes, DAILY_QUOTES_URL, DAILY_QUOTES_MAPPING } from './stock-screener-shioaji-daily-quotes.mjs';
import { bollingerUniverseHash, validBollingerDate } from '../src/lib/stock-screener-bollinger-source.ts';
import { canonicalPriceUnits } from '../src/lib/stock-screener-ohlcv.ts';
import { compareSourceVolume, compareSourceTurnover, BOLLINGER_SOURCE_COMPARISON_POLICY, BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY } from '../src/lib/stock-screener-source-comparison.ts';

const sha = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const safe = n => Number.isSafeInteger(n) && n >= 0;
/** 只比對可判定的普通股，不把no_trade／缺OHLC當成價格、交易範圍相容性的肯定證據。 */
export function compareCalibrationProjection(broker, official, stocks, policy=BOLLINGER_SOURCE_COMPARISON_POLICY) {
    if(![BOLLINGER_SOURCE_COMPARISON_POLICY,BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY].some(p=>JSON.stringify(p)===JSON.stringify(policy)))
        throw new Error('invalid_source_comparison_policy');
    const index = new Map(broker.points.map(p=>[p.code,p])), known = new Map(official.points.map(p=>[p.code,p]));
    const counts = { exact:0, within_volume_tolerance:0, within_source_tolerance:0, conflict:0, unknown:0 }, rows=[];
    for(const stock of stocks.filter(s=>s.market===official.market)) {
        const b=index.get(stock.code),o=known.get(stock.code);let verdict='unknown',reason='non_ready_source';
        let difference=null,turnoverDifference=null;
        if(b?.readiness==='ready' && o?.readiness==='ready') {
            const sameDate=broker.sessionDate===official.sessionDate&&b.bar.sessionDate===o.bar.sessionDate
                &&b.bar.sessionDate===official.sessionDate;
            const prices=['open','high','low','close'].every(k=>canonicalPriceUnits(b.bar[k])===canonicalPriceUnits(o.bar[k]));
            difference=compareSourceVolume(b.bar.volumeShares,o.bar.volumeShares);
            turnoverDifference=compareSourceTurnover(b.bar.turnoverNtd,o.bar.turnoverNtd);
            const amount=policy.version===BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY.version
                ?turnoverDifference.withinTolerance:turnoverDifference.absoluteDifferenceNtd==='0';
            verdict=sameDate&&prices&&amount&&difference.withinTolerance
                ? difference.absoluteDifferenceShares==='0'&&turnoverDifference.absoluteDifferenceNtd==='0'?'exact'
                    :policy.version===BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY.version?'within_source_tolerance':'within_volume_tolerance':'conflict';
            reason=!sameDate?'date_mismatch':!prices?'price_mismatch':!amount?'turnover_mismatch':!difference.withinTolerance?'volume_mismatch':'none';
        }
        counts[verdict]++;
        rows.push({symbol:stock.symbol,verdict,reason,brokerReadiness:b?.readiness??'source_missing',officialReadiness:o?.readiness??'source_missing',
            difference,turnoverDifference,broker:b?.sourceValues??null,official:o?.sourceValues??null});
    }
    return {market:official.market,date:official.sessionDate,brokerHash:broker.payloadHash,officialHash:official.payloadHash,comparisonPolicy:policy,counts,rows};
}
/** usage 的更新可晚於HTTP回應。只追加後續真實counter觀察；原先delta=0不覆寫、不造即時增量。 */
export async function settleCalibrationMeasurements({db,observeUsage,now=()=>new Date()}) {
    const stored=(await db.prepare("SELECT id,checkpoint FROM screener_runs WHERE scope='bollinger-source-calibration-raw'").all()).results??[];
    if(stored.length!==2)throw new Error('broker_measurements_pending');
    const raws=stored.map(r=>({id:r.id,...JSON.parse(r.checkpoint)})).sort((a,b)=>Date.parse(a.before.observedAt)-Date.parse(b.before.observedAt));
    const after=await observeUsage();
    const observationId=`bollinger-calibration-usage:${randomUUID()}`;
    await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'bollinger-source-calibration-usage','observed',?,?)")
        .bind(observationId,JSON.stringify(after),now().toISOString()).run();
    const ends=[raws[1].before,after],samples=[];
    for(let i=0;i<2;i++) {
        const r=raws[i],end=ends[i],start=r.before;
        if(![start.usedBytes,end.usedBytes,start.limitBytes,end.limitBytes].every(safe)
            || start.generation!==end.generation || start.limitBytes!==end.limitBytes || end.usedBytes<=start.usedBytes
            || Date.parse(end.observedAt)<Date.parse(r.response.fetchedAt)
            || i===0 && Date.parse(end.observedAt)>Date.parse(raws[1].response.fetchedAt))
            throw new Error('broker_measurements_pending');
        const proof={version:1,rawId:r.id,rawHash:sha(JSON.parse(stored.find(s=>s.id===r.id).checkpoint)),date:r.date,
            start,end,endObservationId:i===0?raws[1].id:observationId,
            attribution:'non-overlapping-shared-usage-upper-bound',quotaEpochVerified:false};
        const evidenceHash=sha(proof),id=`bollinger-calibration-measurement:${evidenceHash}`;
        const measurement={evidenceHash,usageBefore:start.usedBytes,usageAfter:end.usedBytes,
            responseBytes:Buffer.byteLength(r.response.text),observedAt:end.observedAt,provider:'shioaji-daily-quotes'};
        await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'bollinger-source-calibration-measurement','observed',?,?) ON CONFLICT(id) DO NOTHING")
            .bind(id,JSON.stringify({proof,measurement}),now().toISOString()).run();
        samples.push(measurement);
    }
    return {observationId,measurements:samples,quotaEpochVerified:false,policyInstalled:false};
}
export async function calibrateScreenerSource({ db, dates, universe, calendar, observeUsage,
    budget, continuation = false, fetchReport = createDailyQuotesFetcher(), now = () => new Date() }) {
    // 每次真實校準都要指定保留與邊界，不以「目前還有很多流量」繞過正式 admission。
    if (!Array.isArray(dates) || dates.length !== 2 || new Set(dates).size !== 2 || dates.some(d => !validBollingerDate(d))
        || !budget || ![budget.quoteReserveBytes, budget.otherConsumerReserveBytes, budget.maxChargePerRequestBytes].every(safe)
        || budget.quoteReserveBytes < 1 || budget.otherConsumerReserveBytes < 1
        || budget.maxChargePerRequestBytes < 1 || budget.maxChargePerRequestBytes > 4 * 1024 ** 2
        || calendar?.status !== 'verified' || Date.parse(calendar.validThrough) <= now().getTime()
        || !/^[a-f0-9]{64}$/.test(calendar.authorityHash ?? '') || dates.some(d => !calendar.commonSessions.includes(d)))
        throw new Error('source_calibration_pending');
    const universeHash = await bollingerUniverseHash(universe);
    const prior = (await db.prepare("SELECT id,status,checkpoint FROM screener_runs WHERE scope='bollinger-source-calibration'").all()).results ?? [];
    // 真實診斷首次只有兩次，後續必須採正式預算，不可重複校準繞過歷史下載 Gate。
    let rawRows = [], previouslyRequested = 0;
    if (prior.length) {
        if (!continuation || prior.some(r => r.status !== 'partial')) throw new Error('source_calibration_already_recorded');
        const p = prior.map(r => JSON.parse(r.checkpoint));
        if (p.some(r => !Number.isInteger(r.requested) || r.requested < 1 || JSON.stringify(r.budget) !== JSON.stringify(budget)))
            throw new Error('source_calibration_already_recorded');
        previouslyRequested = p.reduce((n,r)=>n+r.requested,0);
        if (previouslyRequested >= 2) throw new Error('source_calibration_already_recorded');
        rawRows = (await db.prepare("SELECT id,checkpoint FROM screener_runs WHERE scope='bollinger-source-calibration-raw'").all()).results ?? [];
        if (rawRows.length !== previouslyRequested || rawRows.some(r=>!dates.includes(JSON.parse(r.checkpoint).date)))
            throw new Error('source_calibration_already_recorded');
    }
    const runId = `bollinger-calibration:${randomUUID()}`, startedAt = now().toISOString(), deadline = now().getTime()+15*60000;
    const claim = await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        SELECT ?,'bollinger-source-calibration','running',?,? WHERE NOT EXISTS
        (SELECT 1 FROM screener_runs WHERE scope='bollinger-source-calibration' AND status='running')
        AND (SELECT COUNT(*) FROM screener_runs WHERE scope='bollinger-source-calibration')=?`)
        .bind(runId, JSON.stringify({ dates, budget, universeHash }), startedAt, prior.length).run();
    if ((claim.meta?.changes ?? claim.changes) !== 1) throw new Error('source_calibration_already_recorded');
    const receipts = []; let requested = 0, reason = null;
    // parser 的 candidate 契約不是正式來源 review，不持久化成 verified，也不能供 publisher 使用。
    const candidate = { status: 'verified', provider: 'shioaji-daily-quotes', endpoint: DAILY_QUOTES_URL,
        mappingVersion: DAILY_QUOTES_MAPPING, volumeUnit: 'shares', turnoverUnit: 'TWD', priceBasis: 'unadjusted',
        tradeScope: 'official-daily-compatible', usage: 'local-historical-screener', markets: ['TWSE','TPEx'],
        minimumRows: 1, evidenceHash: sha({ type: 'candidate-schema-only', runId }), reviewedAt: startedAt,
        validThrough: new Date(now().getTime() + 15 * 60000).toISOString() };
    try {
        for (const date of dates) {
            if (now().getTime() >= deadline) throw new Error('source_calibration_deadline');
            const stored = rawRows.find(r => JSON.parse(r.checkpoint).date === date);
            let raw, rawId;
            if (stored) { raw = JSON.parse(stored.checkpoint); rawId = stored.id; }
            else {
            if (previouslyRequested + requested >= 2) throw new Error('source_calibration_already_recorded');
            const before = await observeUsage();
            if (!safe(before.remainingBytes) || before.remainingBytes - budget.quoteReserveBytes - budget.otherConsumerReserveBytes
                < budget.maxChargePerRequestBytes) throw new Error('broker_calibration_budget_denied');
            requested++;
            const response = await fetchReport(date);
            // usage 查詢可能失敗／generation 換代；先保存原始 response，不讓後續錯誤吃掉來源證據。
            await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'bollinger-source-calibration-response','observed',?,?)")
                .bind(`${runId}:${date}:response`,JSON.stringify({date,response,before,budget}),now().toISOString()).run();
            const after = await observeUsage();
            rawId = `${runId}:${date}:raw`;
            // 原始回應及計數先存再解；schema／相容性失敗也不失去 evidence，不寫任何正式 cache/head。
            raw = { version: 1, date, response, before, after, budget };
            await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'bollinger-source-calibration-raw','observed',?,?)")
                .bind(rawId, JSON.stringify(raw), now().toISOString()).run();
            }
            const { response, before, after } = raw;
            if (now().getTime() >= deadline) throw new Error('source_calibration_deadline');
            if (before.generation !== after.generation || before.limitBytes !== after.limitBytes || after.usedBytes < before.usedBytes)
                throw new Error('broker_calibration_identity_changed');
            const batch = parseDailyQuotes(response, date, candidate, now()), projection = await projectDailyQuotes(batch, universe);
            const evidence = { version: 1, date, rawId, rawHash: sha(raw), payloadHash: batch.payloadHash, bytes: batch.bytes,
                rows: batch.points.length, universeHash, markets: Object.fromEntries(['TWSE','TPEx'].map(m => {
                    const rows = projection.filter(r => r.market === m); return [m, {
                        total: rows.length, readiness: rows.reduce((n,r) => (n[r.readiness]=(n[r.readiness]??0)+1,n), {}),
                        missingSymbols: rows.filter(r=>r.readiness==='source_missing').map(r=>r.symbol) }]; })),
                usageBefore: before.usedBytes, usageAfter: after.usedBytes, sharedUsageDelta: after.usedBytes-before.usedBytes,
                measurementScope: 'shared-counter-upper-bound-not-exclusive-attribution', observedAt: after.observedAt,
                reusedRaw: !!stored, measurable: after.usedBytes > before.usedBytes };
            receipts.push(evidence);
            await db.prepare("INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at) VALUES(?,'bollinger-source-calibration-observation','observed',?,?)")
                .bind(`${runId}:${date}`, JSON.stringify({ ...evidence, evidenceHash: sha(evidence) }), now().toISOString()).run();
            if (evidence.sharedUsageDelta > budget.maxChargePerRequestBytes) throw new Error('broker_calibration_charge_exceeded');
        }
    } catch(e) { reason = /^(?:invalid_|source_|broker_)[a-z0-9_]+$/.test(e.message ?? '') ? e.message : 'source_calibration_failed'; }
    const result = { runId, state: reason ? 'partial' : 'complete', purpose: 'contract-diagnostics-only', requested,
        dates, universeHash, continuationOf: prior.map(r=>r.id), totalRequested: previouslyRequested+requested,
        reason, startedAt, completedAt: now().toISOString(), budget, receipts };
    await db.prepare('UPDATE screener_runs SET status=?,checkpoint=?,updated_at=? WHERE id=? AND status=\'running\'')
        .bind(result.state, JSON.stringify(result), result.completedAt, runId).run();
    return result;
}
