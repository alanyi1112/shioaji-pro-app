/** 共用的持久保留 port；無預設啟動流量門檻、無下載／登入／訂閱。未配置政策一律拒絕。 */
import { createHash, randomUUID } from 'node:crypto';
import { readLocalConservativeIdentity } from './broker-local-conservative-ledger.mjs';

const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const safe = n => Number.isSafeInteger(n) && n >= 0;
const fresh = (s, now, age = 60000) => typeof s === 'string' && Number.isFinite(Date.parse(s))
    && Date.parse(s) <= now.getTime() && now.getTime() - Date.parse(s) <= age;
const token = s => typeof s === 'string' && /^[a-zA-Z0-9:_|.-]{1,200}$/.test(s);
const validQuotaIdentity = v => v && HASH.test(v.scope ?? '') && token(v.quotaEpoch)
    && HASH.test(v.quotaEpochEvidenceHash ?? '') && (Object.keys(v).length === 3
        || Object.keys(v).length === 4 && v.identityMode === 'local-conservative-v1');
function policyFingerprint(policy) {
    // freshness 是每次重驗的觀察時間，不是承諾修訂；否則正常跨毫秒重讀必定誤拒絕。
    // 只略去此時間，其餘額度、實測、證據、效期及 quota identity 全部仍綁定。
    // v2 與舊 reservation 隔離；舊未送保留 fail closed，不改寫原帳本／收據。
    const { commitmentsObservedAt: _observedAt, ...terms } = policy;
    return hash({ fingerprintVersion: 'broker-budget-terms-v2', terms });
}

export async function brokerBudgetSchemaReady(db) {
    return (await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN
        ('broker_bandwidth_observations','broker_bandwidth_reservations','broker_bandwidth_receipts')`).all()).results?.length === 3;
}
export function validateBrokerBudgetPolicy(p, now = new Date()) {
    if (!p || p.version !== 1 || p.status !== 'verified' || !HASH.test(p.evidenceHash ?? '')
        || !fresh(p.commitmentsObservedAt, now) || !Number.isFinite(Date.parse(p.validThrough)) || Date.parse(p.validThrough) <= now.getTime()
        || !safe(p.quoteReserveBytes) || !Array.isArray(p.otherJobCommitments) || p.otherJobCommitments.length > 100
        || p.otherJobCommitments.some(c => !token(c.jobKey) || !safe(c.bytes))
        || new Set(p.otherJobCommitments.map(c => c.jobKey)).size !== p.otherJobCommitments.length
        || !Number.isFinite(p.estimateMultiplier) || p.estimateMultiplier < 1 || p.estimateMultiplier > 10
        || !safe(p.maxEstimatedBytes) || p.maxEstimatedBytes < 1
        || !Number.isInteger(p.maxRequestsPerWindow) || p.maxRequestsPerWindow < 1 || p.maxRequestsPerWindow > 100
        || !Number.isInteger(p.rateWindowMs) || p.rateWindowMs < 1000 || p.rateWindowMs > 3600000
        || !Array.isArray(p.measurements) || p.measurements.length < 2 || p.measurements.length > 100
        || Object.hasOwn(p, 'quotaIdentity') && !validQuotaIdentity(p.quotaIdentity)) return false;
    return new Set(p.measurements.map(m => m.evidenceHash)).size === p.measurements.length
        && p.measurements.every(m => HASH.test(m.evidenceHash ?? '') && safe(m.usageBefore) && safe(m.usageAfter)
            && m.usageAfter > m.usageBefore && safe(m.responseBytes) && m.responseBytes > 0
            && Number.isFinite(Date.parse(m.observedAt)) && Date.parse(m.observedAt) <= now.getTime()
            && now.getTime() - Date.parse(m.observedAt) <= 30 * 86400000
            && m.provider === 'shioaji-daily-quotes');
}
function observation(v, now) {
    // quotaEpoch 必須由可信 quota reset identity port 取得，不用 API generation／任意新日期免除債務。
    if (!v || !HASH.test(v.scope ?? '') || !token(v.quotaEpoch) || !HASH.test(v.quotaEpochEvidenceHash ?? '')
        || !(v.quotaEpochVerified === true && v.identityMode == null
            || v.quotaEpochVerified === false && v.identityMode === 'local-conservative-v1')
        || !token(v.generation) || !fresh(v.observedAt, now)
        || !safe(v.usedBytes) || !safe(v.limitBytes) || v.limitBytes < 1 || !safe(v.remainingBytes)
        || v.usedBytes + v.remainingBytes !== v.limitBytes) throw new Error('broker_usage_pending');
    return v;
}

export function createBrokerBandwidthAdmission({ db, readUsage, readPolicy, now = () => new Date(), owner = randomUUID() }) {
    const receipt = async (status, reservationId, payload) => db.prepare(
        'INSERT INTO broker_bandwidth_receipts(id,reservation_id,status,payload,created_at) VALUES(?,?,?,?,?)')
        .bind(randomUUID(), reservationId, status, JSON.stringify(payload), now().toISOString()).run();
    const reserve = async ({ cacheKey, generation }) => {
        if (!await brokerBudgetSchemaReady(db)) return { allowed: false, reason: 'broker_budget_schema_pending' };
        if (!token(cacheKey) || !token(generation)) throw new Error('invalid_broker_reservation');
        let usage, policy, policyHash, estimate, commitments;
        try {
            // 本機政策先驗證；stale／缺實測不得先消耗 Snapshot 或 usage 請求。
            policy = await readPolicy();
            if (!validateBrokerBudgetPolicy(policy, now())) throw new Error('broker_policy_pending');
            policyHash = policyFingerprint(policy);
            estimate = Math.ceil(Math.max(...policy.measurements.map(m => m.usageAfter - m.usageBefore)) * policy.estimateMultiplier);
            commitments = policy.otherJobCommitments.reduce((n, c) => n + c.bytes, policy.quoteReserveBytes);
            if (!safe(estimate) || estimate < 1 || estimate > policy.maxEstimatedBytes || !safe(commitments))
                throw new Error('broker_estimate_pending');
            usage = observation(await readUsage(), now());
            if (usage.identityMode === 'local-conservative-v1') {
                const anchor = await readLocalConservativeIdentity(db);
                if (JSON.stringify(anchor) !== JSON.stringify(policy.quotaIdentity)
                    || anchor.scope !== usage.scope || anchor.quotaEpoch !== usage.quotaEpoch
                    || anchor.quotaEpochEvidenceHash !== usage.quotaEpochEvidenceHash) throw new Error('broker_usage_pending');
            }
            if (usage.generation !== generation) throw new Error('broker_generation_changed');
            if (policy.quotaIdentity && (usage.scope !== policy.quotaIdentity.scope
                || usage.quotaEpoch !== policy.quotaIdentity.quotaEpoch
                || usage.quotaEpochEvidenceHash !== policy.quotaIdentity.quotaEpochEvidenceHash))
                throw new Error('broker_usage_pending');
            // 等待 HTTP 時，政策可能到期或被其他工作更新；不得沿用舊承諾入帳。
            const latest = await readPolicy();
            if (!validateBrokerBudgetPolicy(latest, now())) throw new Error('broker_policy_pending');
            if (policyFingerprint(latest) !== policyHash) throw new Error('broker_policy_changed');
        } catch (e) {
            const reason = ['broker_usage_pending','broker_policy_pending','broker_policy_changed','broker_estimate_pending','broker_generation_changed'].includes(e.message)
                ? e.message : 'broker_budget_pending';
            await receipt('denied', null, { reason }); return { allowed: false, reason };
        }
        const id = randomUUID(), at = now().toISOString();
        // 同 transaction 更新單調 usage／generation，再以 SUM 保留額度 admission，跨 port／程序競爭不會超賣。
        await db.batch([
            db.prepare(`INSERT INTO broker_bandwidth_observations(scope,quota_epoch,generation,used_bytes,limit_bytes,observed_at)
                VALUES(?,?,?,?,?,?) ON CONFLICT(scope,quota_epoch) DO UPDATE SET generation=excluded.generation,
                used_bytes=excluded.used_bytes,observed_at=excluded.observed_at WHERE excluded.used_bytes>=used_bytes
                AND excluded.limit_bytes=limit_bytes AND excluded.observed_at>=observed_at`)
                .bind(usage.scope, usage.quotaEpoch, generation, usage.usedBytes, usage.limitBytes, usage.observedAt),
            db.prepare(`INSERT INTO broker_bandwidth_reservations(id,scope,quota_epoch,generation,job_key,owner,status,
                estimated_bytes,usage_before,policy_hash,created_at,lease_until,updated_at)
                SELECT ?,?,?,?,?,?,'reserved',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM broker_bandwidth_observations
                WHERE scope=? AND quota_epoch=? AND generation=? AND used_bytes=? AND observed_at=? AND limit_bytes=?)
                AND ?-?-COALESCE((SELECT SUM(estimated_bytes) FROM broker_bandwidth_reservations
                    WHERE ((scope=? AND quota_epoch=?) OR ?=1) AND status<>'released'),0)>=?
                AND (SELECT COUNT(*) FROM broker_bandwidth_reservations WHERE ((scope=? AND quota_epoch=?) OR ?=1) AND created_at>?)<?
                AND NOT EXISTS(SELECT 1 FROM broker_bandwidth_reservations WHERE ((scope=? AND quota_epoch=?) OR ?=1) AND job_key=?
                    AND status IN ('reserved','dispatched','quarantined'))`)
                .bind(id, usage.scope, usage.quotaEpoch, generation, cacheKey, owner, estimate, usage.usedBytes, policyHash,
                    at, new Date(now().getTime() + 60000).toISOString(), at,
                    usage.scope, usage.quotaEpoch, generation, usage.usedBytes, usage.observedAt, usage.limitBytes, usage.remainingBytes,
                    commitments, usage.scope, usage.quotaEpoch, usage.identityMode === 'local-conservative-v1' ? 1 : 0,
                    estimate, usage.scope, usage.quotaEpoch, usage.identityMode === 'local-conservative-v1' ? 1 : 0,
                    new Date(now().getTime() - policy.rateWindowMs).toISOString(), policy.maxRequestsPerWindow,
                    usage.scope, usage.quotaEpoch, usage.identityMode === 'local-conservative-v1' ? 1 : 0, cacheKey),
        ]);
        const row = await db.prepare('SELECT id FROM broker_bandwidth_reservations WHERE id=?').bind(id).first();
        // 只診斷拒絕，不用這次查詢取代上方 atomic admission；競爭時仍 fail closed。
        let reason = row ? 'none' : 'broker_budget_or_rate_denied', nextAttemptAt = null;
        if (!row) {
            const rate = await db.prepare(`SELECT COUNT(*) n,MIN(created_at) oldest FROM broker_bandwidth_reservations
                WHERE ((scope=? AND quota_epoch=?) OR ?=1) AND created_at>?`)
                .bind(usage.scope, usage.quotaEpoch, usage.identityMode === 'local-conservative-v1' ? 1 : 0,
                    new Date(now().getTime() - policy.rateWindowMs).toISOString()).first();
            if (rate.n >= policy.maxRequestsPerWindow) {
                reason = 'broker_rate_limited';
                nextAttemptAt = new Date(Math.max(now().getTime() + 1, Date.parse(rate.oldest) + policy.rateWindowMs)).toISOString();
            }
        }
        await receipt(row ? 'reserved' : 'denied', row ? id : null, { reason, nextAttemptAt,
            scope: usage.scope, quotaEpoch: usage.quotaEpoch, generation, estimatedBytes: estimate, usageBefore: usage.usedBytes,
            quoteReserveBytes: policy.quoteReserveBytes, otherCommittedBytes: commitments - policy.quoteReserveBytes, policyHash });
        return row ? { allowed: true, reservationId: id, estimatedBytes: estimate }
            : { allowed: false, reason, nextAttemptAt };
    };
    const start = async ({ reservationId }) => {
        const reserved = await db.prepare('SELECT status,owner,lease_until,policy_hash FROM broker_bandwidth_reservations WHERE id=?')
            .bind(reservationId).first();
        if (reserved?.owner !== owner || reserved.status !== 'reserved' || Date.parse(reserved.lease_until) <= now().getTime())
            throw new Error('broker_reservation_lost');
        const currentPolicy = await readPolicy();
        if (!validateBrokerBudgetPolicy(currentPolicy, now())) throw new Error('broker_policy_pending');
        if (policyFingerprint(currentPolicy) !== reserved.policy_hash) throw new Error('broker_policy_changed');
        const at = now().toISOString();
        const result = await db.prepare(`UPDATE broker_bandwidth_reservations SET status='dispatched',updated_at=?
            WHERE id=? AND owner=? AND status='reserved' AND lease_until>?`).bind(at, reservationId, owner, at).run();
        const row = await db.prepare('SELECT status,owner,lease_until FROM broker_bandwidth_reservations WHERE id=?').bind(reservationId).first();
        if ((result.meta?.changes ?? result.changes) !== 1 || row?.owner !== owner || row.status !== 'dispatched' || Date.parse(row.lease_until) <= now().getTime())
            throw new Error('broker_reservation_lost');
        await receipt('dispatched', reservationId, {});
    };
    const settle = async ({ reservationId, requested, responseBytes }) => {
        if (![0,1].includes(requested) || responseBytes !== null && (!safe(responseBytes) || responseBytes > 2 * 1024 ** 2))
            throw new Error('invalid_broker_settlement');
        const row = await db.prepare('SELECT * FROM broker_bandwidth_reservations WHERE id=? AND owner=?').bind(reservationId, owner).first();
        if (!row) throw new Error('broker_reservation_lost');
        if (['released','charged','quarantined'].includes(row.status)) return;
        let after = null;
        try { const v = observation(await readUsage(), now());
            if (v.scope === row.scope && v.quotaEpoch === row.quota_epoch && v.generation === row.generation && v.usedBytes >= row.usage_before)
                after = v.usedBytes;
        } catch { /* usage 未知不能憑 HTTP bytes 解除預留 */ }
        const status = requested === 0 && row.status === 'reserved' ? 'released' : after === null ? 'quarantined' : 'charged';
        // usage delta 可能含其他共用查詢，不冒充此 HTTP 的精確消耗；訂閱推送不計下載量。
        // 完成後仍保守扣 estimate 至 quota epoch 結束。
        await db.batch([db.prepare(`UPDATE broker_bandwidth_reservations SET status=?,response_bytes=?,usage_after=?,updated_at=?
            WHERE id=? AND owner=? AND status IN ('reserved','dispatched')`).bind(status, responseBytes, after, now().toISOString(), reservationId, owner),
            db.prepare('INSERT INTO broker_bandwidth_receipts(id,reservation_id,status,payload,created_at) VALUES(?,?,?,?,?)')
                .bind(randomUUID(), reservationId, status, JSON.stringify({ requested, responseBytes, usageBefore: row.usage_before,
                    usageAfter: after, sharedUsageDelta: after === null ? null : after - row.usage_before,
                    retainedEstimatedBytes: status === 'released' ? 0 : row.estimated_bytes }), now().toISOString())]);
    };
    const recover = async ({ reservationId, verifyOwnerDead }) => {
        const row = await db.prepare('SELECT * FROM broker_bandwidth_reservations WHERE id=?').bind(reservationId).first();
        if (!row || !['reserved','dispatched'].includes(row.status) || Date.parse(row.lease_until) > now().getTime()) return false;
        if (typeof verifyOwnerDead !== 'function' || await verifyOwnerDead(row.owner) !== true) return false;
        // 有 dispatched 記錄即使 socket timeout／owner 死亡也不能宣稱未耗額；不刪任何 receipt。
        const status = row.status === 'reserved' ? 'released' : 'quarantined';
        const results = await db.batch([db.prepare(`UPDATE broker_bandwidth_reservations SET status=?,updated_at=?
            WHERE id=? AND owner=? AND status=? AND lease_until<=?`).bind(status, now().toISOString(), row.id, row.owner, row.status, now().toISOString()),
            db.prepare(`INSERT INTO broker_bandwidth_receipts(id,reservation_id,status,payload,created_at)
                SELECT ?,?,'recovered',?,? WHERE changes()=1`)
                .bind(randomUUID(), row.id, JSON.stringify({ status, ownerDeadVerified: true }), now().toISOString())]);
        return (results[0].meta?.changes ?? results[0].changes) === 1;
    };
    return { reserve, start, settle, recover };
}
