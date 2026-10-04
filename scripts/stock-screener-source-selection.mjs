/** 本機背景來源帳本；只接受已保存的來源收據，不抓來源、不切 head、不重解釋舊 cursor。 */
import { createHash } from 'node:crypto';
import { validBollingerDate, validateBollingerSourceReview, parseBollingerOfficialReport,
    projectBollingerReport, bollingerUniverseHash, bollingerSourceUrl } from '../src/lib/stock-screener-bollinger-source.ts';
import { canonicalPriceUnits } from '../src/lib/stock-screener-ohlcv.ts';
import { SCREENER_V8_MAPPING_VERSION } from '../src/lib/stock-screener-v8.ts';
import { technicalEvidenceHash } from '../src/lib/stock-screener-technical-patterns.ts';
import { validDailyQuotesReview, parseDailyQuotes, DAILY_QUOTES_MAPPING, DAILY_QUOTES_MAPPING_V1, DAILY_QUOTES_URL } from './stock-screener-shioaji-daily-quotes.mjs';
import { assessSourceComparison, BOLLINGER_SOURCE_COMPARISON_POLICY, BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY } from '../src/lib/stock-screener-source-comparison.ts';

/** @type {import('../src/lib/stock-screener-source-evidence.ts').BollingerSourceEvidence['manifest']['policyVersion']} */
export const SOURCE_POLICY_VERSION = 'bollinger-source-selection-v1';
const PROVIDERS = ['official-twse', 'official-tpex', 'shioaji-daily-quotes'];
const HASH = /^[a-f0-9]{64}$/;
const COMMON_KEYS = ['status', 'mappingVersion', 'volumeUnit', 'turnoverUnit', 'endpoint', 'usage', 'evidenceHash',
    'reviewedAt', 'validThrough', 'minimumRows', 'priceBasis', 'tradeScope', 'localDisplayVerified'];
const sha = v => createHash('sha256').update(v).digest('hex');
const stamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const hash = technicalEvidenceHash;
const marketFor = provider => provider === 'official-twse' ? 'TWSE' : provider === 'official-tpex' ? 'TPEx' : null;
const sortedRows = rows => [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
const schemaNames = ['screener_source_universes', 'screener_source_reviews', 'screener_source_selections', 'screener_source_selected_rows', 'screener_source_comparisons'];
const REVIEW_REASONS = ['source_contract_pending', 'source_transport_failed', 'source_connection_reset',
    'invalid_report_schema', 'invalid_report_date', 'official_contract_pending'];

export async function sourceSelectionSchemaReady(db) {
    const names = (await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?,?,?)`)
        .bind(...schemaNames).all()).results ?? [];
    return names.length === schemaNames.length;
}
function reviewShape(provider, review, reason, now, checkExpiry = true) {
    const allowed = new Set([...COMMON_KEYS, ...(provider === 'shioaji-daily-quotes' ? ['provider', 'markets'] : ['market'])]);
    if (!PROVIDERS.includes(provider) || !review || Object.keys(review).some(k => !allowed.has(k))
        || !['verified', 'pending', 'invalid'].includes(review.status) || !HASH.test(review.evidenceHash ?? '')
        || !stamp(review.reviewedAt) || Date.parse(review.reviewedAt) > now.getTime()
        || !stamp(review.validThrough) || Date.parse(review.validThrough) <= Date.parse(review.reviewedAt)
        || (reason !== null && !REVIEW_REASONS.includes(reason))) throw new Error('invalid_source_review');
    const expectedEndpoint = provider === 'shioaji-daily-quotes' ? DAILY_QUOTES_URL
        : new URL(bollingerSourceUrl(marketFor(provider), '2026-01-01'));
    const endpoint = typeof expectedEndpoint === 'string' ? expectedEndpoint : expectedEndpoint.origin + expectedEndpoint.pathname;
    if (review.endpoint !== undefined && review.endpoint !== endpoint
        || review.usage !== undefined && review.usage !== 'local-historical-screener'
        || review.priceBasis !== undefined && !['unadjusted', 'unknown'].includes(review.priceBasis)
        || review.tradeScope !== undefined && !['official-daily-compatible', 'unknown'].includes(review.tradeScope)
        || review.volumeUnit !== undefined && review.volumeUnit !== 'shares'
        || review.turnoverUnit !== undefined && review.turnoverUnit !== 'TWD'
        || review.localDisplayVerified !== undefined && typeof review.localDisplayVerified !== 'boolean'
        || review.minimumRows !== undefined && (!Number.isInteger(review.minimumRows) || review.minimumRows < 1 || review.minimumRows > 10000)
        || review.provider !== undefined && review.provider !== provider
        || review.market !== undefined && review.market !== marketFor(provider)
        || review.markets !== undefined && (!Array.isArray(review.markets) || review.markets.length !== 2
            || !review.markets.includes('TWSE') || !review.markets.includes('TPEx'))
        || review.mappingVersion !== undefined && !(provider === 'shioaji-daily-quotes'
            ? [DAILY_QUOTES_MAPPING_V1, DAILY_QUOTES_MAPPING].includes(review.mappingVersion)
            : review.mappingVersion === SCREENER_V8_MAPPING_VERSION)) throw new Error('invalid_source_review');
    if (review.status !== 'verified') {
        if (!reason) throw new Error('invalid_source_review');
        return;
    }
    if (reason !== null || review.priceBasis !== 'unadjusted' || review.tradeScope !== 'official-daily-compatible'
        // 官網歷史入口仍依各自條款審查；不能將已開通 Shioaji API 的個人用途再要求特別許可。
        || provider !== 'shioaji-daily-quotes' && review.localDisplayVerified !== true) throw new Error('invalid_source_review');
    // 歷史已儲存 review 可讀但不能取得新批次；效期仍由每次 admission 獨立核對。
    const validationAt = checkExpiry ? now : new Date(review.reviewedAt);
    if (!(provider === 'shioaji-daily-quotes' ? validDailyQuotesReview(review, validationAt)
        : validateBollingerSourceReview(review, marketFor(provider), validationAt))) throw new Error('source_contract_pending');
}
export async function saveSourceReview(db, { provider, review, reason = null }, now = new Date()) {
    reviewShape(provider, review, reason, now);
    if (!await sourceSelectionSchemaReady(db)) throw new Error('schema_pending');
    const payload = { provider, review, reason }, id = await hash(payload);
    await db.prepare(`INSERT INTO screener_source_reviews(id,provider,evidence_hash,status,payload,created_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
        .bind(id, provider, review.evidenceHash, review.status, JSON.stringify(payload), now.toISOString()).run();
    const record = await db.prepare('SELECT id FROM screener_source_reviews WHERE provider=? AND evidence_hash=?')
        .bind(provider, review.evidenceHash).first();
    if (record?.id !== id) throw new Error('invalid_review_revision');
    return readSourceReview(db, id, now);
}
export async function readSourceReview(db, id, now = new Date()) {
    if (!HASH.test(id ?? '')) throw new Error('invalid_source_review');
    const record = await db.prepare('SELECT * FROM screener_source_reviews WHERE id=?').bind(id).first();
    if (!record) throw new Error('source_review_missing');
    const body = JSON.parse(record.payload);
    if (await hash(body) !== id || body.provider !== record.provider || body.review?.status !== record.status
        || body.review?.evidenceHash !== record.evidence_hash) throw new Error('invalid_stored_review');
    reviewShape(body.provider, body.review, body.reason, now, false);
    return { id, ...body };
}
function gateReady(gate, date, now) {
    if (gate?.calendarStatus !== 'verified' || !HASH.test(gate.authorityHash ?? '') || gate.universeStatus !== 'verified'
        || !Array.isArray(gate.commonSessions) || !gate.commonSessions.includes(date)
        || !stamp(gate.validThrough) || Date.parse(gate.validThrough) <= now.getTime()) throw new Error('source_authority_pending');
}
async function receiptProof(db, table, id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('invalid_source_receipt');
    const record = await db.prepare(`SELECT status,payload FROM ${table} WHERE id=?`).bind(id).first();
    if (!record) throw new Error('source_receipt_missing');
    return { ...record, body: JSON.parse(record.payload), id, receiptHash: sha(record.payload) };
}
async function verifiedProjection({ db, provider, market, sessionDate, reviewId, response, storedOfficialReport, fetchReceiptId, universe, now }) {
    if (!PROVIDERS.includes(provider) || !['TWSE', 'TPEx'].includes(market) || !validBollingerDate(sessionDate)
        || marketFor(provider) && marketFor(provider) !== market) throw new Error('invalid_source_selection');
    const sourceReview = await readSourceReview(db, reviewId, now);
    if (sourceReview.provider !== provider || sourceReview.review.status !== 'verified') throw new Error('source_contract_pending');
    reviewShape(provider, sourceReview.review, null, now);
    const review = sourceReview.review;
    let report, cacheKey = null, proof;
    if (provider === 'shioaji-daily-quotes') {
        report = { ...parseDailyQuotes(response, sessionDate, review, now), market };
        cacheKey = `${review.mappingVersion}|${sessionDate}`;
        const cached = await db.prepare('SELECT * FROM screener_daily_quotes_cache WHERE cache_key=?').bind(cacheKey).first();
        if (cached?.status !== 'complete' || cached.review_hash !== report.reviewHash || cached.payload_hash !== report.payloadHash
            || cached.fetched_at !== report.fetchedAt || cached.response_text !== response.text) throw new Error('invalid_cached_report');
        proof = await receiptProof(db, 'screener_daily_quotes_receipts', fetchReceiptId);
        const identity = await db.prepare('SELECT cache_key FROM screener_daily_quotes_receipts WHERE id=?').bind(fetchReceiptId).first();
        if (identity?.cache_key !== cacheKey || proof.status !== 'complete' || proof.body.sessionDate !== sessionDate
            || proof.body.payloadHash !== report.payloadHash || proof.body.rowCount !== report.points.length
            || proof.body.bytes !== report.bytes || proof.body.requested !== 1) throw new Error('invalid_source_receipt');
    } else {
        if (response) report = await parseBollingerOfficialReport(response, market, sessionDate, review, now);
        else {
            // 原官方準備器已存具 hash 的 parsed report；只重用 DB 的同一合法批次，不接受 caller 自造 report。
            const stored = (await db.prepare('SELECT report FROM screener_bollinger_batches WHERE market=? AND session_date=?')
                .bind(market, sessionDate).all()).results ?? [];
            const match = stored.find(row => row.report && JSON.parse(row.report).hash === storedOfficialReport?.hash);
            if (!match) throw new Error('invalid_cached_report');
            const body = JSON.parse(match.report);
            if (await hash(body.report) !== body.hash || JSON.stringify(body.report) !== JSON.stringify(storedOfficialReport.report))
                throw new Error('invalid_cached_report');
            report = body.report;
            if (report.market !== market || report.sessionDate !== sessionDate || report.reviewHash !== review.evidenceHash
                || report.sourceUrl !== bollingerSourceUrl(market, sessionDate) || report.mappingVersion !== SCREENER_V8_MAPPING_VERSION
                || report.volumeUnit !== 'shares' || report.turnoverUnit !== 'TWD' || !HASH.test(report.payloadHash))
                throw new Error('invalid_cached_report');
        }
        proof = await receiptProof(db, 'screener_bollinger_receipts', fetchReceiptId);
        if (!['source_verified', 'complete'].includes(proof.status) || proof.body.sessionDate !== sessionDate
            || proof.body.market !== market || proof.body.payloadHash !== report.payloadHash) throw new Error('invalid_source_receipt');
        if (proof.status === 'complete' && proof.body.reviewHash !== report.reviewHash) throw new Error('invalid_source_receipt');
        if (proof.status === 'source_verified') {
            const stored = await db.prepare('SELECT report FROM screener_bollinger_batches WHERE market=? AND session_date=?')
                .bind(market, sessionDate).all();
            const matches = [];
            for (const row of stored.results ?? []) {
                const body = JSON.parse(row.report ?? 'null');
                if (body?.report?.payloadHash === report.payloadHash && body.report.reviewHash === report.reviewHash
                    && await hash(body.report) === body.hash) matches.push(body);
            }
            if (!matches.length) throw new Error('invalid_source_receipt');
        }
    }
    const projection = sortedRows(projectBollingerReport(report, universe).map(r => ({ ...r, provenance: {
        ...r.provenance, provider, requestedDate: sessionDate, actualDate: report.sessionDate,
        reviewId, fetchReceiptId, fetchReceiptHash: proof.receiptHash, cacheKey } })));
    if (!projection.length) throw new Error('invalid_source_selection');
    return { report, projection, proof, cacheKey, reviewId };
}

/** 第一份合法批次凍結勝出；中斷可續補相同 manifest，換來源／review 必須另立正式更正版本。 */
export async function freezeSourceSelection(options) {
    const { db, universeRevision, universe, provider, market, sessionDate, gate, switchReason = null,
        officialFailureReceiptIds = [], now = () => new Date(), signal } = options;
    if (!await sourceSelectionSchemaReady(db)) return { state: 'pending', reason: 'schema_pending' };
    if (typeof universeRevision !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(universeRevision)
        || !Array.isArray(officialFailureReceiptIds) || officialFailureReceiptIds.length > 18
        || new Set(officialFailureReceiptIds).size !== officialFailureReceiptIds.length) throw new Error('invalid_source_selection');
    gateReady(gate, sessionDate, now());
    const universeHash = await bollingerUniverseHash(universe);
    if (new Set(universe.map(s => s.code)).size !== universe.length) throw new Error('invalid_bollinger_universe');
    const priorRevision = (await db.prepare('SELECT manifest FROM screener_source_selections WHERE universe_revision=? LIMIT 801')
        .bind(universeRevision).all()).results ?? [];
    for (const record of priorRevision) {
        const { manifestHash, ...body } = JSON.parse(record.manifest);
        if (await hash(body) !== manifestHash) throw new Error('invalid_source_manifest');
        if (body.universeHash !== universeHash) throw new Error('invalid_universe_revision');
    }
    const selected = await verifiedProjection({ ...options, now: now() });
    if (provider === 'shioaji-daily-quotes') {
        if (!['official_contract_pending', 'official_source_failed', 'official_source_cooldown'].includes(switchReason))
            throw new Error('invalid_source_switch_reason');
        if (switchReason !== 'official_contract_pending' && !officialFailureReceiptIds.length) throw new Error('invalid_source_switch_reason');
    } else if (switchReason !== null || officialFailureReceiptIds.length) throw new Error('invalid_source_switch_reason');
    const failures = [];
    for (const id of [...officialFailureReceiptIds].sort()) {
        const proof = await receiptProof(db, 'screener_bollinger_receipts', id);
        if (!['failed', 'partial'].includes(proof.status) || proof.body.market !== market || proof.body.sessionDate !== sessionDate
            || !/^(?:source|invalid)_\w{1,80}$/.test(proof.body.reason ?? '')) throw new Error('invalid_source_failure_receipt');
        failures.push({ id, hash: proof.receiptHash, reason: proof.body.reason });
    }
    if (signal?.aborted) throw new Error('source_projection_aborted');
    await db.prepare(`INSERT INTO screener_source_universes(universe_revision,universe_hash,created_at) VALUES(?,?,?)
        ON CONFLICT(universe_revision) DO NOTHING`).bind(universeRevision, universeHash, now().toISOString()).run();
    const revisionIdentity = await db.prepare('SELECT universe_hash FROM screener_source_universes WHERE universe_revision=?')
        .bind(universeRevision).first();
    if (revisionIdentity?.universe_hash !== universeHash) throw new Error('invalid_universe_revision');
    const { report, projection, proof, cacheKey, reviewId } = selected;
    const body = { policyVersion: SOURCE_POLICY_VERSION, universeRevision, universeHash, market, sessionDate,
        authorityHash: gate.authorityHash, provider, reviewId, reviewHash: report.reviewHash, mappingVersion: report.mappingVersion,
        sourceUrl: report.sourceUrl, requestedDate: sessionDate, actualDate: report.sessionDate, payloadHash: report.payloadHash,
        fetchedAt: report.fetchedAt, cacheKey, fetchReceiptId: proof.id, fetchReceiptHash: proof.receiptHash,
        switchReason, officialFailures: failures, rowCount: projection.length, rowsHash: await hash(projection) };
    const manifestHash = await hash(body), manifest = { ...body, manifestHash };
    const key = await hash({ policyVersion: SOURCE_POLICY_VERSION, universeRevision, market, sessionDate });
    if (signal?.aborted) throw new Error('source_projection_aborted');
    await db.prepare(`INSERT INTO screener_source_selections(selection_key,manifest_hash,universe_revision,market,session_date,status,manifest,created_at)
        VALUES(?,?,?,?,?,'staging',?,?) ON CONFLICT(selection_key) DO NOTHING`)
        .bind(key, manifestHash, universeRevision, market, sessionDate, JSON.stringify(manifest), now().toISOString()).run();
    const saved = await db.prepare('SELECT manifest_hash FROM screener_source_selections WHERE selection_key=?').bind(key).first();
    if (saved?.manifest_hash !== manifestHash) throw new Error('source_selection_frozen');
    for (let offset = 0; offset < projection.length; offset += 50) {
        if (signal?.aborted) throw new Error('source_projection_aborted');
        gateReady(gate, sessionDate, now());
        await db.batch(projection.slice(offset, offset + 50).map(row => db.prepare(`INSERT INTO screener_source_selected_rows(selection_key,symbol,payload)
            SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM screener_source_selections WHERE selection_key=? AND manifest_hash=?)
            ON CONFLICT(selection_key,symbol) DO NOTHING`).bind(key, row.symbol, JSON.stringify(row), key, manifestHash)));
    }
    const frozen = await readSourceSelection(db, key, { allowStaging: true });
    if (frozen.manifest.rowsHash !== await hash(frozen.rows)) throw new Error('invalid_source_projection');
    if (signal?.aborted) throw new Error('source_projection_aborted');
    gateReady(gate, sessionDate, now());
    const currentReview = await readSourceReview(db, reviewId, now());
    reviewShape(provider, currentReview.review, null, now());
    await db.prepare("UPDATE screener_source_selections SET status='complete' WHERE selection_key=? AND manifest_hash=? AND status='staging'")
        .bind(key, manifestHash).run();
    return { state: 'complete', ...await readSourceSelection(db, key) };
}
export async function readSourceSelection(db, key, { allowStaging = false } = {}) {
    const saved = await db.prepare('SELECT * FROM screener_source_selections WHERE selection_key=?').bind(key).first();
    if (!saved) return null;
    if (!allowStaging && saved.status !== 'complete') throw new Error('source_selection_pending');
    const manifest = JSON.parse(saved.manifest), { manifestHash, ...body } = manifest;
    if (await hash(body) !== saved.manifest_hash || manifestHash !== saved.manifest_hash
        || saved.universe_revision !== manifest.universeRevision || saved.market !== manifest.market || saved.session_date !== manifest.sessionDate
        || manifest.policyVersion !== SOURCE_POLICY_VERSION || key !== await hash({ policyVersion: SOURCE_POLICY_VERSION,
            universeRevision: manifest.universeRevision, market: manifest.market, sessionDate: manifest.sessionDate })) throw new Error('invalid_source_manifest');
    const identity = await db.prepare('SELECT universe_hash FROM screener_source_universes WHERE universe_revision=?')
        .bind(manifest.universeRevision).first();
    if (identity?.universe_hash !== manifest.universeHash) throw new Error('invalid_universe_revision');
    const rows = (await db.prepare('SELECT symbol,payload FROM screener_source_selected_rows WHERE selection_key=? ORDER BY symbol LIMIT 10001')
        .bind(key).all()).results ?? [];
    const parsed = rows.map(r => JSON.parse(r.payload));
    if (rows.length !== manifest.rowCount || parsed.some((r, i) => r.symbol !== rows[i].symbol || r.market !== manifest.market
        || r.sessionDate !== manifest.sessionDate || r.provenance?.provider !== manifest.provider || r.provenance?.payloadHash !== manifest.payloadHash)
        || await hash(parsed) !== manifest.rowsHash) throw new Error('invalid_source_projection');
    return { key, manifest, rows: parsed, dataMappingVersion: `${SOURCE_POLICY_VERSION}:${manifestHash}` };
}

/** 全窗口的 mapping 固定來源選擇順序／hash，不能沿用官方舊 mapping 或舊 cursor。 */
export async function sourceWindowMapping(db, { universeRevision, universeHash, sessions, markets = ['TWSE', 'TPEx'] }) {
    if (!Array.isArray(sessions) || !sessions.length || sessions.length > 400 || sessions.some(d => !validBollingerDate(d))
        || sessions.some((d, i) => i > 0 && d <= sessions[i - 1]) || !HASH.test(universeHash ?? '')
        || !Array.isArray(markets) || markets.length !== 2 || !markets.includes('TWSE') || !markets.includes('TPEx')) throw new Error('invalid_source_window');
    /** @type {import('../src/lib/stock-screener-source-evidence.ts').BollingerSourceEvidence['manifest']['entries']} */
    const entries = [];
    for (const sessionDate of sessions) for (const market of ['TWSE', 'TPEx']) {
        const key = await hash({ policyVersion: SOURCE_POLICY_VERSION, universeRevision, market, sessionDate });
        const frozen = await readSourceSelection(db, key);
        if (!frozen) throw new Error('source_selection_pending');
        if (frozen.manifest.universeHash !== universeHash) throw new Error('invalid_universe_revision');
        entries.push({ sessionDate, market, manifestHash: frozen.manifest.manifestHash });
    }
    const manifest = { policyVersion: SOURCE_POLICY_VERSION, universeRevision, universeHash, entries };
    const manifestHash = await hash(manifest);
    return { manifest, manifestHash, dataMappingVersion: `${SOURCE_POLICY_VERSION}:${manifestHash}` };
}
function comparisonValue(row) {
    const bar = row.bar;
    return { readiness: row.readiness, sourceAmounts: row.sourceValues ? {
        volumeShares: row.sourceValues.volumeShares, turnoverNtd: row.sourceValues.turnoverNtd } : null,
        bar: bar ? { sessionDate: bar.sessionDate,
        ...Object.fromEntries(['open', 'high', 'low', 'close'].map(k => [k, canonicalPriceUnits(bar[k])?.toString() ?? null])),
        volumeShares: bar.volumeShares, turnoverNtd: bar.turnoverNtd } : null };
}
export async function compareRestoredOfficialSource(options) {
    const { db, selectionKey, now = () => new Date() } = options;
    const comparisonPolicy = options.comparisonPolicy ?? BOLLINGER_SOURCE_COMPARISON_POLICY;
    if (![BOLLINGER_SOURCE_COMPARISON_POLICY,BOLLINGER_SOURCE_AMOUNT_COMPARISON_POLICY]
        .some(p=>JSON.stringify(p)===JSON.stringify(comparisonPolicy))) throw new Error('invalid_source_comparison_policy');
    const frozen = await readSourceSelection(db, selectionKey);
    if (!frozen || frozen.manifest.provider !== 'shioaji-daily-quotes') throw new Error('invalid_source_comparison');
    const provider = frozen.manifest.market === 'TWSE' ? 'official-twse' : 'official-tpex';
    if (options.provider !== provider || options.market !== frozen.manifest.market || options.sessionDate !== frozen.manifest.sessionDate
        || await bollingerUniverseHash(options.universe) !== frozen.manifest.universeHash) throw new Error('invalid_source_comparison');
    const candidate = await verifiedProjection({ ...options, now: now() });
    const bySymbol = new Map(candidate.projection.map(r => [r.symbol, r]));
    const differences = frozen.rows.flatMap(row => {
        const before = comparisonValue(row), official = comparisonValue(bySymbol.get(row.symbol));
        const assessment = assessSourceComparison(before, official, comparisonPolicy);
        return assessment.verdict === 'exact' ? [] : [{ symbol: row.symbol, frozen: before, official, ...assessment }];
    });
    const payload = { policyVersion: SOURCE_POLICY_VERSION, selectionKey, frozenManifestHash: frozen.manifest.manifestHash,
        provider, reviewId: candidate.reviewId, payloadHash: candidate.report.payloadHash,
        fetchReceiptId: candidate.proof.id, fetchReceiptHash: candidate.proof.receiptHash,
        comparisonPolicy, differences };
    const id = await hash(payload), status = differences.some(d => d.verdict === 'conflict') ? 'conflict' : 'matched';
    await db.prepare(`INSERT INTO screener_source_comparisons(id,selection_key,status,payload,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
        .bind(id, selectionKey, status, JSON.stringify(payload), now().toISOString()).run();
    return { id, status, ...payload };
}
