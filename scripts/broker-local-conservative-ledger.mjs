/** 本機持久保守身份，不是 broker quota reset 證明；無換日或 generation 清帳。 */
import { createHash, randomUUID } from 'node:crypto';

const ID = 'broker-local-conservative-anchor';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keys = ['version', 'identityMode', 'scope', 'quotaEpoch', 'createdAt', 'quotaEpochEvidenceHash'];
export async function readLocalConservativeIdentity(db) {
    const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(ID).first();
    let value;
    try { value = JSON.parse(row?.checkpoint); } catch { throw new Error('broker_local_identity_pending'); }
    const { quotaEpochEvidenceHash, ...proof } = value;
    if (row?.status !== 'verified' || Object.keys(value).length !== keys.length
        || Object.keys(value).some(k => !keys.includes(k)) || value.version !== 1
        || value.identityMode !== 'local-conservative-v1' || !/^[a-f0-9]{64}$/.test(value.scope ?? '')
        || !/^local:[a-f0-9-]{36}$/.test(value.quotaEpoch ?? '') || !Number.isFinite(Date.parse(value.createdAt))
        || hash(proof) !== quotaEpochEvidenceHash) throw new Error('broker_local_identity_pending');
    return { scope: value.scope, quotaEpoch: value.quotaEpoch, quotaEpochEvidenceHash, identityMode: value.identityMode };
}

/** 明確初始化一次。並行初始者只接受持久 head；不由政策換版／日期推導身份。 */
export async function initializeLocalConservativeIdentity(db, now = new Date()) {
    const proof = { version: 1, identityMode: 'local-conservative-v1', scope: hash({ localLedger: randomUUID() }),
        quotaEpoch: `local:${randomUUID()}`, createdAt: now.toISOString() };
    await db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        VALUES(?,'broker-local-anchor','verified',?,?) ON CONFLICT(id) DO NOTHING`)
        .bind(ID, JSON.stringify({ ...proof, quotaEpochEvidenceHash: hash(proof) }), now.toISOString()).run();
    return readLocalConservativeIdentity(db);
}

/** 全資料庫舊 scope／epoch 亦納入高水位，身份遷移不讓既有耗額消失。 */
export async function localConservativeUsage(db, identity, raw) {
    const anchor = await readLocalConservativeIdentity(db);
    if (JSON.stringify(anchor) !== JSON.stringify(identity)) throw new Error('broker_local_identity_pending');
    if (![raw.usedBytes, raw.limitBytes, raw.remainingBytes].every(n => Number.isSafeInteger(n) && n >= 0)
        || raw.limitBytes < 1 || raw.usedBytes + raw.remainingBytes !== raw.limitBytes
        || !Number.isFinite(Date.parse(raw.observedAt)) || !/^[a-zA-Z0-9:_|.-]{1,200}$/.test(raw.generation ?? ''))
        throw new Error('broker_usage_pending');
    const prior = await db.prepare('SELECT MAX(used_bytes) high,MIN(limit_bytes) lowLimit,MAX(limit_bytes) highLimit FROM broker_bandwidth_observations').first();
    if (prior?.highLimit != null && (prior.lowLimit !== raw.limitBytes || prior.highLimit !== raw.limitBytes))
        throw new Error('broker_limit_changed');
    const headId = `broker-local-counter:${identity.quotaEpochEvidenceHash}`;
    const head = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(headId).first();
    let previous = null;
    if (head) {
        try { previous = JSON.parse(head.checkpoint); } catch { throw new Error('broker_usage_pending'); }
        if (head.status !== 'verified' || previous.version !== 1 || Object.keys(previous).length !== 6
            || previous.identityHash !== identity.quotaEpochEvidenceHash
            || previous.limitBytes !== raw.limitBytes || !Number.isSafeInteger(previous.rawUsedBytes)
            || previous.rawUsedBytes < 0 || !Number.isSafeInteger(previous.conservativeUsedBytes)
            || previous.conservativeUsedBytes < 0 || previous.conservativeUsedBytes > raw.limitBytes
            || !Number.isFinite(Date.parse(previous.observedAt)) || Date.parse(raw.observedAt) < Date.parse(previous.observedAt))
            throw new Error('broker_usage_pending');
    }
    // 計數下降只開始下一段增量觀察，已累積消耗不歸零；新段增加亦累加。
    const usedBytes = previous ? Math.max(prior?.high ?? 0, previous.conservativeUsedBytes)
        + Math.max(0, raw.usedBytes - previous.rawUsedBytes) : Math.max(raw.usedBytes, prior?.high ?? 0);
    if (!Number.isSafeInteger(usedBytes) || usedBytes > raw.limitBytes) throw new Error('broker_conservative_budget_exhausted');
    const checkpoint = JSON.stringify({ version: 1, identityHash: identity.quotaEpochEvidenceHash,
        rawUsedBytes: raw.usedBytes, conservativeUsedBytes: usedBytes, limitBytes: raw.limitBytes, observedAt: raw.observedAt });
    // 原始共享計數與保守值分開保存；不把本機 identity 說成 API 提供的週期。
    const results = await db.batch([db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        VALUES(?,'broker-local-counter','verified',?,?) ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint,
        updated_at=excluded.updated_at WHERE screener_runs.status='verified' AND screener_runs.checkpoint=?`)
        .bind(headId, checkpoint, raw.observedAt, head?.checkpoint ?? ''),
    db.prepare(`INSERT INTO broker_bandwidth_observations(scope,quota_epoch,generation,used_bytes,limit_bytes,observed_at)
        SELECT ?,?,?,?,?,? WHERE changes()=1 ON CONFLICT(scope,quota_epoch) DO UPDATE SET generation=excluded.generation,
        used_bytes=excluded.used_bytes,observed_at=excluded.observed_at WHERE excluded.used_bytes>=used_bytes
        AND excluded.limit_bytes=limit_bytes AND excluded.observed_at>=observed_at`)
        .bind(identity.scope, identity.quotaEpoch, raw.generation, usedBytes, raw.limitBytes, raw.observedAt),
    db.prepare('INSERT INTO broker_bandwidth_receipts(id,reservation_id,status,payload,created_at) SELECT ?,NULL,?,?,? WHERE changes()=1')
        .bind(randomUUID(), 'local_usage_observed', JSON.stringify({ ...identity, rawUsedBytes: raw.usedBytes,
            rawRemainingBytes: raw.remainingBytes, conservativeUsedBytes: usedBytes, limitBytes: raw.limitBytes,
            generation: raw.generation, observedAt: raw.observedAt, providerQuotaEpochVerified: false }), raw.observedAt)]);
    if ((results[0].meta?.changes ?? results[0].changes) !== 1) throw new Error('broker_usage_observation_raced');
    const saved = await db.prepare('SELECT used_bytes,limit_bytes FROM broker_bandwidth_observations WHERE scope=? AND quota_epoch=?')
        .bind(identity.scope, identity.quotaEpoch).first();
    if (!saved || saved.limit_bytes !== raw.limitBytes) throw new Error('broker_usage_pending');
    return { ...raw, ...identity, quotaEpochVerified: false, usedBytes: saved.used_bytes, remainingBytes: raw.limitBytes - saved.used_bytes };
}
