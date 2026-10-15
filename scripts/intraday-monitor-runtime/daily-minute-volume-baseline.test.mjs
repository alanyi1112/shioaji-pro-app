import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expectedTaiwanRegularSessionMinutes, hashHistoricalKbarValue } from './historical-kbar-repair.mjs';
import { DAILY_MINUTE_VOLUME_CANDIDATE_SCHEMA, DAILY_KBAR_TIMESTAMP_ENCODING,
    computeDailyMinuteVolumePayloadHash, verifyDailyMinuteVolumeBaseline,
    isDailyMinuteVolumeBaseline, resolveDailyMinuteVolumeBaseline,
    createDailyMinuteVolumeCandidate } from './daily-minute-volume-baseline.mjs';
import { DailyMinuteVolumeRepository, readDailyMinuteVolumeQuality }
    from './daily-minute-volume-repository.mjs';

function fixture() {
    const minutes = expectedTaiwanRegularSessionMinutes();
    const candidate = { schemaVersion: DAILY_MINUTE_VOLUME_CANDIDATE_SCHEMA,
        symbol: '2330.TW', exchange: 'TSE', securityType: 'STK', tradeDate: '2026-10-05',
        timeZone: 'Asia/Taipei', source: 'fixture-only', sourceVersion: 'fixture-only/1',
        fetchedAt: '2026-10-05T14:00:00+08:00', sourceUnit: 'common_lot',
        canonicalUnit: 'common_lot', volumeSemantics: 'minute_delta',
        timestampEncoding: DAILY_KBAR_TIMESTAMP_ENCODING, closeEncoding: 'normal_13_30',
        arrays: { datetime: minutes.map(m => `2026-10-05T${m}:00+08:00`),
            ...Object.fromEntries(['Open','High','Low','Close'].map(k => [k, minutes.map(() => 10)])),
            Volume: minutes.map(() => 2), Amount: minutes.map(() => 20000) } };
    const authority = { officialTradingDay: true, identityVerified: true,
        instrumentStatus: 'normal', calendarVerified: true,
        symbol: candidate.symbol, exchange: candidate.exchange, securityType: 'STK',
        timeZone: 'Asia/Taipei', tradeDate: candidate.tradeDate,
        previousApplicableTradeDate: candidate.tradeDate, targetTradeDate: '2026-10-06',
        calendarSource: 'fixture-only', calendarSourceVersion: 'fixture-only/1' };
    return { candidate, authority, now: '2026-10-05T14:02:00+08:00' };
}
function verify(input) {
    input.candidate.payloadHash = computeDailyMinuteVolumePayloadHash(input.candidate);
    return verifyDailyMinuteVolumeBaseline(input);
}
function total(input, volume = 540) {
    return { status: 'verified', sessionScope: 'regular_session', unit: 'common_lot',
        volumeCommonLot: volume, symbol: input.candidate.symbol, exchange: input.candidate.exchange,
        tradeDate: input.candidate.tradeDate, source: 'fixture-only-ticks', sourceVersion: 'fixture-only/1' };
}
test('single payload qualifies only for v2, no fake refetch or independent total', () => {
    const result = verify(fixture());
    assert.equal(result.ok, true);
    assert.equal(isDailyMinuteVolumeBaseline(result.manifest), true);
    assert.equal(result.manifest.cumulativeSeries.at(-1).cumulativeVolume, 540);
    assert.deepEqual(result.manifest.validationChecks, { sourceStructure: 'verified',
        closeTotalCheck: 'not_observed', independentReconciliation: false, refetchCheck: 'not_requested' });
    assert.equal(Object.hasOwn(result.manifest, 'refetchTime'), false);
    assert.equal(result.liveCaptureAcceptance, false);
    assert.equal(result.notificationEligible, false);
});
for (const [name, mutate, reason] of [
    ['unknown unit', i => { i.candidate.sourceUnit = 'unknown'; }, 'unknown_volume_unit'],
    ['unknown encoding', i => { i.candidate.timestampEncoding = 'unknown'; }, 'timestamp_encoding_unverified'],
    ['unknown calendar', i => { i.authority.calendarVerified = false; }, 'calendar_or_instrument_authority_unverified'],
    ['official closure', i => { i.authority.officialTradingDay = false; }, 'calendar_or_instrument_authority_unverified'],
    ['wrong symbol', i => { i.authority.symbol = '2449.TW'; }, 'calendar_or_instrument_authority_unverified'],
    ['non adjacent date', i => { i.authority.previousApplicableTradeDate = '2026-10-02'; }, 'calendar_or_instrument_authority_unverified'],
    ['not finalized', i => { i.candidate.fetchedAt = '2026-10-05T13:30:00+08:00'; }, 'session_not_finalized'],
    ['future fetch', i => { i.candidate.fetchedAt = '2026-10-05T14:10:00+08:00'; }, 'future_fetch_time'],
    ['duplicate minute', i => { i.candidate.arrays.datetime[1] = i.candidate.arrays.datetime[0]; }, 'duplicate_minute'],
    ['09:00 outside completed-minute encoding', i => { i.candidate.arrays.datetime[0] = '2026-10-05T09:00:00+08:00'; }, 'outside_regular_session'],
    ['post-close row without delayed-close declaration', i => { i.candidate.arrays.datetime.push('2026-10-05T13:33:00+08:00');
        for (const field of ['Open','High','Low','Close']) i.candidate.arrays[field].push(10);
        i.candidate.arrays.Volume.push(1); i.candidate.arrays.Amount.push(10000); }, 'unexpected_delayed_close_row'],
    ['delayed-close declaration without 13:33 row', i => { i.candidate.closeEncoding = 'delayed_13_33'; }, 'missing_delayed_close_row'],
    ['cross date', i => { i.candidate.arrays.datetime[0] = '2026-10-02T09:01:00+08:00'; }, 'outside_regular_session'],
    ['negative volume', i => { i.candidate.arrays.Volume[0] = -1; }, 'invalid_volume'],
    ['unequal fields', i => { i.candidate.arrays.Amount.pop(); }, 'invalid_kbar_structure'],
    ['overflow', i => { i.candidate.arrays.Volume.fill(Number.MAX_SAFE_INTEGER); }, 'cumulative_volume_overflow'],
    ['cumulative regression', i => { i.candidate.volumeSemantics = 'cumulative'; i.candidate.arrays.Volume[1] = 1; }, 'cumulative_volume_regression'],
]) test(`rejects ${name}`, () => {
    const input = fixture(); mutate(input);
    assert.ok(verify(input).reasonCodes.includes(reason));
});
test('known total must match, invalid authority cannot become not_observed', () => {
    const input = fixture(); input.finalVolumeAuthority = total(input, 541);
    assert.ok(verify(input).reasonCodes.includes('final_volume_mismatch'));
    input.finalVolumeAuthority.sessionScope = 'all_sessions';
    assert.ok(verify(input).reasonCodes.includes('final_volume_authority_unverified'));
});
test('missing minute cannot be filled without proof; known-zero reconciles', () => {
    const input = fixture();
    for (const array of Object.values(input.candidate.arrays)) array.splice(4, 1);
    assert.ok(verify(input).reasonCodes.includes('missing_minute_without_zero_proof'));
    input.candidate.knownZeroMinutes = ['09:05'];
    assert.ok(verify(input).reasonCodes.includes('missing_minute_zero_not_reconciled'));
    input.finalVolumeAuthority = total(input, 538);
    const result = verify(input);
    assert.equal(result.ok, true);
    assert.equal(isDailyMinuteVolumeBaseline(result.manifest), true);
    assert.equal(result.manifest.minuteCoverage.knownZeroCarryForwardCount, 1);
});
test('delayed 13:33 merges into canonical 13:30 only', () => {
    const input = fixture(); input.candidate.closeEncoding = 'delayed_13_33';
    const arrays = input.candidate.arrays;
    arrays.datetime.push('2026-10-05T13:33:00+08:00');
    for (const field of ['Open','High','Low','Close']) arrays[field].push(10);
    arrays.Volume.push(3); arrays.Amount.push(30000);
    const result = verify(input);
    assert.equal(result.ok, true);
    assert.equal(result.manifest.closeMode, 'delayed_13_33');
    assert.equal(result.manifest.cumulativeSeries.length, 270);
    assert.equal(result.manifest.cumulativeSeries.at(-1).cumulativeVolume, 543);
});
test('parser rejects tampered, legacy schema and fabricated quality', () => {
    const good = verify(fixture()).manifest;
    for (const mutate of [v => { v.cumulativeSeries[0].cumulativeVolume = 3; },
        v => { v.schemaVersion = 'intraday-historical-kbar-baseline-manifest/1'; },
        v => { v.validationChecks.independentReconciliation = true; }]) {
        const value = structuredClone(good); mutate(value);
        assert.equal(isDailyMinuteVolumeBaseline(value), false);
    }
});
test('source adapter requires fresh exact contract and explicit encoding', () => {
    const input = fixture(); const contract = { code: '2330', exchange: 'TSE', security_type: 'STK',
        region: 'TW', unit: 1000, trading_suspended: false, update_date: '2026-10-05' };
    const data = structuredClone(input.candidate.arrays); data.datetime = data.datetime.map(t => t.slice(0,19));
    const options = { entry: { canonicalSymbol: '2330.TW', contractIdentity: contract }, contract,
        kbars: { data, fetchedAt: input.candidate.fetchedAt }, tradeDate: '2026-10-05',
        sourceVersion: 'fixture-only/1', timestampEncoding: DAILY_KBAR_TIMESTAMP_ENCODING };
    input.candidate = createDailyMinuteVolumeCandidate(options);
    assert.equal(verifyDailyMinuteVolumeBaseline(input).ok, true);
    assert.throws(() => createDailyMinuteVolumeCandidate({ ...options, timestampEncoding: 'guess' }));
    assert.throws(() => createDailyMinuteVolumeCandidate({ ...options, contract: { ...contract, unit: 1 } }));
});
test('repository atomic insert/no-op/CAS/conflict persists through reopen', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-baseline-test-'));
    const file = path.join(root, 'baseline.sqlite3');
    let repository;
    try {
        repository = new DailyMinuteVolumeRepository(file);
        const first = verify(fixture()).manifest;
        assert.equal(repository.putManifest(first, 0).revision, 1);
        assert.equal(repository.putManifest(structuredClone(first), 0).alreadyPresent, true);
        const conflictInput = fixture(); conflictInput.candidate.arrays.Volume[0] = 3;
        assert.throws(() => repository.putManifest(verify(conflictInput).manifest, 1), /source_conflict/);
        assert.equal(repository.conflicts().length, 1);
        assert.equal(repository.currentRevision(), 1);
        assert.deepEqual(repository.latestForSymbolDate('2330.TW','TSE','2026-10-05','2026-10-06'), first);
        const secondInput = fixture(); secondInput.candidate.symbol = '2449.TW'; secondInput.authority.symbol = '2449.TW';
        const second = verify(secondInput).manifest;
        assert.throws(() => repository.putManifest(second, 0), /revision_conflict/);
        repository.putManifest(second, 1);
        repository.close(); repository = new DailyMinuteVolumeRepository(file);
        assert.equal(repository.currentRevision(), 2);
        assert.equal(repository.listForTargetTradeDate('2026-10-06').length, 2);
        assert.equal(repository.conflicts().length, 1);
    } finally { repository?.close(); rmSync(root, { recursive: true, force: true }); }
});
test('resolver exact identity, v2 preference and conflict refusal', () => {
    const manifest = verify(fixture()).manifest;
    const query = { symbol: '2330.TW', exchange: 'TSE', sourceTradeDate: '2026-10-05', targetTradeDate: '2026-10-06' };
    assert.equal(resolveDailyMinuteVolumeBaseline({ ...query, v2: [manifest] }).manifest, manifest);
    assert.equal(resolveDailyMinuteVolumeBaseline({ ...query, targetTradeDate: '2026-10-07', v2: [manifest] }).state, 'waiting_baseline');
    const tampered = structuredClone(manifest); tampered.cumulativeSeries[0].cumulativeVolume++;
    assert.equal(resolveDailyMinuteVolumeBaseline({ ...query, v2: [manifest,tampered] }).reason, 'baseline_invalid');
    const other = fixture(); other.candidate.arrays.Volume[0] = 3;
    assert.equal(resolveDailyMinuteVolumeBaseline({ ...query, v2: [manifest,verify(other).manifest] }).reason, 'baseline_source_conflict');
    const forged = structuredClone(manifest); forged.notificationEligible = true;
    const { manifestId, ...body } = forged; forged.manifestId = hashHistoricalKbarValue(body);
    assert.equal(isDailyMinuteVolumeBaseline(forged), false);
});

test('read-only quality separates matched, not observed and missing without creating a database', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'daily-quality-test-'));
    const file = path.join(root, 'baseline.sqlite3');
    const input = { databasePath: file, sourceTradeDate: '2026-10-05',
        targetTradeDate: '2026-10-06', symbols: ['2330.TW', '2449.TW', '2317.TW'] };
    try {
        assert.deepEqual(readDailyMinuteVolumeQuality(input), {
            sourceTradeDate: input.sourceTradeDate, targetTradeDate: input.targetTradeDate,
            expectedCount: 3, readyCount: 0, independentMatchedCount: 0,
            independentNotObservedCount: 0, missingCount: 3, unknownCount: 0,
            state: 'unavailable' });
        assert.equal(existsSync(file), false);
        const repository = new DailyMinuteVolumeRepository(file);
        try {
            repository.putManifest(verify(fixture()).manifest, 0);
            const matched = fixture(); matched.candidate.symbol = '2449.TW';
            matched.authority.symbol = '2449.TW';
            matched.finalVolumeAuthority = total(matched);
            repository.putManifest(verify(matched).manifest, 1);
        } finally { repository.close(); }
        assert.deepEqual(readDailyMinuteVolumeQuality(input), {
            sourceTradeDate: input.sourceTradeDate, targetTradeDate: input.targetTradeDate,
            expectedCount: 3, readyCount: 2, independentMatchedCount: 1,
            independentNotObservedCount: 1, missingCount: 1, unknownCount: 0,
            state: 'repository_recorded' });
    } finally { rmSync(root, { recursive: true, force: true }); }
});
