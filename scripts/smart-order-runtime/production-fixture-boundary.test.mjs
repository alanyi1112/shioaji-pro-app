import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
);

async function productionSourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (
            entry.name === 'node_modules' ||
            entry.name === 'dist' ||
            entry.name.startsWith('.')
        ) {
            continue;
        }
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await productionSourceFiles(absolutePath)));
            continue;
        }
        if (
            /\.(?:mjs|js|ts|tsx)$/.test(entry.name) &&
            !/\.(?:test|spec)\.[^.]+$/.test(entry.name)
        ) {
            files.push(absolutePath);
        }
    }
    return files;
}

function relative(filePath) {
    return path.relative(repositoryRoot, filePath);
}

describe('production smart-order fixture boundary', () => {
    it('實際 Runtime construction 無 broker/quote fixture 注入口且 Node-safe adapter 維持 Gate-closed', async () => {
        const controllerPath = path.join(
            repositoryRoot,
            'scripts/smart-order-runtime/runtime-controller.mjs',
        );
        const source = await readFile(controllerPath, 'utf8');
        const parameters = source.match(
            /export async function startSmartOrderRuntimeController\(\{([\s\S]*?)\n\}\)/,
        )?.[1];

        expect(parameters).toBeTruthy();
        expect(parameters).not.toMatch(
            /adapter|broker|quote|marketData|fixture|execute/i,
        );
        expect(source).toContain(
            'createProductionNodeSafeSmartOrderBrokerAdapter({',
        );
        expect(source).toMatch(
            /createSmartOrderBrokerDispatchCoordinator\(\{\s*repository,\s*adapter: brokerAdapter,\s*resourceCoordinator: runtimeResourceCoordinator,\s*revalidateRuntimeAuthorityImmediatelyBeforeTransport:\s*\(envelope\)\s*=>\s*officialMarketCalendarAuthority\.assertDispatchEnvelope\(\s*envelope,?\s*\),\s*\}\)/,
        );
        expect(source).toMatch(
            /officialMarketCalendarAuthority\s*=\s*createSmartOrderOfficialMarketCalendarAuthority\(\)/,
        );
        expect(source).toContain(
            'runtime controller official market calendar authority is invalid',
        );
        const calendarAuthoritySource = await readFile(
            path.join(
                repositoryRoot,
                'scripts/smart-order-runtime/official-market-calendar-authority.mjs',
            ),
            'utf8',
        );
        expect(calendarAuthoritySource).not.toContain('...authority');
        expect(calendarAuthoritySource).toMatch(
            /const issued = Object\.freeze\(\{[\s\S]*?status: authority\.status,[\s\S]*?assertDispatchEnvelope: authority\.assertDispatchEnvelope,[\s\S]*?\}\);/,
        );
        expect(calendarAuthoritySource).toContain(
            'isTrustedSmartOrderQuickConditionObservation(observation)',
        );
        expect(calendarAuthoritySource).toContain(
            'isTrustedSmartOrderProtectiveQuoteObservation(observation)',
        );
        expect(source).toContain(
            'admitSmartOrderOfficialMarketQuoteObservation(',
        );
        const observerSource = await readFile(
            path.join(
                repositoryRoot,
                'scripts/smart-order-runtime/shioaji-trade-observer.mjs',
            ),
            'utf8',
        );
        expect(observerSource).toContain(
            "from './canonical-stock-unit-contract.mjs'",
        );
        expect(observerSource).toContain(
            'parseSmartOrderCanonicalStockContractMetadata(response, {',
        );
        expect(observerSource).toContain('smartOrderCommonLotsToShares(');
        expect(observerSource).not.toMatch(
            /(?:quantity|filled|cancelled)Lots\s*\*\s*1_000/,
        );
        const positionSnapshotIndex = observerSource.indexOf(
            'const positionSnapshots = positionsResponse.map',
        );
        const positionDataPropertiesIndex = observerSource.indexOf(
            'dataProperties(\n            rawPosition,',
            positionSnapshotIndex,
        );
        const positionDirectionFilterIndex = observerSource.indexOf(
            ".filter(({ position }) => position.direction === 'Buy')",
            positionSnapshotIndex,
        );
        expect(positionSnapshotIndex).toBeGreaterThan(-1);
        expect(positionDataPropertiesIndex).toBeGreaterThan(
            positionSnapshotIndex,
        );
        expect(positionDirectionFilterIndex).toBeGreaterThan(
            positionDataPropertiesIndex,
        );
        expect(observerSource).not.toMatch(
            /positionsResponse\s*\.filter\([^)]*\.direction/,
        );
        const accountSnapshotBeforeIndex = observerSource.indexOf(
            'const accountSnapshotBefore = await readAccountSnapshot();',
        );
        const metadataBeforeIndex = observerSource.indexOf(
            'const metadataBefore = await readContractMetadata(',
            accountSnapshotBeforeIndex,
        );
        const accountSnapshotMiddleIndex = observerSource.indexOf(
            'const accountSnapshotMiddle = await readAccountSnapshot();',
            metadataBeforeIndex,
        );
        const metadataAfterIndex = observerSource.indexOf(
            'const metadataAfter = await readContractMetadata(',
            accountSnapshotMiddleIndex,
        );
        const accountSnapshotAfterIndex = observerSource.indexOf(
            'const accountSnapshotAfter = await readAccountSnapshot();',
            metadataAfterIndex,
        );
        const reconciliationProjectionIndex = observerSource.indexOf(
            'const snapshot = projectAccountReconciliationSnapshot({',
            accountSnapshotAfterIndex,
        );
        expect(accountSnapshotBeforeIndex).toBeGreaterThan(-1);
        expect(metadataBeforeIndex).toBeGreaterThan(accountSnapshotBeforeIndex);
        expect(accountSnapshotMiddleIndex).toBeGreaterThan(metadataBeforeIndex);
        expect(metadataAfterIndex).toBeGreaterThan(accountSnapshotMiddleIndex);
        expect(accountSnapshotAfterIndex).toBeGreaterThan(metadataAfterIndex);
        expect(reconciliationProjectionIndex).toBeGreaterThan(
            accountSnapshotAfterIndex,
        );
        expect(observerSource).toMatch(
            /const positionsResponse = await requestJson\([\s\S]*?ENDPOINTS\.positions,[\s\S]*?unit: 'Share'/,
        );
        expect(observerSource).toContain(
            'account reconciliation source changed during its bounded read window',
        );
        expect(observerSource).toContain(
            'account reconciliation metadata freshness expired during its bounded read window',
        );
        expect(observerSource).toMatch(
            /projectAccountReconciliationSnapshot\(\{[\s\S]*?positionsResponse: accountSnapshotMiddle\.positionsResponse,[\s\S]*?tradesResponse: accountSnapshotMiddle\.tradesResponse,[\s\S]*?updateStatusResponse: accountSnapshotMiddle\.updateStatusResponse/,
        );
        expect(source).toMatch(
            /createProductionNodeSafeSmartOrderBrokerAdapter\(\{[\s\S]*?resourceCoordinator: runtimeResourceCoordinator,[\s\S]*?\}\)/,
        );
        expect(source).toMatch(
            /runManagedSmartOrderReadonlyGateRunner\(\{\s*appSupportRoot,\s*resourceCoordinator: runtimeResourceCoordinator,\s*\.\.\.\(externalOrderEventObservation[\s\S]*?\? \{ externalOrderEventObservation: true \}[\s\S]*?: \{\}\),\s*\}\)/,
        );
        expect(source).toMatch(
            /const verificationNowEpochMs = epoch\([\s\S]*?run\.verificationNowEpochMs[\s\S]*?storeGateManifestBatch[\s\S]*?nowEpochMs: verificationNowEpochMs/,
        );
        expect(source).not.toMatch(/contractCapability\s*:/);
        const adapterSource = await readFile(
            path.join(
                repositoryRoot,
                'scripts/smart-order-runtime/node-safe-broker-adapter.mjs',
            ),
            'utf8',
        );
        expect(adapterSource).toContain(
            'acquireSmartOrderBrokerDispatchTransportOperation(authority)',
        );
        expect(adapterSource).toMatch(
            /await acquireResourceTransportOperation\(\);[\s\S]*?globalThis\.fetch\(/,
        );
        const modeAdmissionSource = await readFile(
            path.join(
                repositoryRoot,
                'scripts/smart-order-runtime/mode-write-admission.mjs',
            ),
            'utf8',
        );
        expect(modeAdmissionSource).toMatch(
            /await resourceCoordinator\.acquireOperationUnit\(\{ operationId \}\);[\s\S]*?globalThis\.fetch\(/,
        );
        const probeSource = await readFile(
            path.join(repositoryRoot, 'scripts/smart-order-contract-probe.mjs'),
            'utf8',
        );
        expect(probeSource).toMatch(
            /await resourceCoordinator\.acquireOperationUnit\(\{[\s\S]*?operationId: grant\.operationId,[\s\S]*?\}\);[\s\S]*?return await execute\(\);/,
        );
    });

    it('test fixture 與可成功 fenced adapter 沒有任何 production caller', async () => {
        const roots = [
            path.join(repositoryRoot, 'scripts'),
            path.join(repositoryRoot, 'src'),
        ];
        const files = (
            await Promise.all(roots.map(productionSourceFiles))
        ).flat();
        const fixtureImports = [];
        const fencedAdapterReferences = [];

        for (const filePath of files) {
            const source = await readFile(filePath, 'utf8');
            if (/from\s+['"][^'"]*fixtures[^'"]*['"]/.test(source)) {
                fixtureImports.push(relative(filePath));
            }
            if (source.includes('createFencedSmartOrderBrokerAdapter')) {
                fencedAdapterReferences.push(relative(filePath));
            }
        }

        expect(fixtureImports).toEqual([]);
        expect(fencedAdapterReferences).toEqual([
            'scripts/smart-order-runtime/broker-dispatch-coordinator.mjs',
            'scripts/smart-order-runtime/node-safe-broker-adapter.mjs',
        ]);
    });

    it('sidecar production chain 沒有 fixture、假 acknowledgement 或可注入 adapter', async () => {
        for (const relativePath of [
            'scripts/smart-order-runtime/sidecar-entry.mjs',
            'scripts/smart-order-runtime/local-sidecar.mjs',
            'scripts/smart-order-runtime/runtime-controller.mjs',
        ]) {
            const source = await readFile(
                path.join(repositoryRoot, relativePath),
                'utf8',
            );
            expect(source).not.toMatch(
                /canonical-strategy-draft-fixtures|fake[_ -]?(?:quote|broker|ack)|fixtureAdapter|quoteSource/i,
            );
        }
    });
});
