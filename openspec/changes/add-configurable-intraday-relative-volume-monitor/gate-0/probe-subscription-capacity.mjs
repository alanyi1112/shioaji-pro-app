import process from 'node:process';

const DIRECT = 'http://127.0.0.1:8080';
const PROXY = 'http://127.0.0.1:5174/local-shioaji';
const mode = process.argv.find((value) => value.startsWith('--mode='))?.slice(7);
const execute = process.argv.includes('--execute');

if (!execute || !['tick-distinct', 'mixed-types'].includes(mode)) {
    console.error(
        'usage: node probe-subscription-capacity.mjs --execute --mode=tick-distinct|mixed-types',
    );
    process.exit(2);
}

async function jsonRequest(base, path, init = {}) {
    const response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
            accept: 'application/json',
            ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = { invalidJson: true };
    }
    return { status: response.status, ok: response.ok, body };
}

async function subscribe(contract, quoteType, base = DIRECT) {
    return jsonRequest(base, '/api/v1/stream/subscribe', {
        method: 'POST',
        body: JSON.stringify({
            security_type: contract.security_type,
            region: 'TW',
            exchange: contract.exchange,
            code: contract.code,
            target_code: null,
            quote_type: quoteType,
            intraday_odd: false,
        }),
    });
}

async function unsubscribe(contract, quoteType, base = DIRECT) {
    return jsonRequest(base, '/api/v1/stream/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({
            security_type: contract.security_type,
            region: 'TW',
            exchange: contract.exchange,
            code: contract.code,
            target_code: null,
            quote_type: quoteType,
            intraday_odd: false,
        }),
    });
}

function accepted(result) {
    return result.ok && result.body?.success === true;
}

function summarize(result) {
    return {
        httpStatus: result.status,
        success: result.body?.success ?? null,
        message: result.body?.message ?? null,
    };
}

const info = await jsonRequest(DIRECT, '/api/v1/info');
if (!info.ok || info.body?.simulation !== true) {
    throw new Error('REFUSED: simulation mode not confirmed');
}
const streamStatus = await jsonRequest(DIRECT, '/api/v1/stream/status');
if (!streamStatus.ok || streamStatus.body?.active_connections !== 0) {
    throw new Error(
        `REFUSED: clean SSE baseline required, active_connections=${String(streamStatus.body?.active_connections)}`,
    );
}
const multiviewHealth = await jsonRequest('http://127.0.0.1:5174', '/api/health');
if (
    !multiviewHealth.ok ||
    multiviewHealth.body?.deploymentTarget !== 'local' ||
    multiviewHealth.body?.shioajiAdapter?.simulationOnly !== true
) {
    throw new Error('REFUSED: local simulation-only MultiView proxy not confirmed');
}

const contractsResponse = await jsonRequest(
    DIRECT,
    '/api/v1/data/contracts?security_type=STK&region=TW',
);
const contracts = (contractsResponse.body?.contracts ?? []).filter(
    (contract) =>
        contract?.security_type === 'STK' &&
        contract?.region === 'TW' &&
        ['TSE', 'OTC'].includes(contract?.exchange) &&
        /^[1-9]\d{3}$/.test(String(contract?.code ?? '')),
);
if (contracts.length < 202) {
    throw new Error(`REFUSED: only ${contracts.length} eligible STK contracts`);
}

const observations = [];
let acceptedUnique = 0;

if (mode === 'tick-distinct') {
    const first = contracts[0];
    const firstResult = await subscribe(first, 'Tick');
    if (!accepted(firstResult)) throw new Error('first Tick subscription failed');
    acceptedUnique += 1;

    const duplicateResult = await subscribe(first, 'Tick');
    observations.push({ step: 'duplicate_same_tick_key', result: summarize(duplicateResult) });

    for (const contract of contracts.slice(1, 200)) {
        const result = await subscribe(contract, 'Tick');
        if (!accepted(result)) {
            observations.push({
                step: 'distinct_tick_failed_before_200',
                code: contract.code,
                acceptedUnique,
                result: summarize(result),
            });
            break;
        }
        acceptedUnique += 1;
    }

    const boundary = await subscribe(contracts[200], 'Tick');
    observations.push({
        step: 'distinct_tick_201_boundary',
        code: contracts[200].code,
        acceptedUnique,
        result: summarize(boundary),
    });

    const proxyRelease = await unsubscribe(first, 'Tick', PROXY);
    observations.push({
        step: 'proxy_unsubscribe_existing_key',
        code: first.code,
        result: summarize(proxyRelease),
    });

    const replacement = await subscribe(contracts[200], 'Tick');
    observations.push({
        step: 'direct_subscribe_after_proxy_release',
        code: contracts[200].code,
        result: summarize(replacement),
    });

    const duplicateRelease = await unsubscribe(first, 'Tick');
    observations.push({
        step: 'duplicate_unsubscribe_removed_key',
        code: first.code,
        result: summarize(duplicateRelease),
    });

    const secondReplacement = await subscribe(contracts[201], 'Tick');
    observations.push({
        step: 'subscribe_after_duplicate_release',
        code: contracts[201].code,
        result: summarize(secondReplacement),
    });
} else {
    const first = contracts[0];
    const firstTick = await subscribe(first, 'Tick');
    if (!accepted(firstTick)) throw new Error('first mixed Tick subscription failed');
    acceptedUnique += 1;

    const duplicateTick = await subscribe(first, 'Tick');
    observations.push({ step: 'duplicate_same_tick_key', result: summarize(duplicateTick) });

    const firstBidAsk = await subscribe(first, 'BidAsk');
    if (!accepted(firstBidAsk)) throw new Error('first BidAsk subscription failed');
    acceptedUnique += 1;

    for (const contract of contracts.slice(1, 100)) {
        for (const quoteType of ['Tick', 'BidAsk']) {
            const result = await subscribe(contract, quoteType);
            if (!accepted(result)) {
                observations.push({
                    step: 'mixed_key_failed_before_200',
                    code: contract.code,
                    quoteType,
                    acceptedUnique,
                    result: summarize(result),
                });
                break;
            }
            acceptedUnique += 1;
        }
        if (observations.at(-1)?.step === 'mixed_key_failed_before_200') break;
    }

    const boundary = await subscribe(contracts[100], 'Tick');
    observations.push({
        step: 'mixed_key_201_boundary',
        code: contracts[100].code,
        acceptedUnique,
        result: summarize(boundary),
    });
}

console.log(
    JSON.stringify(
        {
            schemaVersion: 'subscription-capacity-probe/1',
            mode,
            apiVersion: info.body.version,
            simulation: true,
            cleanBaselineActiveConnections: 0,
            eligibleContractCount: contracts.length,
            acceptedUnique,
            observations,
            requiresCleanSimulationRestart: true,
        },
        null,
        2,
    ),
);
