/** 同日重開機只增加保守用量，不清帳、不建立新的 quota epoch。 */
import { readFile, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readLocalVerifiedDailyIdentity } from '../broker-local-verified-reset-ledger.mjs';
import { readBrokerAccountScopeHash } from '../broker-reset-observation.mjs';
import { readScreenerBrokerCommitments } from '../stock-screener-broker-commitments.mjs';
import { observeRuntimeBudgetAllocations } from '../stock-screener-runtime-budget-producer.mjs';
import { createBrokerBandwidthAdmission } from '../broker-bandwidth-reservations.mjs';

export function conservativeInterruptedUsage(raw, carryBytes) {
    if (![raw?.usedBytes, raw?.remainingBytes, raw?.limitBytes, carryBytes].every(n => Number.isSafeInteger(n) && n >= 0) ||
        raw.limitBytes < 1 || raw.usedBytes + raw.remainingBytes !== raw.limitBytes ||
        carryBytes + raw.usedBytes > raw.limitBytes) throw new Error('broker_usage_pending');
    return { ...raw, usedBytes: carryBytes + raw.usedBytes,
        remainingBytes: raw.limitBytes - carryBytes - raw.usedBytes };
}

export async function createInterruptionConservativeAdmission({ db, root, recoveryRoot,
    generation, ports, now = () => new Date(),
    readAccountScope = readBrokerAccountScopeHash,
    observeAllocation = observeRuntimeBudgetAllocations,
    readCommitments = readScreenerBrokerCommitments }) {
    const identity = await readLocalVerifiedDailyIdentity(db);
    const raw = await ports.observeUsage();
    const accountScopeHash = await readAccountScope({ root });
    if (identity.accountScopeHash !== accountScopeHash || raw.generation !== generation)
        throw new Error('broker_daily_account_scope_changed');
    const prior = await db.prepare('SELECT generation,used_bytes,limit_bytes FROM broker_bandwidth_observations WHERE scope=? AND quota_epoch=?')
        .bind(identity.scope, identity.quotaEpoch).first();
    const anchorFile = path.join(recoveryRoot, 'same-epoch-conservative-carry.json');
    let anchor;
    try { anchor = JSON.parse(await readFile(anchorFile)); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!prior || prior.generation === generation || prior.limit_bytes !== raw.limitBytes || prior.used_bytes <= raw.usedBytes)
            throw new Error('interruption_conservative_carry_not_applicable');
        anchor = { schemaVersion: 'same-epoch-interruption-conservative-carry/1',
            identityHash: identity.identityHash, scope: identity.scope, quotaEpoch: identity.quotaEpoch,
            quotaEpochEvidenceHash: identity.quotaEpochEvidenceHash, accountScopeHash,
            previousGeneration: prior.generation, generation, carryBytes: prior.used_bytes,
            providerLimitBytes: raw.limitBytes, rawUsageAtAnchor: raw.usedBytes, observedAt: now().toISOString(),
            providerQuotaEpochVerified: false, resetsQuota: false, preservesChargedAndQuarantined: true };
        const handle = await open(anchorFile, 'wx', 0o600);
        try { await handle.writeFile(`${JSON.stringify(anchor)}\n`); await handle.sync(); }
        finally { await handle.close(); }
    }
    if (anchor.identityHash !== identity.identityHash || anchor.accountScopeHash !== accountScopeHash ||
        anchor.generation !== generation || anchor.quotaEpoch !== identity.quotaEpoch ||
        anchor.providerLimitBytes !== raw.limitBytes || anchor.resetsQuota !== false)
        throw new Error('interruption_conservative_carry_invalid');
    const readUsage = async () => {
        const head = await readLocalVerifiedDailyIdentity(db), current = await ports.observeUsage();
        if (head.identityHash !== identity.identityHash || current.generation !== generation ||
            (await readAccountScope({ root })) !== accountScopeHash)
            throw new Error('broker_daily_account_scope_changed');
        const result = conservativeInterruptedUsage(current, anchor.carryBytes);
        const observation = await db.prepare('SELECT used_bytes,limit_bytes,observed_at FROM broker_bandwidth_observations WHERE scope=? AND quota_epoch=?')
            .bind(identity.scope, identity.quotaEpoch).first();
        if (observation && (observation.used_bytes > result.usedBytes || observation.limit_bytes !== result.limitBytes ||
            Date.parse(observation.observed_at) > Date.parse(result.observedAt))) throw new Error('broker_usage_pending');
        await db.prepare('INSERT INTO broker_bandwidth_receipts(id,reservation_id,status,payload,created_at) VALUES(?,NULL,?,?,?)')
            .bind(randomUUID(), 'same_epoch_conservative_usage_observed', JSON.stringify({ identityHash: identity.identityHash,
                generation, rawUsedBytes: current.usedBytes, carryBytes: anchor.carryBytes,
                conservativeUsedBytes: result.usedBytes, providerQuotaEpochVerified: false, resetsQuota: false }),
                result.observedAt).run();
        return { ...result, scope: identity.scope, quotaEpoch: identity.quotaEpoch,
            quotaEpochEvidenceHash: identity.quotaEpochEvidenceHash, identityMode: identity.identityMode,
            quotaEpochVerified: false };
    };
    const readPolicy = async () => {
        const row = await db.prepare("SELECT status,checkpoint FROM screener_runs WHERE id='screener-bollinger-broker-budget-policy'").first();
        const record = JSON.parse(row?.checkpoint ?? 'null');
        const head = await readLocalVerifiedDailyIdentity(db);
        if (row?.status !== 'verified' || record?.version !== 4 || record.dailyIdentityHash !== head.identityHash ||
            head.identityHash !== identity.identityHash || record.scope !== identity.scope || record.quotaEpoch !== identity.quotaEpoch ||
            record.quotaEpochEvidenceHash !== identity.quotaEpochEvidenceHash || record.quotaEpochVerified !== false ||
            Date.parse(record.validThrough) <= now().getTime() || record.budgetPolicy?.quoteReserveBytes < 300 * 1024 ** 2)
            throw new Error('broker_policy_pending');
        await observeAllocation({ db, record, root, now: now() });
        return { ...await readCommitments(db, record, now()),
            quotaIdentity: { scope: identity.scope, quotaEpoch: identity.quotaEpoch,
                quotaEpochEvidenceHash: identity.quotaEpochEvidenceHash, identityMode: identity.identityMode } };
    };
    return createBrokerBandwidthAdmission({ db, now, readUsage, readPolicy });
}
