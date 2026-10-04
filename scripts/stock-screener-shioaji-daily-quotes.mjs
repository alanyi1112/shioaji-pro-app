/** 預設未接 watcher 的日行情備援 port；呼叫者必須提供來源 review、官方 Gate 與集中額度 admission。 */
import { request as httpRequest } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { validBollingerDate, bollingerUniverseHash, projectBollingerReport } from '../src/lib/stock-screener-bollinger-source.ts';
import { canonicalPriceUnits, validateCanonicalOhlcv } from '../src/lib/stock-screener-ohlcv.ts';

export const DAILY_QUOTES_URL = 'http://127.0.0.1:8080/api/v1/data/daily_quotes';
export const DAILY_QUOTES_MAPPING = 'shioaji-daily-quotes-shares-twd-v2';
export const DAILY_QUOTES_MAPPING_V1 = 'shioaji-daily-quotes-shares-twd-v1';
const FIELDS = ['Date', 'Code', 'Open', 'High', 'Low', 'Close', 'Volume', 'Transaction', 'Amount'];
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 2 * 1024 ** 2;
const MAX_INT64 = 9223372036854775807n;
const sha = text => createHash('sha256').update(text).digest('hex');
const stamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const knownError = e => /^(?:invalid_\w+|source_\w+|daily_quotes_\w+|simulation_\w+|broker_\w+)$/.test(e?.message ?? '')
    ? e.message : 'source_transport_failed';

export function validDailyQuotesReview(review, now = new Date()) {
    return review?.status === 'verified' && review.provider === 'shioaji-daily-quotes'
        && review.endpoint === DAILY_QUOTES_URL && [DAILY_QUOTES_MAPPING_V1, DAILY_QUOTES_MAPPING].includes(review.mappingVersion)
        && review.volumeUnit === 'shares' && review.turnoverUnit === 'TWD'
        && review.priceBasis === 'unadjusted' && review.tradeScope === 'official-daily-compatible'
        // 已開通官方 API 的個人本機分析，不要求文件未規定的額外「展示許可」。
        // usage 仍限制本機範圍；legacy localDisplayVerified 僅留原始 metadata，不作 API 授權 Gate。
        && review.usage === 'local-historical-screener'
        && Array.isArray(review.markets) && review.markets.length === 2 && review.markets.includes('TWSE') && review.markets.includes('TPEx')
        && HASH.test(review.evidenceHash ?? '') && stamp(review.reviewedAt) && stamp(review.validThrough)
        && Date.parse(review.reviewedAt) <= now.getTime() && Date.parse(review.validThrough) > now.getTime()
        && Number.isInteger(review.minimumRows) && review.minimumRows > 0 && review.minimumRows <= 10000;
}

/** 僅解 column-array JSON；重複 keys、嵌套資料及不合法 JSON 拒絕。數字保存原 lexeme，從未轉 Number。 */
function columnsFromJson(text) {
    let pos = 0;
    const skip = () => { while (/[\t\n\r ]/.test(text[pos] ?? '') && pos < text.length) pos++; };
    const expect = c => { skip(); if (text[pos++] !== c) throw new Error('invalid_report_schema'); };
    const string = () => {
        skip(); const match = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/.exec(text.slice(pos));
        if (!match) throw new Error('invalid_report_schema');
        pos += match[0].length; return JSON.parse(match[0]);
    };
    const scalar = () => {
        skip(); if (text[pos] === '"') return string();
        if (text.slice(pos, pos + 4) === 'null') { pos += 4; return null; }
        const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(pos));
        if (!match) throw new Error('invalid_report_schema');
        pos += match[0].length; return { numberLexeme: match[0] };
    };
    const columns = Object.create(null); expect('{');
    while (true) {
        skip(); if (text[pos] === '}') { pos++; break; }
        const key = string();
        if (!FIELDS.includes(key) || Object.hasOwn(columns, key)) throw new Error('invalid_report_schema');
        expect(':'); expect('['); const values = []; skip();
        if (text[pos] !== ']') {
            while (true) {
                values.push(scalar()); if (values.length > 10000) throw new Error('invalid_report_universe');
                skip(); if (text[pos] === ']') break;
                expect(',');
            }
        }
        expect(']'); columns[key] = values; skip();
        if (text[pos] === '}') { pos++; break; }
        expect(','); skip(); if (text[pos] === '}') throw new Error('invalid_report_schema');
    }
    skip(); if (pos !== text.length || Object.keys(columns).length !== FIELDS.length) throw new Error('invalid_report_schema');
    return columns;
}

function integer(value) {
    const raw = value?.numberLexeme;
    if (typeof raw !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(raw) || BigInt(raw) > MAX_INT64)
        throw new Error('invalid_report_integer');
    return raw;
}
function price(value) {
    if (value === null) return null;
    const raw = value?.numberLexeme;
    if (typeof raw !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(raw)) throw new Error('invalid_report_price');
    return raw.includes('.') ? raw.replace(/0+$/, '').replace(/\.$/, '') : raw;
}

export function parseDailyQuotes(response, sessionDate, review, now = new Date()) {
    if (!validDailyQuotesReview(review, now)) throw new Error('source_contract_pending');
    if (!validBollingerDate(sessionDate) || response?.sourceUrl !== DAILY_QUOTES_URL
        || !stamp(response.fetchedAt) || Date.parse(response.fetchedAt) > now.getTime() + 60000)
        throw new Error('invalid_source_provenance');
    if (response.status !== 200) throw new Error(`source_http_${response.status}`);
    if (typeof response.text !== 'string') throw new Error('invalid_report_schema');
    const bytes = Buffer.byteLength(response.text);
    if (!bytes || bytes > MAX_BYTES) throw new Error('invalid_source_size');
    const columns = columnsFromJson(response.text), size = columns.Date.length;
    if (!size) throw new Error('source_not_published');
    if (size < review.minimumRows || FIELDS.some(k => columns[k].length !== size)) throw new Error('invalid_report_universe');
    const codes = new Set(), points = [];
    for (let i = 0; i < size; i++) {
        if (columns.Date[i] !== sessionDate) throw new Error('invalid_report_date');
        const code = columns.Code[i];
        if (typeof code !== 'string' || !/^[A-Z0-9]{4,12}$/.test(code) || codes.has(code)) throw new Error('invalid_report_universe');
        codes.add(code);
        const volumeShares = integer(columns.Volume[i]), turnoverNtd = integer(columns.Amount[i]), transactions = integer(columns.Transaction[i]);
        const [open, high, low, close] = ['Open', 'High', 'Low', 'Close'].map(k => price(columns[k][i]));
        const sourceValues = { open, high, low, close, volumeShares, turnoverNtd };
        let bar = null, readiness = 'no_trade';
        if (volumeShares === '0') {
            if (turnoverNtd !== '0' || transactions !== '0') throw new Error('invalid_report_no_trade');
        } else {
            if (review.mappingVersion === DAILY_QUOTES_MAPPING && [open, high, low, close].every(p => p === null)
                && turnoverNtd !== '0' && transactions !== '0') {
                // 真實來源存在只有成交統計、未提供任何整股 OHLC 的列。保留原量／金額，
                // 逐股 unknown，不把它改成零成交；部分 null 或非法大小關係仍整批拒絕。
                points.push({ code, bar: null, readiness: 'missing_ohlcv', sourceValues, transactions });
                continue;
            }
            bar = { sessionDate, open, high, low, close, volumeShares, turnoverNtd };
            if (![open, high, low, close].every(p => canonicalPriceUnits(p) !== null)
                || !validateCanonicalOhlcv(bar) || turnoverNtd === '0' || transactions === '0') throw new Error('invalid_report_ohlcv');
            readiness = 'ready';
        }
        points.push({ code, bar, readiness, sourceValues, transactions });
    }
    return { provider: 'shioaji-daily-quotes', sessionDate, sourceUrl: DAILY_QUOTES_URL, fetchedAt: response.fetchedAt,
        payloadHash: sha(response.text), reviewHash: review.evidenceHash, mappingVersion: review.mappingVersion,
        volumeUnit: 'shares', turnoverUnit: 'TWD', bytes, points };
}

export async function projectDailyQuotes(batch, universe) {
    await bollingerUniverseHash(universe);
    if (new Set(universe.map(s => s.code)).size !== universe.length) throw new Error('invalid_bollinger_universe');
    return ['TWSE', 'TPEx'].flatMap(market => projectBollingerReport({ ...batch, market }, universe))
        .map(row => ({ ...row, provenance: { ...row.provenance, provider: batch.provider } }));
}

/** 固定 loopback POST，無 retry／redirect；timeout 為整體 deadline，不只是 idle socket timeout。 */
export function createDailyQuotesFetcher({ request = httpRequest, timeoutMs = 15000, maxBytes = MAX_BYTES, now = () => new Date() } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
        || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new Error('invalid_source_budget');
    return (sessionDate, signal) => new Promise((resolve, reject) => {
        if (!validBollingerDate(sessionDate)) { reject(new Error('invalid_source_target')); return; }
        let req, responseStream, timer, done = false, bytes = 0;
        const finish = (error, value) => {
            if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
            if (error) { responseStream?.destroy(); req?.destroy(); reject(error); } else resolve(value);
        };
        const abort = () => finish(new Error('source_aborted'));
        if (signal?.aborted) { abort(); return; }
        const body = JSON.stringify({ date: sessionDate, exclude: true });
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => finish(new Error('source_timeout')), timeoutMs);
        try {
            req = request(DAILY_QUOTES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body), Accept: 'application/json', 'Accept-Encoding': 'identity' } }, response => {
                responseStream = response; const chunks = [];
                response.on('data', chunk => {
                    bytes += chunk.length;
                    if (bytes > maxBytes) { finish(new Error('invalid_source_size')); return; }
                    chunks.push(chunk);
                });
                response.on('error', () => finish(new Error('source_transport_failed')));
                response.on('aborted', () => finish(new Error('source_response_aborted')));
                response.on('end', () => finish(null, { sourceUrl: DAILY_QUOTES_URL, status: response.statusCode ?? 500,
                    retryAfter: response.headers['retry-after'] ?? null, text: Buffer.concat(chunks).toString('utf8'), fetchedAt: now().toISOString() }));
            });
            req.on('error', e => finish(new Error(e.code === 'ECONNRESET' ? 'source_connection_reset' : 'source_transport_failed')));
            req.end(body);
        } catch { finish(new Error('source_transport_failed')); }
    });
}

function validateGate(gate, date, now) {
    if (gate?.calendarStatus !== 'verified' || !HASH.test(gate.authorityHash ?? '')
        || !stamp(gate.validThrough) || Date.parse(gate.validThrough) <= now.getTime()
        || !Array.isArray(gate.commonSessions) || !gate.commonSessions.includes(date)
        || gate.universeStatus !== 'verified') throw new Error('daily_quotes_authority_pending');
}

/** 同日期全市場租約與不可變 cache；獨立 attempts/receipts 不會改官方批次或 head。 */
export async function loadDailyQuotesBatch({ db, sessionDate, review, gate, fetchReport, safety, admission,
    signal, now = () => new Date() }) {
    const start = now();
    if (!validBollingerDate(sessionDate)) throw new Error('invalid_source_target');
    if (!validDailyQuotesReview(review, start)) return { state: 'pending', reason: 'source_contract_pending', requested: 0 };
    try { validateGate(gate, sessionDate, start); } catch (e) { return { state: 'pending', reason: knownError(e), requested: 0 }; }
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('screener_daily_quotes_cache','screener_daily_quotes_receipts')").all();
    if (tables.results?.length !== 2) return { state: 'pending', reason: 'schema_pending', requested: 0 };
    // review 換版不能自動重置同 provider/date 的嘗試／invalid 或重抓已凍結批次。
    const cacheKey = `${review.mappingVersion}|${sessionDate}`;
    const get = () => db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').bind(cacheKey).first();
    const cached = async () => {
        const row = await get();
        if (row && row.review_hash !== review.evidenceHash) throw new Error('invalid_stored_review');
        if (row?.status !== 'complete') return null;
        if (!row.response_text || sha(row.response_text) !== row.payload_hash) throw new Error('invalid_cached_report');
        return { state: 'complete', requested: 0, batch: parseDailyQuotes({ sourceUrl: DAILY_QUOTES_URL,
            status: 200, fetchedAt: row.fetched_at, text: row.response_text }, sessionDate, review, now()) };
    };
    const hit = await cached(); if (hit) return hit;
    const owner = randomUUID(), leaseUntil = new Date(start.getTime() + 60000).toISOString();
    await db.prepare(`INSERT INTO screener_daily_quotes_cache(cache_key,session_date,review_hash,status,attempts,lease_owner,lease_until,updated_at)
        VALUES(?,?,?,'pending',0,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET lease_owner=excluded.lease_owner,
        lease_until=excluded.lease_until,updated_at=excluded.updated_at WHERE screener_daily_quotes_cache.status='pending'
        AND screener_daily_quotes_cache.attempts<18 AND (screener_daily_quotes_cache.lease_until IS NULL OR screener_daily_quotes_cache.lease_until<=?)
        AND (screener_daily_quotes_cache.next_attempt_at IS NULL OR screener_daily_quotes_cache.next_attempt_at<=?)`)
        .bind(cacheKey, sessionDate, review.evidenceHash, owner, leaseUntil, start.toISOString(), start.toISOString(), start.toISOString()).run();
    let row = await get();
    if (row?.lease_owner !== owner) {
        const hitAfterClaim = await cached(); if (hitAfterClaim) return hitAfterClaim;
        if (row?.status === 'pending' && row.attempts === 0 && /^(broker_|simulation_)/.test(row.reason ?? '')
            && Date.parse(row.next_attempt_at ?? '') > start.getTime())
            return { state:'pending', reason:row.reason, requested:0, globalPause:true, nextAttemptAt:row.next_attempt_at };
        const reason = row?.status === 'invalid' ? row.reason : row?.attempts >= 18 ? 'source_attempts_exhausted'
            : Date.parse(row?.lease_until ?? '') > start.getTime() ? 'daily_quotes_lease_busy'
                : Date.parse(row?.next_attempt_at ?? '') > start.getTime() ? 'source_cooldown' : 'daily_quotes_lease_busy';
        // 唯讀揭露原冷卻期限；invalid／耗盡嘗試不宣稱會自動重試。
        return { state: 'pending', reason, requested: 0,
            nextAttemptAt: reason === 'source_cooldown' ? row.next_attempt_at : null };
    }
    const owned = async () => { const r = await get(); return r?.lease_owner === owner && Date.parse(r.lease_until) > now().getTime(); };
    const receipt = (status, payload) => db.prepare('INSERT INTO screener_daily_quotes_receipts(id,cache_key,status,payload,created_at) VALUES(?,?,?,?,?)')
        .bind(randomUUID(), cacheKey, status, JSON.stringify(payload), now().toISOString());
    let reserved = null, requested = 0, response = null;
    try {
        if (typeof safety !== 'function' || typeof admission?.reserve !== 'function' || typeof admission?.settle !== 'function'
            || typeof fetchReport !== 'function') throw new Error('broker_admission_pending');
        const safe = await safety();
        if (safe?.simulation !== true || safe.businessSessionEstablished !== true || !stamp(safe.observedAt)
            || now().getTime() - Date.parse(safe.observedAt) < 0 || now().getTime() - Date.parse(safe.observedAt) > 60000
            || typeof safe.generation !== 'string' || !safe.generation) throw new Error('simulation_session_pending');
        reserved = await admission.reserve({ cacheKey, sessionDate, maxResponseBytes: MAX_BYTES, generation: safe.generation });
        if (reserved?.allowed !== true || typeof reserved.reservationId !== 'string' || !reserved.reservationId)
            throw new Error(/^broker_\w+$/.test(reserved?.reason ?? '') ? reserved.reason : 'broker_budget_pending');
        if (signal?.aborted) throw new Error('source_aborted');
        if (!await owned()) throw new Error('daily_quotes_lease_lost');
        // 短租約內第二次檢查，API generation 改變時不能把舊 admission 當新 session。
        const current = await safety();
        if (current?.simulation !== true || current.businessSessionEstablished !== true || current.generation !== safe.generation
            || !stamp(current.observedAt) || now().getTime() - Date.parse(current.observedAt) < 0
            || now().getTime() - Date.parse(current.observedAt) > 60000)
            throw new Error('simulation_generation_changed');
        if (!await owned()) throw new Error('daily_quotes_lease_lost');
        const startedAt = now().toISOString(), expectedAttempts = row.attempts + 1;
        await db.batch([db.prepare(`UPDATE screener_daily_quotes_cache SET attempts=attempts+1,next_attempt_at=? WHERE cache_key=? AND lease_owner=? AND lease_until>?`)
            .bind(new Date(now().getTime() + 20 * 60000).toISOString(), cacheKey, owner, startedAt),
            db.prepare(`INSERT INTO screener_daily_quotes_receipts(id,cache_key,status,payload,created_at)
                SELECT ?,?,'started',?,? WHERE EXISTS(SELECT 1 FROM screener_daily_quotes_cache
                    WHERE cache_key=? AND lease_owner=? AND lease_until>? AND attempts=?)`)
                .bind(randomUUID(), cacheKey, JSON.stringify({ sessionDate, generation: safe.generation,
                    reservationId: reserved.reservationId }), startedAt, cacheKey, owner, startedAt, expectedAttempts)]);
        const startedRow = await get();
        if (startedRow?.lease_owner !== owner || startedRow.attempts !== expectedAttempts
            || Date.parse(startedRow.lease_until) <= now().getTime()) throw new Error('daily_quotes_lease_lost');
        if (typeof admission.start === 'function') await admission.start({ reservationId: reserved.reservationId });
        requested = 1;
        response = await fetchReport(sessionDate, signal);
        const batch = parseDailyQuotes(response, sessionDate, review, now());
        if (!await owned()) throw new Error('daily_quotes_lease_lost');
        const completedAt = now().toISOString();
        await db.batch([db.prepare(`INSERT INTO screener_daily_quotes_receipts(id,cache_key,status,payload,created_at)
            SELECT ?,?,'complete',?,? WHERE EXISTS(SELECT 1 FROM screener_daily_quotes_cache WHERE cache_key=? AND lease_owner=? AND lease_until>?)`)
            .bind(randomUUID(), cacheKey, JSON.stringify({ sessionDate, payloadHash: batch.payloadHash, rowCount: batch.points.length,
                bytes: batch.bytes, requested }), completedAt, cacheKey, owner, completedAt),
            db.prepare(`UPDATE screener_daily_quotes_cache SET status='complete',response_text=?,payload_hash=?,fetched_at=?,
            lease_owner=NULL,lease_until=NULL,next_attempt_at=NULL,reason=NULL,updated_at=? WHERE cache_key=? AND lease_owner=? AND lease_until>?`)
            .bind(response.text, batch.payloadHash, batch.fetchedAt, completedAt, cacheKey, owner, completedAt)]);
        row = await get();
        if (row?.status !== 'complete' || row.payload_hash !== batch.payloadHash) throw new Error('daily_quotes_lease_lost');
        return { state: 'complete', requested, batch };
    } catch (error) {
        const reason = knownError(error), invalid = reason.startsWith('invalid_');
        const globalPause = requested === 0 && /^(broker_|simulation_)/.test(reason);
        let wait = 20 * 60000;
        // admission 尚未送出 HTTP，不能套來源失敗的二十分鐘逐日冷卻。
        // 已保存的舊冷卻不改寫；新的全域拒絕只暫停當輪，下一輪重驗 Gate。
        if (globalPause) wait = 60000;
        if (globalPause && reason === 'broker_rate_limited' && stamp(reserved?.nextAttemptAt)) {
            const delay = Date.parse(reserved.nextAttemptAt) - now().getTime();
            if (delay > 0 && delay <= 3600000) wait = delay;
        }
        if (response?.status === 429) {
            const raw = response.retryAfter, seconds = /^\d+$/.test(raw ?? '') ? Number(raw) : null;
            const after = seconds === null ? Date.parse(raw ?? '') - now().getTime() : seconds * 1000;
            // 不為了縮短等待而截斷 Retry-After；無法表示的期限保留為 invalid，不能提早重試。
            if ((!Number.isFinite(after) && seconds !== null) || (Number.isFinite(after)
                && now().getTime() + Math.max(3600000, after) > 8640000000000000)) {
                if (await owned()) await db.batch([db.prepare(`UPDATE screener_daily_quotes_cache SET status='invalid',
                    reason='invalid_retry_after',lease_owner=NULL,lease_until=NULL,updated_at=? WHERE cache_key=? AND lease_owner=?`)
                    .bind(now().toISOString(), cacheKey, owner), receipt('failed', { reason: 'invalid_retry_after', requested, sessionDate })]);
                return { state: 'pending', reason: 'invalid_retry_after', requested, nextAttemptAt: null };
            }
            wait = Math.max(3600000, Number.isFinite(after) ? after : 0);
        }
        const nextAttemptAt = new Date(now().getTime() + wait).toISOString();
        if (await owned()) await db.batch([db.prepare(`UPDATE screener_daily_quotes_cache SET status=?,reason=?,next_attempt_at=?,
            lease_owner=NULL,lease_until=NULL,updated_at=? WHERE cache_key=? AND lease_owner=? AND lease_until>?`)
            .bind(invalid ? 'invalid' : 'pending', reason, invalid ? null : nextAttemptAt, now().toISOString(), cacheKey, owner, now().toISOString()),
            receipt('failed', { reason, requested, sessionDate, globalPause, nextAttemptAt:invalid ? null : nextAttemptAt,
                responseBytes: typeof response?.text === 'string' ? Buffer.byteLength(response.text) : null })]);
        else await receipt('lease_lost', { reason, requested, sessionDate }).run();
        return { state: 'pending', reason, requested, globalPause, nextAttemptAt: invalid ? null : nextAttemptAt };
    } finally {
        if (reserved?.allowed === true) await admission.settle({ reservationId: reserved.reservationId, requested,
            responseBytes: typeof response?.text === 'string' ? Buffer.byteLength(response.text) : null });
    }
}
