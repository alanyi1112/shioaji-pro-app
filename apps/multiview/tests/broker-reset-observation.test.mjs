import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recordBrokerResetObservation, readBrokerResetObservation,
    findPreviousBrokerResetObservation }
    from '../../../scripts/broker-reset-observation.mjs';

async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'broker-reset-observation-'));
    await mkdir(path.join(root, 'IntradayMonitor'), { mode: 0o700 });
    await writeFile(path.join(root, 'runtime-mode'), 'simulation\n', { mode: 0o600 });
    await writeFile(path.join(root, 'runtime-api-generation'), 'simulation:fixture-001\n', { mode: 0o600 });
    return realpath(root);
}
const reply = (endpoint, account = '1234567') => {
    if (endpoint.endsWith('/info')) return { simulation: true };
    if (endpoint.endsWith('/health')) return { status: 'healthy' };
    if (endpoint.endsWith('/auth/accounts')) return [{ signed: true, account_type: 'S',
        broker_id: '0001', account_id: account }];
    if (endpoint.endsWith('/auth/usage')) return { bytes: 1000,
        remaining_bytes: 9000, limit_bytes: 10000 };
    throw new Error('unexpected endpoint');
};
test('唯讀 API 後私密保留來源計數，帳號原值及 HMAC key 不出現在收據', async () => {
    const root = await fixture();
    try {
        const now = () => new Date('2026-10-05T12:00:00Z');
        const fetchImpl = async url => Response.json(reply(url));
        const first = await recordBrokerResetObservation({ root, fetchImpl, now });
        const second = await recordBrokerResetObservation({ root, fetchImpl, now });
        assert.equal(first.admissionAuthority, false);
        assert.equal(first.rawAccountIdentifiersPersisted, false);
        assert.notEqual(first.evidenceHash, '');
        const folder = path.join(root, 'IntradayMonitor', 'broker-quota-reset-observations');
        const files = await readdir(folder);
        assert.equal(files.length, 2);
        for (const name of files) {
            const file = path.join(folder, name);
            const source = await readFile(file, 'utf8');
            const evidence = JSON.parse(source);
            assert.equal(evidence.usedBytes, 1000);
            assert.equal(evidence.accountScopeHash.length, 64);
            assert.equal(source.includes('1234567'), false);
            assert.equal((await stat(file)).mode & 0o077, 0);
        }
        assert.equal((await stat(path.join(root, 'IntradayMonitor',
            'broker-quota-account-hmac.key'))).mode & 0o077, 0);
        assert.equal(second.evidenceHash, first.evidenceHash);
        const recovered = await readBrokerResetObservation({ root, evidenceHash: first.evidenceHash });
        assert.equal(recovered.usedBytes, 1000);
        assert.equal(recovered.admissionAuthority, false);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('正式模式或錯誤用量不產生可用證據', async () => {
    const root = await fixture();
    try {
        const fetchImpl = async url => Response.json(reply(url));
        await writeFile(path.join(root, 'runtime-mode'), 'production\n', { mode: 0o600 });
        await assert.rejects(recordBrokerResetObservation({ root, fetchImpl }),
            /broker_reset_simulation_unverified/);
        await writeFile(path.join(root, 'runtime-mode'), 'simulation\n', { mode: 0o600 });
        await assert.rejects(recordBrokerResetObservation({ root,
            fetchImpl: async url => Response.json(url.endsWith('/auth/usage')
                ? { bytes: 1000, remaining_bytes: 9001, limit_bytes: 10000 } : reply(url)) }),
        /broker_reset_source_unverified/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('跨日排程只挑前一官方交易日且 08:00 前的最新已驗證錨點', async () => {
    const root = await fixture();
    try {
        const fetchImpl = async url => Response.json(reply(url));
        await recordBrokerResetObservation({ root, fetchImpl,
            now: () => new Date('2026-10-05T11:00:00Z') });
        const latest = await recordBrokerResetObservation({ root, fetchImpl,
            now: () => new Date('2026-10-05T12:00:00Z') });
        await recordBrokerResetObservation({ root, fetchImpl,
            now: () => new Date('2026-10-06T00:05:00Z') });
        const selected = await findPreviousBrokerResetObservation({ root,
            previousTradeDate: '2026-10-05',
            resetAt: new Date('2026-10-06T08:00:00+08:00') });
        assert.equal(selected.evidenceHash, latest.evidenceHash);
        assert.equal(await findPreviousBrokerResetObservation({ root,
            previousTradeDate: '2026-10-04',
            resetAt: new Date('2026-10-06T08:00:00+08:00') }), null);
    } finally { await rm(root, { recursive: true, force: true }); }
});
