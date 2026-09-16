import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { createTieredCohortManifests } from '../../../../scripts/intraday-monitor-runtime/tiered-capacity-stage-artifacts.mjs';

const API = 'http://127.0.0.1:8080';
const MONITOR = 'http://127.0.0.1:5173/api/intraday-monitor/v1';
const CONTRACTS_ENDPOINT = `${API}/api/v1/data/contracts?security_type=STK&region=TW`;

function argument(name) {
    return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function getJson(fetchImpl, url) {
    const response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`local_read_failed:${response.status}`);
    return await response.json();
}

export async function prepareTieredCohorts({
    fetchImpl = fetch,
    outputDirectory,
    createdAt = new Date().toISOString(),
} = {}) {
    if (typeof fetchImpl !== 'function' || typeof outputDirectory !== 'string' ||
        outputDirectory.length < 1 || !Number.isFinite(Date.parse(createdAt))) {
        throw new TypeError('prepare options invalid');
    }
    const [info, configResponse, contractsResponse] = await Promise.all([
        getJson(fetchImpl, `${API}/api/v1/info`),
        getJson(fetchImpl, `${MONITOR}/config`),
        getJson(fetchImpl, CONTRACTS_ENDPOINT),
    ]);
    if (info?.simulation !== true || info?.production === true || typeof info?.version !== 'string') {
        throw new Error('REFUSED: simulation boundary not confirmed');
    }
    const manifests = createTieredCohortManifests({
        config: configResponse?.config,
        contracts: contractsResponse?.contracts,
        sourceVersion: info.version,
        createdAt,
    });
    const outputs = [50, 100, 160].map((stage) => ({
        stage,
        path: path.join(outputDirectory, `tiered-cohort-stage-${stage}.json`),
        manifest: manifests[stage],
    }));
    await mkdir(outputDirectory, { recursive: true });
    for (const output of outputs) {
        try {
            await access(output.path);
            throw new Error(`REFUSED: output exists: ${output.path}`);
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
    }
    for (const output of outputs) {
        await writeFile(output.path, `${JSON.stringify(output.manifest, null, 2)}\n`, {
            encoding: 'utf8', flag: 'wx', mode: 0o600,
        });
    }
    return Object.freeze({
        created: true,
        configRevision: configResponse.config.revision,
        configuredCount: configResponse.config.items.length,
        stages: outputs.map(({ stage, path: outputPath, manifest }) => ({
            stage, outputPath, manifestHash: manifest.manifestHash,
            firstSymbol: manifest.cohort[0].canonicalSymbol,
            lastSymbol: manifest.cohort.at(-1).canonicalSymbol,
        })),
        simulation: true,
        networkWrites: 0,
        subscriptionMutations: 0,
        brokerWrites: 0,
        productionTransitions: 0,
        serviceLifecycleMutations: 0,
    });
}

async function main() {
    if (!process.argv.includes('--execute') || !argument('output-directory')) {
        throw new Error('usage: --execute --output-directory=/ABS/PATH [--created-at=ISO]');
    }
    const result = await prepareTieredCohorts({
        outputDirectory: argument('output-directory'),
        createdAt: argument('created-at') ?? new Date().toISOString(),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
