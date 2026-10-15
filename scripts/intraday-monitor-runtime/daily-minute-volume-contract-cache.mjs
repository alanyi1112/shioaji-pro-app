import { mkdir, open, readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const DAILY_MINUTE_VOLUME_CONTRACT_CACHE_SCHEMA = 'intraday-minute-volume-contract-cache/1';

function location(root, tradeDate, canonicalSymbol, sourceVersion, connectionGeneration) {
    if (!path.isAbsolute(root ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? '') ||
        !/^\d{4,6}[A-Z]?\.TW(?:O)?$/.test(canonicalSymbol ?? '') ||
        typeof sourceVersion !== 'string' || sourceVersion.length < 1 ||
        !/^simulation:[A-Za-z0-9_-]{16,100}$/.test(connectionGeneration ?? '')) {
        throw new TypeError('daily_contract_cache_identity_invalid');
    }
    const authorityHash = createHash('sha256').update(JSON.stringify({
        sourceVersion, connectionGeneration })).digest('hex');
    return path.join(root, 'IntradayMonitor', 'daily-minute-volume-collection',
        tradeDate, 'contract-cache', `${canonicalSymbol}-${authorityHash}.json`);
}

function identity(value, { entry, tradeDate, sourceVersion, connectionGeneration }) {
    return value?.schemaVersion === DAILY_MINUTE_VOLUME_CONTRACT_CACHE_SCHEMA &&
        value.tradeDate === tradeDate && value.canonicalSymbol === entry.canonicalSymbol &&
        value.exchange === entry.contractIdentity.exchange &&
        value.sourceVersion === sourceVersion &&
        value.connectionGeneration === connectionGeneration &&
        value.identityVerified === true &&
        value.value?.code === entry.contractIdentity.code &&
        value.value?.exchange === entry.contractIdentity.exchange &&
        value.value?.security_type === 'STK' && value.value?.region === 'TW' &&
        value.value?.unit === 1000 && value.value?.trading_suspended === false &&
        value.value?.update_date === tradeDate;
}

export function createDailyMinuteVolumeContractCache(root) {
    async function readCachedContract({ entry, sourceDate, sourceVersion, connectionGeneration }) {
        const file = location(root, sourceDate, entry.canonicalSymbol,
            sourceVersion, connectionGeneration);
        let metadata;
        try { metadata = await lstat(file); }
        catch (error) {
            if (error?.code === 'ENOENT') return null;
            throw error;
        }
        if (!metadata.isFile() || metadata.isSymbolicLink() ||
            metadata.uid !== process.getuid() || metadata.mode & 0o077 ||
            metadata.size < 2 || metadata.size > 4096 ||
            await realpath(file) !== path.join(await realpath(root),
                path.relative(root, file))) {
            throw new Error('daily_contract_cache_file_invalid');
        }
        const value = JSON.parse(await readFile(file, 'utf8'));
        // A prior source/generation is not a current contract authority. Do not reuse it.
        return identity(value, { entry, tradeDate: sourceDate, sourceVersion,
            connectionGeneration }) ? value : null;
    }

    async function writeCachedContract({ entry, tradeDate, sourceVersion,
        connectionGeneration, value }) {
        const file = location(root, tradeDate, entry.canonicalSymbol,
            sourceVersion, connectionGeneration);
        const document = { schemaVersion: DAILY_MINUTE_VOLUME_CONTRACT_CACHE_SCHEMA,
            canonicalSymbol: entry.canonicalSymbol, exchange: entry.contractIdentity.exchange,
            tradeDate, sourceVersion, connectionGeneration, identityVerified: true,
            value: { code: value?.code, exchange: value?.exchange,
                security_type: value?.security_type, region: value?.region,
                unit: value?.unit, trading_suspended: value?.trading_suspended,
                update_date: value?.update_date } };
        if (!identity(document, { entry, tradeDate, sourceVersion, connectionGeneration })) {
            throw new Error('daily_contract_cache_source_invalid');
        }
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        let handle;
        try { handle = await open(file, 'wx', 0o600); }
        catch (error) {
            if (error?.code !== 'EEXIST') throw error;
            const cached = await readCachedContract({ entry, sourceDate: tradeDate,
                sourceVersion, connectionGeneration });
            if (!cached || JSON.stringify(cached.value) !== JSON.stringify(document.value)) {
                throw new Error('daily_contract_cache_conflict');
            }
            return cached;
        }
        try { await handle.writeFile(`${JSON.stringify(document)}\n`); await handle.sync(); }
        finally { await handle.close(); }
        return document;
    }
    return Object.freeze({ readCachedContract, writeCachedContract });
}
