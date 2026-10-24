/** 經跨日來源證據授權的本機新週期；不宣稱券商 API 提供 quota epoch。 */
import { createHash, randomUUID } from 'node:crypto';

const HEAD = 'broker-local-daily-reset-head';
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex = value => /^[a-f0-9]{64}$/.test(value ?? '');

export async function readLocalVerifiedDailyIdentity(db) {
    const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(HEAD).first();
    if (row?.status !== 'verified') throw new Error('broker_daily_identity_pending');
    let value;
    try { value = JSON.parse(row.checkpoint); }
    catch { throw new Error('broker_daily_identity_pending'); }
    const { identityHash, ...proof } = value;
    if (Object.keys(value).length !== 10 || value.version !== 1 ||
        value.identityMode !== 'local-verified-daily-reset-v1' ||
        !hex(value.scope) || !/^local-daily:\d{4}-\d{2}-\d{2}$/.test(value.quotaEpoch ?? '') ||
        !hex(value.quotaEpochEvidenceHash) || !hex(value.accountScopeHash) ||
        !hex(value.previousIdentityHash) || !hex(value.officialEvidenceHash) ||
        !Number.isFinite(Date.parse(value.observedAt)) || !hex(identityHash) ||
        identityHash !== sha(proof)) throw new Error('broker_daily_identity_pending');
    const witness = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?')
        .bind(`broker-daily-reset-witness:${value.quotaEpochEvidenceHash}`).first();
    let saved;
    try { saved = JSON.parse(witness?.checkpoint); }
    catch { throw new Error('broker_daily_identity_pending'); }
    if (witness?.status !== 'verified' ||
        saved?.schemaVersion !== 'broker-daily-reset-witness/1' ||
        sha(saved) !== value.quotaEpochEvidenceHash ||
        saved.accountScopeHash !== value.accountScopeHash ||
        saved.officialEvidenceHash !== value.officialEvidenceHash ||
        saved.tradingDay !== value.quotaEpoch.slice('local-daily:'.length) ||
        saved.observedAt !== value.observedAt ||
        saved.authority !== 'candidate-only-no-ledger-or-policy-mutation') {
        throw new Error('broker_daily_identity_pending');
    }
    return Object.freeze({ scope: value.scope, quotaEpoch: value.quotaEpoch,
        quotaEpochEvidenceHash: value.quotaEpochEvidenceHash,
        accountScopeHash: value.accountScopeHash, identityMode: value.identityMode,
        identityHash: value.identityHash });
}

export function createLocalVerifiedDailyIdentity({ previous, witness }) {
    if (!hex(previous?.scope) || !hex(previous?.quotaEpochEvidenceHash) ||
        witness?.state !== 'candidate' || witness.authorizesAdmission !== false ||
        !hex(witness?.evidenceHash) || !hex(witness.proof?.accountScopeHash) ||
        !hex(witness.proof?.officialEvidenceHash) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(witness.proof?.tradingDay ?? '')) {
        throw new Error('broker_daily_identity_witness_invalid');
    }
    const proof = { version: 1, identityMode: 'local-verified-daily-reset-v1',
        scope: previous.scope, quotaEpoch: `local-daily:${witness.proof.tradingDay}`,
        quotaEpochEvidenceHash: witness.evidenceHash,
        accountScopeHash: witness.proof.accountScopeHash,
        previousIdentityHash: previous.dailyIdentityHash ?? previous.quotaEpochEvidenceHash,
        officialEvidenceHash: witness.proof.officialEvidenceHash,
        observedAt: witness.proof.observedAt };
    return Object.freeze({ ...proof, identityHash: sha(proof) });
}

/** 受控啟用保守銜接；呼叫端必須先驗證 simulation、安全健康、穩定 generation 與帳戶。
 * 不建立新 quota epoch、不改政策、不解除任何預留；將舊高水位與新段全額相加。
 */
export async function activateDailyUsageContinuity(db, identity, raw, accountScopeHash, now = new Date()) {
    if (!Number.isFinite(now?.getTime()) || Date.parse(raw?.observedAt) > now.getTime() ||
        now.getTime() - Date.parse(raw?.observedAt) > 60000) throw new Error('broker_usage_pending');
    return dailyUsage(db, identity, raw, accountScopeHash, true);
}

export async function localVerifiedDailyUsage(db, identity, raw, accountScopeHash) {
    return dailyUsage(db, identity, raw, accountScopeHash, false);
}

async function dailyUsage(db, identity, raw, accountScopeHash, activate) {
    const head = await readLocalVerifiedDailyIdentity(db);
    if (identity.scope !== head.scope || identity.quotaEpoch !== head.quotaEpoch ||
        identity.quotaEpochEvidenceHash !== head.quotaEpochEvidenceHash ||
        accountScopeHash !== head.accountScopeHash || !hex(accountScopeHash)) {
        throw new Error('broker_daily_account_scope_changed');
    }
    if (![raw?.usedBytes, raw?.limitBytes, raw?.remainingBytes].every(n => Number.isSafeInteger(n) && n >= 0) ||
        raw.limitBytes < 1 || raw.usedBytes + raw.remainingBytes !== raw.limitBytes ||
        !Number.isFinite(Date.parse(raw.observedAt)) ||
        !/^simulation:[A-Za-z0-9._:-]{1,180}$/.test(raw.generation ?? '')) {
        throw new Error('broker_usage_pending');
    }
    const prior = await db.prepare(`SELECT generation,used_bytes,limit_bytes,observed_at FROM broker_bandwidth_observations
        WHERE scope=? AND quota_epoch=?`).bind(head.scope, head.quotaEpoch).first();
    const counterId = `broker-daily-usage-continuity:${head.identityHash}`;
    const counter = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(counterId).first();
    // 正常消費者也能銜接之後的重開機；首次跨程序仍須具備同一帳戶的原始持久收據。
    // 日期或 generation 改變從不建立新額度身分，也不減去任何已計用量。
    if (counter || activate || prior && prior.generation !== raw.generation)
        return continuousUsage(db, head, raw, accountScopeHash, prior, counter, counterId);
    if (prior && (prior.limit_bytes !== raw.limitBytes || prior.used_bytes > raw.usedBytes ||
        Date.parse(prior.observed_at) > Date.parse(raw.observedAt))) {
        throw new Error('broker_daily_usage_nonmonotonic');
    }
    const results = await db.batch([
        db.prepare(`INSERT INTO broker_bandwidth_observations(scope,quota_epoch,generation,used_bytes,limit_bytes,observed_at)
            VALUES(?,?,?,?,?,?) ON CONFLICT(scope,quota_epoch) DO UPDATE SET generation=excluded.generation,
            used_bytes=excluded.used_bytes,observed_at=excluded.observed_at
            WHERE excluded.used_bytes>=used_bytes AND excluded.limit_bytes=limit_bytes AND excluded.observed_at>=observed_at`)
            .bind(head.scope, head.quotaEpoch, raw.generation, raw.usedBytes, raw.limitBytes, raw.observedAt),
        db.prepare(`INSERT INTO broker_bandwidth_receipts(id,reservation_id,status,payload,created_at)
            SELECT ?,NULL,'daily_usage_observed',?,? WHERE changes()=1`)
            .bind(randomUUID(), JSON.stringify({ identityHash: head.identityHash,
                accountScopeHash, rawUsedBytes: raw.usedBytes, rawRemainingBytes: raw.remainingBytes,
                generation: raw.generation, observedAt: raw.observedAt,
                providerQuotaEpochVerified: false }), raw.observedAt),
    ]);
    if ((results[0].meta?.changes ?? results[0].changes) !== 1) {
        throw new Error('broker_daily_usage_raced');
    }
    return { ...raw, scope: head.scope, quotaEpoch: head.quotaEpoch,
        quotaEpochEvidenceHash: head.quotaEpochEvidenceHash,
        identityMode: head.identityMode, quotaEpochVerified: false };
}

async function continuousUsage(db, head, raw, accountScopeHash, prior, counter, counterId) {
    if (!prior || !Number.isSafeInteger(prior.used_bytes) || prior.used_bytes < 0 ||
        prior.limit_bytes !== raw.limitBytes || !Number.isFinite(Date.parse(prior.observed_at)) ||
        Date.parse(prior.observed_at) > Date.parse(raw.observedAt))
        throw new Error('broker_daily_usage_nonmonotonic');
    let previous;
    if (counter) {
        try { previous = JSON.parse(counter.checkpoint); } catch { throw new Error('broker_usage_pending'); }
        if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('broker_usage_pending');
        const { stateHash, ...proof } = previous;
        if (counter.status !== 'verified' || Object.keys(previous).length !== 11 || previous.version !== 1 ||
            stateHash !== sha(proof) || previous.identityHash !== head.identityHash ||
            previous.accountScopeHash !== accountScopeHash || previous.generation !== prior.generation ||
            previous.limitBytes !== prior.limit_bytes || previous.conservativeUsedBytes !== prior.used_bytes ||
            previous.observedAt !== prior.observed_at || !Number.isSafeInteger(previous.rawUsedBytes) ||
            previous.rawUsedBytes < 0 || previous.rawUsedBytes > previous.conservativeUsedBytes ||
            !hex(previous.previousStateHash) || !Number.isSafeInteger(previous.segmentCount) || previous.segmentCount < 2)
            throw new Error('broker_usage_pending');
    } else {
        // 沒有可信的舊帳戶觀察不得憑 generation 文字啟用；原 row 與收據必須一致。
        const old = await db.prepare(`SELECT payload FROM broker_bandwidth_receipts
            WHERE status='daily_usage_observed' AND json_extract(payload,'$.identityHash')=?
            AND json_extract(payload,'$.generation')=? AND json_extract(payload,'$.rawUsedBytes')=?
            AND json_extract(payload,'$.observedAt')=? ORDER BY created_at DESC LIMIT 1`)
            .bind(head.identityHash, prior.generation, prior.used_bytes, prior.observed_at).first();
        let proof; try { proof = JSON.parse(old?.payload); } catch { /* 缺件即阻擋 */ }
        if (proof?.accountScopeHash !== accountScopeHash || prior.generation === raw.generation)
            throw new Error('broker_daily_usage_nonmonotonic');
        previous = { generation: prior.generation, rawUsedBytes: prior.used_bytes,
            conservativeUsedBytes: prior.used_bytes, segmentCount: 1,
            stateHash: sha({ identityHash: head.identityHash, prior, originalReceipt: proof }) };
    }
    const changed = previous.generation !== raw.generation;
    if (counter && changed && await db.prepare(`SELECT id FROM broker_bandwidth_receipts
        WHERE status='daily_usage_observed' AND json_extract(payload,'$.identityHash')=?
        AND json_extract(payload,'$.generation')=? LIMIT 1`).bind(head.identityHash, raw.generation).first())
        throw new Error('broker_daily_usage_nonmonotonic');
    if (!changed && raw.usedBytes < previous.rawUsedBytes) throw new Error('broker_daily_usage_nonmonotonic');
    // 任何跨程序觀察均保留前段全額，再加新段全額；不以回退幅度推導重設或退款。
    const usedBytes = prior.used_bytes + (changed ? raw.usedBytes : raw.usedBytes - previous.rawUsedBytes);
    if (!Number.isSafeInteger(usedBytes) || usedBytes > raw.limitBytes) throw new Error('broker_conservative_budget_exhausted');
    const proof = { version: 1, identityHash: head.identityHash, accountScopeHash,
        generation: raw.generation, rawUsedBytes: raw.usedBytes, conservativeUsedBytes: usedBytes,
        limitBytes: raw.limitBytes, observedAt: raw.observedAt,
        segmentCount: previous.segmentCount + (changed ? 1 : 0), previousStateHash: previous.stateHash };
    const checkpoint = JSON.stringify({ ...proof, stateHash: sha(proof) });
    // 所有寫入同一 transaction；CAS 同時核對 counter、原觀察及目前正式 quota 身分。
    const results = await db.batch([
        db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            SELECT ?,'broker-daily-usage-continuity','verified',?,? WHERE
            EXISTS(SELECT 1 FROM broker_bandwidth_observations WHERE scope=? AND quota_epoch=?
                AND generation=? AND used_bytes=? AND limit_bytes=? AND observed_at=?)
            AND EXISTS(SELECT 1 FROM screener_runs WHERE id='broker-local-daily-reset-head'
                AND status='verified' AND json_extract(checkpoint,'$.identityHash')=?)
            ON CONFLICT(id) DO UPDATE SET checkpoint=excluded.checkpoint,updated_at=excluded.updated_at
                WHERE screener_runs.status='verified' AND screener_runs.checkpoint=?`)
            .bind(counterId, checkpoint, raw.observedAt, head.scope, head.quotaEpoch, prior.generation,
                prior.used_bytes, prior.limit_bytes, prior.observed_at, head.identityHash, counter?.checkpoint ?? ''),
        db.prepare(`UPDATE broker_bandwidth_observations SET generation=?,used_bytes=?,observed_at=?
            WHERE scope=? AND quota_epoch=? AND changes()=1`)
            .bind(raw.generation, usedBytes, raw.observedAt, head.scope, head.quotaEpoch),
        db.prepare(`INSERT INTO broker_bandwidth_receipts(id,reservation_id,status,payload,created_at)
            SELECT ?,NULL,'daily_usage_observed',?,? WHERE changes()=1`)
            .bind(randomUUID(), JSON.stringify({ ...proof, stateHash: sha(proof),
                rawRemainingBytes: raw.remainingBytes, providerQuotaEpochVerified: false,
                continuity: changed ? 'carry-full-prior-and-new-segment' : 'same-segment-delta' }), raw.observedAt),
    ]);
    if (results.some(result => (result.meta?.changes ?? result.changes) !== 1)) throw new Error('broker_daily_usage_raced');
    return { ...raw, scope: head.scope, quotaEpoch: head.quotaEpoch,
        quotaEpochEvidenceHash: head.quotaEpochEvidenceHash, identityMode: head.identityMode,
        quotaEpochVerified: false, usedBytes, remainingBytes: raw.limitBytes - usedBytes };
}
