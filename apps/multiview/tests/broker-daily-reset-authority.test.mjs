import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recordBrokerResetObservation } from '../../../scripts/broker-reset-observation.mjs';
import { buildBrokerDailyResetWitnessFromSavedEvidence }
    from '../../../scripts/broker-daily-reset-authority.mjs';
import { saveDailyCalendarCache } from '../../../scripts/intraday-monitor-runtime/daily-calendar-cache.mjs';
import { buildOfficialMarketCalendarSnapshot, parseTwseOfficialCalendar, parseTpexOfficialCalendar }
    from '../../../scripts/smart-order-runtime/official-market-calendar-core.mjs';

test('私密來源錨點加正式雙市場日曆只形成候選；帳戶切換拒絕', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'broker-reset-authority-')));
    try {
        await chmod(root, 0o700);
        await mkdir(path.join(root, 'IntradayMonitor'), { mode: 0o700 });
        await writeFile(path.join(root, 'runtime-mode'), 'simulation', { mode: 0o600 });
        await writeFile(path.join(root, 'runtime-api-generation'), 'simulation:fixture', { mode: 0o600 });
        const fake = (bytes, accountId) => async url => {
            const endpoint = url.split('/api/v1/')[1];
            return Response.json(endpoint === 'info' ? { simulation: true }
                : endpoint === 'health' ? { status: 'healthy' }
                    : endpoint === 'auth/accounts' ? [{ signed: true, account_type: 'S',
                        broker_id: '0001', account_id: accountId }]
                        : { bytes, limit_bytes: 524288000,
                            remaining_bytes: 524288000 - bytes });
        };
        const before = await recordBrokerResetObservation({ root,
            fetchImpl: fake(70000000, '1234567'),
            now: () => new Date('2026-10-05T12:11:46Z') });
        const after = await recordBrokerResetObservation({ root,
            fetchImpl: fake(1000000, '1234567'),
            now: () => new Date('2026-10-06T00:01:00Z') });
        const folder = path.join(root, 'intraday-baselines',
            '2026-10-05-for-2026-10-06-verified');
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const artifact = path.join(folder, 'baseline-set.json');
        await writeFile(artifact, '{"fixture":"validated upstream"}\n', { mode: 0o600 });
        const resolveTradingDay = async () => ({ current: true, isTradingDate: true,
            tradeDate: '2026-10-06', previousTradeDate: '2026-10-05', authorityKind: 'verified_postclose_local_snapshot',
            sourceVersions: ['official-fixture-version'],
            verifiedArtifactPath: artifact, observedAt: '2026-10-06T00:01:10Z' });
        const options = { root, beforeEvidenceHash: before.evidenceHash,
            afterEvidenceHash: after.evidenceHash,
            now: new Date('2026-10-06T00:01:20Z'), resolveTradingDay };
        const result = await buildBrokerDailyResetWitnessFromSavedEvidence(options);
        assert.equal(result.witness.state, 'candidate');
        assert.equal(result.witness.authorizesAdmission, false);
        assert.equal(result.admissionAuthority, false);
        const twse = { stat: 'ok', queryYear: 2026, fields: ['日期', '名稱', '說明'],
            data: [['2026-01-01', '元旦', '依規定放假1日。'], ['2026-01-02', '國曆新年開始交易日', '國曆新年開始交易。']] };
        const tpex = { data: { html: '<table class="page-table"><tr><td>中華民國115年有價證券櫃檯買賣市場開（休）市日期表</td></tr></table><table class="page-table"><tr><th>紀念節日名稱</th><th>日期</th><th>星期</th><th>說明</th></tr><tr><td>中華民國開國紀念日</td><td>1月1日</td><td>四</td><td>依規定放假1日。</td></tr><tr><td>國曆新年開始交易日</td><td>1月2日</td><td>五</td><td>國曆新年開始交易。</td></tr></table>' } };
        const fetchedAt = '2026-10-06T00:01:00Z';
        const snapshot = buildOfficialMarketCalendarSnapshot({ twse: parseTwseOfficialCalendar(twse, 2026),
            tpex: parseTpexOfficialCalendar(tpex, 2026), fetchedAtEpochMs: Date.parse(fetchedAt) });
        await saveDailyCalendarCache({ root, trigger: 'operator-repair', fetchedAt,
            calendar: { tradeDate: '2026-10-05', targetTradeDate: '2026-10-06', twse, tpex,
                calendarSourceVersion: snapshot.calendarVersion } });
        const { resolveTradingDay: _fixture, ...realResolverOptions } = options;
        const cacheResult = await buildBrokerDailyResetWitnessFromSavedEvidence(realResolverOptions);
        assert.equal(cacheResult.authorityKind, 'verified_daily_official_calendar_cache');
        assert.equal(cacheResult.witness.state, 'candidate');
        assert.equal(cacheResult.admissionAuthority, false);
        const changed = await recordBrokerResetObservation({ root,
            fetchImpl: fake(1000000, '9999999'),
            now: () => new Date('2026-10-06T00:01:01Z') });
        await assert.rejects(buildBrokerDailyResetWitnessFromSavedEvidence({ ...options,
            afterEvidenceHash: changed.evidenceHash }), /broker_daily_reset_account_scope_changed/);
        await assert.rejects(buildBrokerDailyResetWitnessFromSavedEvidence({ ...options,
            resolveTradingDay: async () => ({ ...(await resolveTradingDay()),
                isTradingDate: false }) }), /broker_daily_reset_official_session_unverified/);
    } finally { await rm(root, { recursive: true, force: true }); }
});
