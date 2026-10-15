/** 僅在程序記憶體內處理帳號；輸出受本機私密金鑰保護的摘要。 */
import { createHmac } from 'node:crypto';

export function brokerStockAccountScopeHash(accounts, localSecret) {
    if (!Buffer.isBuffer(localSecret) || localSecret.length < 32) {
        throw new Error('broker_account_scope_key_unverified');
    }
    if (!Array.isArray(accounts) || accounts.length < 1 || accounts.length > 32) {
        throw new Error('broker_account_scope_unverified');
    }
    const selected = accounts.filter(entry => entry?.signed === true && entry?.account_type === 'S');
    if (!selected.length || selected.length > 32 || selected.some(entry =>
        typeof entry.account_id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(entry.account_id) ||
        typeof entry.broker_id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(entry.broker_id))) {
        throw new Error('broker_account_scope_unverified');
    }
    const canonical = selected.map(entry => [entry.broker_id, entry.account_id, 'S'])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (new Set(canonical.map(value => JSON.stringify(value))).size !== canonical.length) {
        throw new Error('broker_account_scope_unverified');
    }
    return createHmac('sha256', localSecret)
        .update(JSON.stringify({ version: 1, stockAccounts: canonical })).digest('hex');
}
