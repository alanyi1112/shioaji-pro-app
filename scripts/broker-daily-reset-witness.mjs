/** 券商每日額度重設的證據分類；此函式不變更帳本、政策或 admission 身分。 */
import { createHash } from 'node:crypto';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = value => /^[a-f0-9]{64}$/.test(value ?? '');
const usage = value => value && Number.isSafeInteger(value.usedBytes) && value.usedBytes >= 0 &&
    Number.isSafeInteger(value.limitBytes) && value.limitBytes > 0 &&
    Number.isSafeInteger(value.remainingBytes) && value.remainingBytes >= 0 &&
    value.usedBytes + value.remainingBytes === value.limitBytes &&
    Number.isFinite(Date.parse(value.observedAt)) &&
    /^simulation:[A-Za-z0-9._:-]{1,180}$/.test(value.generation ?? '');

export function classifyBrokerDailyResetWitness({ before, after, beforeAccountHash,
    afterAccountHash, tradingDay, observedAt = after?.observedAt } = {}) {
    if (!usage(before) || !usage(after) || !hash(beforeAccountHash) ||
        !hash(afterAccountHash) || !Number.isFinite(Date.parse(observedAt ?? ''))) {
        throw new TypeError('broker_reset_witness_invalid');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay?.tradeDate ?? '') ||
        tradingDay?.twseTradingDay !== true || tradingDay?.tpexTradingDay !== true ||
        !hash(tradingDay?.officialEvidenceHash) ||
        !Number.isFinite(Date.parse(tradingDay?.verifiedAt ?? ''))) {
        return Object.freeze({ state: 'unverified', reason: 'official_session_unverified' });
    }
    const resetAt = Date.parse(`${tradingDay.tradeDate}T08:00:00+08:00`);
    const beforeAt = Date.parse(before.observedAt), afterAt = Date.parse(after.observedAt);
    const checkedAt = Date.parse(observedAt), calendarAt = Date.parse(tradingDay.verifiedAt);
    const beforeLocalDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(beforeAt));
    const previousSessionVerified = /^\d{4}-\d{2}-\d{2}$/.test(tradingDay.previousTradeDate ?? '') &&
        tradingDay.previousTradeDate < tradingDay.tradeDate &&
        beforeLocalDate === tradingDay.previousTradeDate;
    const maximumBeforeAge = previousSessionVerified ? 10 * 24 * 60 * 60_000 : 36 * 60 * 60_000;
    if (beforeAccountHash !== afterAccountHash) {
        return Object.freeze({ state: 'unverified', reason: 'account_scope_changed' });
    }
    if (before.limitBytes !== after.limitBytes) {
        return Object.freeze({ state: 'unverified', reason: 'quota_limit_changed' });
    }
    if (!(beforeAt < resetAt && afterAt >= resetAt && afterAt <= checkedAt &&
        checkedAt - afterAt <= 60_000 && calendarAt <= checkedAt &&
        resetAt - beforeAt <= maximumBeforeAge && afterAt - resetAt <= 12 * 60 * 60_000)) {
        return Object.freeze({ state: 'unverified', reason: 'reset_window_unverified' });
    }
    if (after.usedBytes >= before.usedBytes) {
        return Object.freeze({ state: 'unverified', reason: 'counter_drop_not_observed' });
    }
    const proof = { schemaVersion: 'broker-daily-reset-witness/1',
        tradingDay: tradingDay.tradeDate, resetAt: new Date(resetAt).toISOString(),
        officialEvidenceHash: tradingDay.officialEvidenceHash,
        accountScopeHash: beforeAccountHash, before, after,
        observedAt: new Date(checkedAt).toISOString(),
        authority: 'candidate-only-no-ledger-or-policy-mutation' };
    return Object.freeze({ state: 'candidate', proof: Object.freeze(proof),
        evidenceHash: sha(proof), authorizesAdmission: false });
}
