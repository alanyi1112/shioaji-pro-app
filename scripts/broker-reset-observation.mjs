/** 唯讀券商端點並私密保存跨日計數錨點；不重設帳本或取得下載權限。 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { brokerStockAccountScopeHash } from './broker-account-scope.mjs';

const rootDefault = path.join(homedir(), 'Library/Application Support/RealTimeStock');
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const observationKeys = ['schemaVersion', 'observedAt', 'generation',
    'accountScopeHash', 'usedBytes', 'limitBytes', 'remainingBytes',
    'simulation', 'admissionAuthority', 'evidenceHash'];

async function privateFile(file, max) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
        stat.mode & 0o077 || stat.size < 1 || stat.size > max || await realpath(file) !== file) {
        throw new Error('broker_reset_private_file_invalid');
    }
    return readFile(file);
}

async function privateDirectory(directory) {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
        stat.mode & 0o077 || await realpath(directory) !== directory) {
        throw new Error('broker_reset_private_directory_invalid');
    }
}

async function accountKey(directory) {
    const file = path.join(directory, 'broker-quota-account-hmac.key');
    let existing;
    try { existing = await privateFile(file, 64); }
    catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const bytes = randomBytes(32);
        let handle;
        try { handle = await open(file, 'wx', 0o600); }
        catch (race) {
            if (race?.code !== 'EEXIST') throw race;
            return accountKey(directory);
        }
        try { await handle.writeFile(bytes); await handle.sync(); }
        finally { await handle.close(); bytes.fill(0); }
        existing = await privateFile(file, 64);
    }
    if (existing.length !== 32) throw new Error('broker_reset_account_key_invalid');
    return existing;
}

export async function readBrokerAccountScopeHash({ root = rootDefault, fetchImpl = fetch } = {}) {
    if (!path.isAbsolute(root) || typeof fetchImpl !== 'function') {
        throw new TypeError('broker_account_scope_read_invalid');
    }
    await privateDirectory(root);
    const directory = path.join(root, 'IntradayMonitor');
    await privateDirectory(directory);
    // 讀取已保存金鑰；正式 admission 不得自行建立另一把金鑰而變更身分。
    const secret = await privateFile(path.join(directory, 'broker-quota-account-hmac.key'), 64);
    if (secret.length !== 32) throw new Error('broker_reset_account_key_invalid');
    try { return brokerStockAccountScopeHash(await json(fetchImpl, 'auth/accounts'), secret); }
    finally { secret.fill(0); }
}

async function json(fetchImpl, endpoint) {
    const response = await fetchImpl(`http://127.0.0.1:8080/api/v1/${endpoint}`, {
        redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.body) throw new Error('broker_reset_api_unavailable');
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > 65536) throw new Error('broker_reset_response_too_large');
            chunks.push(Buffer.from(next.value));
        }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function recordBrokerResetObservation({ root = rootDefault, fetchImpl = fetch,
    now = () => new Date() } = {}) {
    if (!path.isAbsolute(root) || typeof fetchImpl !== 'function' || typeof now !== 'function') {
        throw new TypeError('broker_reset_observation_invalid');
    }
    await privateDirectory(root);
    const directory = path.join(root, 'IntradayMonitor');
    await privateDirectory(directory);
    const mode = (await privateFile(path.join(root, 'runtime-mode'), 64)).toString('utf8').trim();
    const generation = (await privateFile(path.join(root, 'runtime-api-generation'), 256)).toString('utf8').trim();
    if (mode !== 'simulation' || !/^simulation:[A-Za-z0-9._:-]{1,180}$/.test(generation)) {
        throw new Error('broker_reset_simulation_unverified');
    }
    const [info, health, accounts, usage] = await Promise.all([
        json(fetchImpl, 'info'), json(fetchImpl, 'health'),
        json(fetchImpl, 'auth/accounts'), json(fetchImpl, 'auth/usage') ]);
    if (info?.simulation !== true || health?.status !== 'healthy' ||
        ![usage?.bytes, usage?.limit_bytes, usage?.remaining_bytes].every(Number.isSafeInteger) ||
        usage.bytes < 0 || usage.limit_bytes <= 0 || usage.remaining_bytes < 0 ||
        usage.bytes + usage.remaining_bytes !== usage.limit_bytes ||
        (await privateFile(path.join(root, 'runtime-api-generation'), 256)).toString('utf8').trim() !== generation ||
        (await privateFile(path.join(root, 'runtime-mode'), 64)).toString('utf8').trim() !== mode) {
        throw new Error('broker_reset_source_unverified');
    }
    const secret = await accountKey(directory);
    let accountScopeHash;
    try { accountScopeHash = brokerStockAccountScopeHash(accounts, secret); }
    finally { secret.fill(0); }
    const observedAt = now().toISOString();
    const proof = { schemaVersion: 'broker-reset-observation/1', observedAt,
        generation, accountScopeHash, usedBytes: usage.bytes,
        limitBytes: usage.limit_bytes, remainingBytes: usage.remaining_bytes,
        simulation: true, admissionAuthority: false };
    const evidenceHash = sha(proof), output = { ...proof, evidenceHash };
    const evidenceDirectory = path.join(directory, 'broker-quota-reset-observations');
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    await privateDirectory(evidenceDirectory);
    const file = path.join(evidenceDirectory, `${observedAt.replace(/[:.]/g, '-')}-${randomUUID()}.json`);
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(output)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    return { evidenceHash, observedAt, generation, saved: true,
        rawAccountIdentifiersPersisted: false, admissionAuthority: false };
}

/** 限既有私密收據；內容與 hash 不符就拒絕，不在這裡建立來源週期。 */
export async function readBrokerResetObservation({ root = rootDefault, evidenceHash } = {}) {
    if (!path.isAbsolute(root) || !/^[a-f0-9]{64}$/.test(evidenceHash ?? '')) {
        throw new TypeError('broker_reset_evidence_input_invalid');
    }
    await privateDirectory(root);
    const folder = path.join(root, 'IntradayMonitor', 'broker-quota-reset-observations');
    await privateDirectory(folder);
    const names = await readdir(folder);
    if (names.length > 10000 || names.some(name => !/^\d{4}-\d{2}-\d{2}T[0-9Z-]+-[a-f0-9-]{36}\.json$/.test(name))) {
        throw new Error('broker_reset_evidence_directory_invalid');
    }
    let found = null;
    for (const name of names) {
        const value = JSON.parse((await privateFile(path.join(folder, name), 4096)).toString('utf8'));
        const { evidenceHash: savedHash, ...proof } = value;
        if (Object.keys(value).length !== observationKeys.length ||
            Object.keys(value).some(key => !observationKeys.includes(key)) ||
            value.schemaVersion !== 'broker-reset-observation/1' ||
            !Number.isFinite(Date.parse(value.observedAt)) ||
            !/^simulation:[A-Za-z0-9._:-]{1,180}$/.test(value.generation ?? '') ||
            !/^[a-f0-9]{64}$/.test(value.accountScopeHash ?? '') ||
            ![value.usedBytes, value.limitBytes, value.remainingBytes].every(Number.isSafeInteger) ||
            value.usedBytes < 0 || value.limitBytes <= 0 || value.remainingBytes < 0 ||
            value.usedBytes + value.remainingBytes !== value.limitBytes ||
            value.simulation !== true || value.admissionAuthority !== false ||
            savedHash !== sha(proof)) throw new Error('broker_reset_evidence_corrupt');
        if (savedHash === evidenceHash) {
            if (found && JSON.stringify(found) !== JSON.stringify(value)) {
                throw new Error('broker_reset_evidence_duplicate');
            }
            found = Object.freeze(value);
        }
    }
    if (!found) throw new Error('broker_reset_evidence_missing');
    return found;
}

/** 選取前一個官方交易日的最新私密錨點；內容仍交由完整讀回驗證。 */
export async function findPreviousBrokerResetObservation({ root = rootDefault,
    previousTradeDate, resetAt } = {}) {
    if (!path.isAbsolute(root) || !/^\d{4}-\d{2}-\d{2}$/.test(previousTradeDate ?? '') ||
        !(resetAt instanceof Date) || !Number.isFinite(resetAt.valueOf())) {
        throw new TypeError('broker_reset_previous_observation_input_invalid');
    }
    const folder = path.join(root, 'IntradayMonitor', 'broker-quota-reset-observations');
    await privateDirectory(folder);
    const names = await readdir(folder);
    if (names.length > 10000 || names.some(name =>
        !/^\d{4}-\d{2}-\d{2}T[0-9Z-]+-[a-f0-9-]{36}\.json$/.test(name))) {
        throw new Error('broker_reset_evidence_directory_invalid');
    }
    let latest = null;
    for (const name of names) {
        const value = JSON.parse((await privateFile(path.join(folder, name), 4096)).toString('utf8'));
        const observed = Date.parse(value?.observedAt ?? '');
        const localDate = Number.isFinite(observed) ? new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(observed)) : null;
        if (localDate === previousTradeDate && observed < resetAt.valueOf() &&
            (!latest || observed > Date.parse(latest.observedAt))) latest = value;
    }
    return latest ? readBrokerResetObservation({ root, evidenceHash: latest.evidenceHash }) : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length !== 3 || process.argv[2] !== '--observe-only') {
        throw new Error('broker_reset_observation_cli_invalid');
    }
    process.stdout.write(`${JSON.stringify(await recordBrokerResetObservation())}\n`);
}
