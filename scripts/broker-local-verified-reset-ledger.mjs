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

export async function localVerifiedDailyUsage(db, identity, raw, accountScopeHash) {
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
    const prior = await db.prepare(`SELECT used_bytes,limit_bytes,observed_at FROM broker_bandwidth_observations
        WHERE scope=? AND quota_epoch=?`).bind(head.scope, head.quotaEpoch).first();
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
