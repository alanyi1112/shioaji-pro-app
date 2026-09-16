import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { createIntradayMonitorPilotCohortReceiptManifest } from '../../../../scripts/intraday-monitor-runtime/pilot-cohort-receipts.mjs';

const API = 'http://127.0.0.1:8080';
const MONITOR = 'http://127.0.0.1:5173/api/intraday-monitor/v1';
const CONTRACTS_ENDPOINT = `${API}/api/v1/data/contracts?security_type=STK&region=TW`;

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function readJson(fetchImpl, url) {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('local_read_failed');
    return await response.json();
}

export function selectConfiguredPilotCohort(config, limit = 20) {
    if (!config || !Array.isArray(config.items) || !Number.isSafeInteger(config.revision) ||
        !Number.isSafeInteger(limit) || limit !== 20) throw new TypeError('monitor_config_invalid');
    const validated = config.items.map((item) => {
        const contract = item.contract;
        if (contract?.security_type !== 'STK' || contract.region !== 'TW' ||
            !['TSE', 'OTC'].includes(contract.exchange) || !/^\d{4,6}[A-Z]?$/.test(contract.code ?? '') ||
            contract.target_code !== null) throw new TypeError('configured_contract_invalid');
        return { item, contract };
    });
    const cohort = validated.filter(({ item, contract }) => item.enabled === true && /^(?!00)\d{4}$/.test(contract.code))
        .slice(0, limit)
        .map(({ contract }) => `${contract.code}.${contract.exchange === 'TSE' ? 'TW' : 'TWO'}`);
    if (cohort.length !== limit || new Set(cohort).size !== cohort.length) {
        throw new TypeError('exactly_20_enabled_unique_items_required');
    }
    return Object.freeze(cohort);
}

export async function prepareLivePilotCohort({ fetchImpl = fetch, outputPath, verifiedAt = new Date().toISOString() } = {}) {
    if (typeof fetchImpl !== 'function' || typeof outputPath !== 'string' || outputPath.length < 1 ||
        !Number.isFinite(Date.parse(verifiedAt))) throw new TypeError('prepare_options_invalid');
    const info = await readJson(fetchImpl, `${API}/api/v1/info`);
    if (info?.simulation !== true || typeof info.version !== 'string') throw new Error('REFUSED: simulation mode not confirmed');
    const configResponse = await readJson(fetchImpl, `${MONITOR}/config`);
    const config = configResponse?.config;
    const cohort = selectConfiguredPilotCohort(config);
    const contractsResponse = await readJson(fetchImpl, CONTRACTS_ENDPOINT);
    if (!Array.isArray(contractsResponse?.contracts)) throw new Error('REFUSED: local contract export invalid');
    const manifest = createIntradayMonitorPilotCohortReceiptManifest({ requestedSymbols: cohort,
        contracts: contractsResponse.contracts, sourceEndpoint: CONTRACTS_ENDPOINT,
        sourceVersion: info.version, verifiedAt });
    if (manifest.cohort.length !== 20) throw new Error('REFUSED: fixed 20-stock cohort required');
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return Object.freeze({ created: true, outputPath, configRevision: config.revision,
        configuredCount: config.items.length, enabledCount: config.items.filter((item) => item.enabled).length,
        cohort: manifest.cohort, manifestHash: manifest.manifestHash, simulation: true,
        providerRequestAuthority: false, subscriptionTransportAuthority: false,
        serviceLifecycleAuthority: false, brokerWriteAuthority: false });
}

async function main() {
    if (!process.argv.includes('--execute')) {
        throw new Error('usage: --execute --output=PATH [--verified-at=ISO]');
    }
    const result = await prepareLivePilotCohort({ outputPath: argument('output'),
        verifiedAt: argument('verified-at') ?? new Date().toISOString() });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
