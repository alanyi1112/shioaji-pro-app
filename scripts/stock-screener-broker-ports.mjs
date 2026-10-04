/** 既有 simulation runtime 唯讀 Gate；政策／承諾／quota epoch 未完成驗證時不啟用備援。 */
import { readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createBrokerBandwidthAdmission } from './broker-bandwidth-reservations.mjs';
import { readScreenerBrokerCommitments } from './stock-screener-broker-commitments.mjs';
import { readLocalConservativeIdentity, localConservativeUsage } from './broker-local-conservative-ledger.mjs';
import { observeRuntimeBudgetAllocations } from './stock-screener-runtime-budget-producer.mjs';

async function readPrivate(root, name) {
    const file = path.join(root, name), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0
        || info.size < 1 || info.size > 256 || await realpath(file) !== file) throw new Error('simulation_runtime_pending');
    return (await readFile(file, 'utf8')).trim();
}
async function boundedJson(fetchImpl, endpoint, body) {
    const response = await fetchImpl(`http://127.0.0.1:8080/api/v1/${endpoint}`, {
        redirect: 'error', signal: AbortSignal.timeout(5000),
        ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (!response.ok || !response.body) throw new Error('simulation_session_pending');
    const reader = response.body.getReader(), parts = []; let size = 0;
    try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length;
        if (size > 65536) throw new Error('simulation_response_size'); parts.push(Buffer.from(r.value)); }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export function createScreenerBrokerPorts({ db, now = () => new Date(), fetchImpl = fetch,
    root = process.env.REALTIME_STOCK_APP_SUPPORT ?? path.join(homedir(), 'Library/Application Support/RealTimeStock') }) {
    const safety = async () => {
        const directory = await lstat(root);
        if (!path.isAbsolute(root) || directory.isSymbolicLink() || !directory.isDirectory() || directory.uid !== process.getuid()
            || directory.mode & 0o077 || await realpath(root) !== root) throw new Error('simulation_runtime_pending');
        const generation = await readPrivate(root, 'runtime-api-generation'), mode = await readPrivate(root, 'runtime-mode');
        if (mode !== 'simulation' || !/^simulation:[A-Za-z0-9._:-]{1,180}$/.test(generation)) throw new Error('simulation_runtime_pending');
        const info = await boundedJson(fetchImpl, 'info'), health = await boundedJson(fetchImpl, 'health');
        const snapshots = await boundedJson(fetchImpl, 'data/snapshots', { contracts: [{ security_type: 'STK', region: 'TW',
            exchange: 'TSE', code: '2330', target_code: null }] });
        if (info.simulation !== true || health.status !== 'healthy' || !Array.isArray(snapshots) || snapshots.length !== 1
            || snapshots[0].code !== '2330' || !Number.isFinite(snapshots[0].close) || snapshots[0].close <= 0
            || await readPrivate(root, 'runtime-api-generation') !== generation || await readPrivate(root, 'runtime-mode') !== mode)
            throw new Error('simulation_session_pending');
        return { simulation: true, businessSessionEstablished: true, generation, observedAt: now().toISOString() };
    };
    const policyRecord = async () => {
        const row = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-bollinger-broker-budget-policy'").first();
        if (row?.status !== 'verified') throw new Error('broker_policy_pending');
        const record = JSON.parse(row.checkpoint);
        if (![1, 2, 3].includes(record.version) || typeof record.scope !== 'string' || !/^[a-f0-9]{64}$/.test(record.scope)
            || typeof record.quotaEpoch !== 'string' || !/^[a-f0-9]{64}$/.test(record.quotaEpochEvidenceHash ?? '')
            || !(record.version === 3 ? record.quotaEpochVerified === false && record.identityMode === 'local-conservative-v1'
                : record.quotaEpochVerified === true) || !Number.isFinite(Date.parse(record.validThrough))
            || Date.parse(record.validThrough) <= now().getTime()) throw new Error('broker_policy_pending');
        if (record.version === 3) {
            const anchor = await readLocalConservativeIdentity(db);
            if (anchor.scope !== record.scope || anchor.quotaEpoch !== record.quotaEpoch
                || anchor.quotaEpochEvidenceHash !== record.quotaEpochEvidenceHash) throw new Error('broker_policy_pending');
        }
        return record;
    };
    const readUsage = async () => {
        const policy = await policyRecord(), before = await safety();
        const u = await boundedJson(fetchImpl, 'auth/usage');
        if (await readPrivate(root, 'runtime-api-generation') !== before.generation) throw new Error('broker_generation_changed');
        if (policy.version === 3) return localConservativeUsage(db, await readLocalConservativeIdentity(db), {
            generation: before.generation, usedBytes: u.bytes, limitBytes: u.limit_bytes,
            remainingBytes: u.remaining_bytes, observedAt: now().toISOString() });
        return { scope: policy.scope, quotaEpoch: policy.quotaEpoch, quotaEpochEvidenceHash: policy.quotaEpochEvidenceHash,
            quotaEpochVerified: true, generation: before.generation, usedBytes: u.bytes, limitBytes: u.limit_bytes,
            remainingBytes: u.remaining_bytes, observedAt: now().toISOString() };
    };
    // 校準只讀真實計數；不把本機配置宣稱為來源提供的 quota epoch，也不授予正式下載。
    const observeUsage = async () => {
        const before = await safety(), u = await boundedJson(fetchImpl, 'auth/usage');
        if (await readPrivate(root, 'runtime-api-generation') !== before.generation) throw new Error('broker_generation_changed');
        if (![u.bytes, u.limit_bytes, u.remaining_bytes].every(Number.isSafeInteger)
            || u.bytes < 0 || u.limit_bytes <= 0 || u.remaining_bytes < 0 || u.bytes + u.remaining_bytes !== u.limit_bytes)
            throw new Error('broker_usage_pending');
        return { generation: before.generation, usedBytes: u.bytes, limitBytes: u.limit_bytes,
            remainingBytes: u.remaining_bytes, observedAt: now().toISOString() };
    };
    return { safety, observeUsage, admission: createBrokerBandwidthAdmission({ db, now, readUsage,
        readPolicy: async () => {
            const record = await policyRecord();
            if (record.version === 3 && record.consumerObservationMode != null)
                await observeRuntimeBudgetAllocations({ db, record, root, now: now() });
            // 額度條款須綁定同一帳戶 scope／quota 證據。查詢 usage 時換 record
            // 不能拿新週期放行、漏扣原保留；不以 API generation 冒充 quota reset。
            const budgetPolicy = record.version >= 2 ? await readScreenerBrokerCommitments(db, record, now()) : record.budgetPolicy;
            return { ...budgetPolicy, quotaIdentity: { scope: record.scope,
                quotaEpoch: record.quotaEpoch, quotaEpochEvidenceHash: record.quotaEpochEvidenceHash,
                ...(record.version === 3 ? { identityMode: record.identityMode } : {}) } };
        } }) };
}
