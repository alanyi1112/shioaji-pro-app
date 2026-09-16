import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { INTRADAY_MONITOR_KBAR_SHADOW_EVIDENCE_MAXIMUM_BYTES } from './kbar-shadow-session-recorder.mjs';
import {
    createIntradayMonitorFunctionalAcceptanceBundle,
    createIntradayMonitorPilotBundleFromCaptures,
    validateIntradayMonitorFunctionalAcceptanceBundle,
    validateIntradayMonitorBoundedKbarCapture,
} from './pilot-acceptance-bundle.mjs';
import {
    HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
    computeHistoricalKbarPayloadHash,
    validateAndBuildHistoricalKbarBaseline,
} from './historical-kbar-repair.mjs';
import { createIntradayMonitorPilotStagePlan, validateIntradayMonitorPilotEvidenceBundle } from './pilot-shadow-evidence.mjs';
import { createIntradayMonitorPilotRuntimeAssurance } from './pilot-runtime-assurance.mjs';

const H = 'a'.repeat(64);
const SYMBOLS = ['2330.TW', '2454.TW'];
const execFileAsync = promisify(execFile);

function digest(value) {
    return createHash('sha256').update(canonicalJson(value, {
        maximumBytes: INTRADAY_MONITOR_KBAR_SHADOW_EVIDENCE_MAXIMUM_BYTES,
    })).digest('hex');
}

function plan(symbols = SYMBOLS) {
    return createIntradayMonitorPilotStagePlan({
        stage: 20,
        cohort: symbols,
        cohortReceiptManifestHash: H,
        minimumActiveMonitorCount: symbols.length,
        resourceBudgets: {
            maxCpuBasisPoints: 2_500,
            maxRssBytes: 268_435_456,
            maxDatabaseGrowthBytes: 33_554_432,
            maxSseLatencyMs: 10_000,
            maxChartFreshnessMs: 10_000,
        },
        createdAt: '2026-09-07T08:50:00+08:00',
    });
}

function minutes() {
    const output = [];
    for (let minute = 9 * 60 + 1; minute <= 13 * 60 + 30; minute += 1) {
        output.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
    }
    return output;
}

function capture(tradeDate, multiplier, closeTime = '13:34:30', cohort = SYMBOLS) {
    const symbols = cohort.map((canonicalSymbol) => ({
        canonicalSymbol,
        closeMode: 'normal_or_revised_13_30',
        complete: true,
        minuteCount: 270,
        firstMinute: '09:01',
        lastMinute: '13:30',
        rows: minutes().map((minuteKey, index) => ({
            canonicalSymbol,
            minuteKey,
            cumulativeVolume: (index + 1) * multiplier,
            sequence: index + 1,
            receivedTime: `${tradeDate}T${minuteKey}:30+08:00`,
            sourceVersion: 'shioaji-http-1.7.1',
            unit: 'common_lot',
            completeness: 'complete',
        })),
    }));
    const sessionSeed = {
        schemaVersion: 'intraday-monitor-kbar-shadow-session/1',
        tradeDate,
        startedAt: `${tradeDate}T08:55:00+08:00`,
        endedAt: `${tradeDate}T${closeTime}+08:00`,
        connectionGeneration: `kbar_generation_${tradeDate.replaceAll('-', '')}`,
        cohort,
        cohortHash: `sha256:${H}`,
        expectedMinuteCountPerSymbol: 270,
        symbols,
        close: { attempted: true, accepted: true, sealedCount: cohort.length, expectedCount: cohort.length,
            normalCloseMinute: '13:30', delayedCloseMinute: '13:33',
            finalizedAt: `${tradeDate}T${closeTime}+08:00` },
        adapter: { rejectionCounts: {}, sinkRejections: 0, providerPhysicalUsage: null },
        assessment: { fullSession: true, baselineEligible: true, notificationEligible: false, note: 'complete' },
        operations: {
            notificationDispatchCount: 0,
            brokerWriteAttemptCount: 0,
            productionTransitionCount: 0,
            serviceLifecycleMutationCount: 0,
            pollingFallback: false,
            rawPayloadSaved: false,
        },
    };
    const session = { ...sessionSeed, evidenceHash: `sha256:${digest(sessionSeed)}` };
    return {
        schemaVersion: 'intraday-monitor-bounded-kbar-capture/1',
        captureMode: 'full-session',
        cohortReceiptManifestHash: H,
        session,
        transport: {
            startReceipt: { subscribeAccepted: true, providerPhysicalUsage: null },
            stopReceipt: { unsubscribeAccepted: true, providerReleaseProven: false },
        },
        rehearsal: {
            formalAcceptanceEvidence: true,
            baselineEligible: true,
            notificationAuthority: false,
            kbarLatencyMs: { p95: 2_500 },
            resources: {
                cpuBasisPoints: 25,
                maxRssBytes: 64_000_000,
                evidenceDatabaseWrites: 0,
                evidenceDatabaseGrowthBytes: 0,
            },
        },
        interrupted: false,
    };
}

function assurance(tradeDate, previousTradeDate) {
    return createIntradayMonitorPilotRuntimeAssurance({
        tradeDate,
        previousTradeDate,
        observedAt: `${tradeDate}T10:00:00+08:00`,
        simulation: true,
        chart: {
            canonicalSymbol: '2330.TW', sourceUrl: 'http://127.0.0.1:5173/',
            firstObservedAt: `${tradeDate}T09:59:59+08:00`, lastObservedAt: `${tradeDate}T10:00:00+08:00`,
            freshnessMs: 1_000, canvasCount: 7, canvasWidth: 900, canvasHeight: 500,
            beforeSha256: H, afterSha256: H, changed: true,
        },
        reconnect: {
            transport: 'intraday-monitor-trigger-sse', attempted: true, recovered: true,
            clientGenerationBefore: `probe_before_${tradeDate.replaceAll('-', '')}`,
            clientGenerationAfter: `probe_after_${tradeDate.replaceAll('-', '')}`,
            generationAdvanced: true, serverGenerationBefore: 'server_generation',
            serverGenerationAfter: 'server_generation', cursorBefore: 'cursor-0', cursorAfter: 'cursor-0',
            cursorPreserved: true, oldConnectionClosed: true, replayedEventCount: 0,
            duplicateNotificationCount: 0,
        },
        existingFeatures: {
            chartFresh: true, watchlistHealthy: true, alertHealthy: true,
            smartOrderHealthy: true, simulationRuntimeHealthy: true,
        },
        regressionEvidenceRefs: [{ path: 'acceptance/regression.md', sha256: H }],
        operations: {
            methods: ['GET'], subscriptionMutations: 0, notificationDispatches: 0,
            brokerWrites: 0, productionTransitions: 0, serviceLifecycleMutations: 0,
        },
    });
}

function historicalBaselineManifests(cohort = SYMBOLS) {
    return cohort.map((symbol) => {
        const exchange = symbol.endsWith('.TWO') ? 'OTC' : 'TSE';
        const arrays = {
            datetime: minutes().map((minuteKey) =>
                `2026-09-10T${minuteKey}:00+08:00`),
            Open: minutes().map(() => 100),
            High: minutes().map(() => 101),
            Low: minutes().map(() => 99),
            Close: minutes().map(() => 100),
            Volume: minutes().map(() => 10),
            Amount: minutes().map(() => 1_000),
        };
        const first = {
            schemaVersion: HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
            symbol,
            exchange,
            securityType: 'STK',
            tradeDate: '2026-09-10',
            timeZone: 'Asia/Taipei',
            source: 'fixture-history',
            sourceVersion: 'fixture-history/1',
            fetchedAt: '2026-09-10T13:35:00+08:00',
            sourceUnit: 'common_lot',
            canonicalUnit: 'common_lot',
            volumeSemantics: 'minute_delta',
            closeEncoding: 'normal_13_30',
            arrays,
            knownZeroMinutes: [],
            previousClose: 100,
        };
        const candidate = {
            ...first,
            payloadHash: computeHistoricalKbarPayloadHash(first),
        };
        const second = { ...candidate, fetchedAt: '2026-09-10T13:36:00+08:00' };
        const refetchCandidate = {
            ...second,
            payloadHash: computeHistoricalKbarPayloadHash(second),
        };
        const result = validateAndBuildHistoricalKbarBaseline({
            authority: {
                officialTradingDay: true,
                identityVerified: true,
                instrumentStatus: 'normal',
                symbol,
                exchange,
                securityType: 'STK',
                tradeDate: '2026-09-10',
                timeZone: 'Asia/Taipei',
                targetTradeDate: '2026-09-11',
                previousApplicableTradeDate: '2026-09-10',
                calendarVerified: true,
                calendarSource: 'fixture-calendar',
                calendarSourceVersion: 'fixture-calendar/1',
            },
            finalVolumeAuthority: {
                status: 'verified',
                sessionScope: 'regular_session',
                unit: 'common_lot',
                volumeCommonLot: 2_700,
                symbol,
                exchange,
                tradeDate: '2026-09-10',
                source: 'fixture-close',
                sourceVersion: 'fixture-close/1',
            },
            candidate,
            refetchCandidate,
            cohortHash: `sha256:${H}`,
            now: '2026-09-10T13:36:30+08:00',
        });
        if (!result.ok) throw new Error(result.reasonCodes.join(','));
        return result.manifest;
    });
}

describe('完整日 capture 到 pilot bundle', () => {
    it('CLI 可用前日 live baseline 與單一完整日建立並驗證功能 bundle', async () => {
        const temporaryDirectory = await mkdtemp(
            path.join(os.tmpdir(), 'intraday-functional-bundle-'),
        );
        const builderPath = path.resolve(
            import.meta.dirname,
            '../../openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/build-pilot-evidence-bundle.mjs',
        );
        const verifierPath = path.resolve(
            import.meta.dirname,
            '../../openspec/changes/add-configurable-intraday-relative-volume-monitor/acceptance/verify-pilot-evidence.mjs',
        );
        const paths = Object.fromEntries(
            ['plan', 'baseline', 'capture', 'assurance', 'output'].map((name) => [
                name,
                path.join(temporaryDirectory, `${name}.json`),
            ]),
        );
        try {
            await Promise.all([
                writeFile(paths.plan, JSON.stringify(plan())),
                writeFile(paths.baseline, JSON.stringify(capture('2026-09-10', 10))),
                writeFile(paths.capture, JSON.stringify(capture('2026-09-11', 20))),
                writeFile(paths.assurance, JSON.stringify(assurance('2026-09-11', '2026-09-10'))),
            ]);
            const built = await execFileAsync(process.execPath, [
                builderPath,
                '--execute',
                `--plan=${paths.plan}`,
                `--baseline-capture=${paths.baseline}`,
                `--capture=${paths.capture}`,
                `--assurance=${paths.assurance}`,
                '--gate-evidence=gate-0/kbar-batch-alternative-decision-2026-09-07.md',
                '--config-revision=3',
                '--threshold=2',
                '--calendar-source-version=fixture-calendar-2026',
                `--output=${paths.output}`,
            ]);
            expect(JSON.parse(built.stdout)).toMatchObject({
                created: true,
                valid: true,
                readyForHumanReview: true,
                metrics: {
                    completeTradingDays: 1,
                    baselineProvenance: 'live_full_session_verified',
                },
            });
            const persisted = JSON.parse(await readFile(paths.output, 'utf8'));
            expect(persisted.schemaVersion).toBe(
                'intraday-monitor-functional-acceptance-bundle/1',
            );
            const verified = await execFileAsync(process.execPath, [
                verifierPath,
                paths.output,
            ]);
            expect(JSON.parse(verified.stdout)).toMatchObject({
                valid: true,
                readyForHumanReview: true,
                metrics: { completeTradingDays: 1 },
            });
        } finally {
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    });

    it('可在 bundle 組裝前獨立驗證完整日 capture', () => {
        expect(validateIntradayMonitorBoundedKbarCapture(capture('2026-09-08', 10), plan())).toMatchObject({
            valid: true,
            reasons: [],
            tradeDate: '2026-09-08',
            cohortSize: 2,
            completeSymbolCount: 2,
            expectedMinuteCountPerSymbol: 270,
            fullSession: true,
            baselineEligible: true,
        });
        expect(validateIntradayMonitorBoundedKbarCapture({
            ...capture('2026-09-08', 10),
            captureMode: 'partial-rehearsal',
        }, plan())).toMatchObject({
            valid: false,
            reasons: ['invalid_full_session_capture'],
        });
        expect(validateIntradayMonitorBoundedKbarCapture(capture('2026-09-08', 10, '13:31:00'), plan()))
            .toMatchObject({ valid: false, reasons: ['invalid_full_session_capture'] });
    });

    it('完整 20 × 270 evidence 超過通用 1 MiB 時 validator 仍能重算相同 hash', () => {
        const cohort = Array.from({ length: 20 }, (_, index) => `${String(1000 + index)}.TW`);
        const value = capture('2026-09-10', 10, '13:34:30', cohort);
        const { evidenceHash: _evidenceHash, ...seed } = value.session;
        expect(() => canonicalJson(seed)).toThrow('canonical JSON exceeds its byte limit');
        expect(validateIntradayMonitorBoundedKbarCapture(value, plan(cohort))).toMatchObject({
            valid: true,
            cohortSize: 20,
            completeSymbolCount: 20,
            expectedMinuteCountPerSymbol: 270,
        });
    });

    it('兩個完整 20 × 270 capture 可完成 deterministic replay 與 bundle 組裝', () => {
        const cohort = Array.from({ length: 20 }, (_, index) => `${String(1000 + index)}.TW`);
        const value = createIntradayMonitorPilotBundleFromCaptures({
            plan: plan(cohort),
            captures: [capture('2026-09-10', 10, '13:34:30', cohort),
                capture('2026-09-11', 20, '13:34:30', cohort)],
            assurances: [assurance('2026-09-10', '2026-09-09'), assurance('2026-09-11', '2026-09-10')],
            gateEvidenceSha256: H, configRevision: 3, threshold: '1.5',
            calendarSourceVersion: 'twse-tpex-calendar-2026', createdAt: '2026-09-11T14:00:00+08:00',
        });
        expect(validateIntradayMonitorPilotEvidenceBundle(value)).toMatchObject({
            valid: true,
            readyForHumanReview: true,
            metrics: { completeTradingDays: 2 },
        });
        expect(value.sessions[0].replay.triggerCount).toBe(0);
        expect(value.sessions[1].replay.triggerCount).toBe(20);
    });

    it('兩日逐分鐘重播後產生可供人工審閱且 physical usage 保持 unknown 的 bundle', () => {
        const value = createIntradayMonitorPilotBundleFromCaptures({
            plan: plan(),
            captures: [capture('2026-09-08', 10), capture('2026-09-09', 20)],
            assurances: [assurance('2026-09-08', '2026-09-07'), assurance('2026-09-09', '2026-09-08')],
            gateEvidenceSha256: H,
            configRevision: 3,
            threshold: '1.5',
            calendarSourceVersion: 'twse-tpex-calendar-2026',
            createdAt: '2026-09-09T14:00:00+08:00',
        });
        const result = validateIntradayMonitorPilotEvidenceBundle(value);
        expect(result).toMatchObject({
            valid: true,
            readyForHumanReview: true,
            reasons: [],
            metrics: { completeTradingDays: 2, providerPhysicalUsage: null, providerHeadroom: null },
        });
        expect(value.sessions[0].replay.triggerCount).toBe(0);
        expect(value.sessions[1].replay.triggerCount).toBe(2);
        expect(value.sessions[1].samples[0]).toMatchObject({
            globalOwnershipComplete: null,
            confirmedPhysicalUsage: null,
            confirmedOtherPhysicalUsage: null,
            headroom: null,
            notificationDispatchCount: 0,
        });
    });

    it('拒絕 partial、cohort 不一致或未 ready 的 runtime assurance', () => {
        const partial = { ...capture('2026-09-08', 10), captureMode: 'partial-rehearsal' };
        expect(() => createIntradayMonitorPilotBundleFromCaptures({
            plan: plan(), captures: [partial], assurances: [assurance('2026-09-08', '2026-09-07')],
            gateEvidenceSha256: H, configRevision: 3, threshold: '1.5',
            calendarSourceVersion: 'calendar-v1', createdAt: '2026-09-08T14:00:00+08:00',
        })).toThrow(/capture/);
    });

    it('以 9/10 完整 live baseline 加 9/11 單一完整盤中日即可進入人工審閱', () => {
        const cohort = Array.from({ length: 20 }, (_, index) =>
            `${String(1000 + index)}.TW`);
        const value = createIntradayMonitorFunctionalAcceptanceBundle({
            plan: plan(cohort),
            baselineCapture: capture('2026-09-10', 10, '13:34:30', cohort),
            capture: capture('2026-09-11', 20, '13:34:30', cohort),
            assurance: assurance('2026-09-11', '2026-09-10'),
            gateEvidenceSha256: H,
            configRevision: 3,
            threshold: '1.5',
            calendarSourceVersion: 'twse-tpex-calendar-2026',
            createdAt: '2026-09-11T14:00:00+08:00',
        });
        expect(validateIntradayMonitorFunctionalAcceptanceBundle(value)).toMatchObject({
            valid: true,
            readyForHumanReview: true,
            reasons: [],
            metrics: {
                completeTradingDays: 1,
                baselineProvenance: 'live_full_session_verified',
                baselineTradeDate: '2026-09-10',
                liveTradeDate: '2026-09-11',
                stabilityFollowUpRequired: false,
                triggerCount: 20,
            },
        });
    });

    it('也接受同 cohort 的 historical_baseline_verified manifests', () => {
        const value = createIntradayMonitorFunctionalAcceptanceBundle({
            plan: plan(),
            historicalBaselineManifests: historicalBaselineManifests(),
            capture: capture('2026-09-11', 20),
            assurance: assurance('2026-09-11', '2026-09-10'),
            gateEvidenceSha256: H,
            configRevision: 3,
            threshold: '1.5',
            calendarSourceVersion: 'twse-tpex-calendar-2026',
            createdAt: '2026-09-11T14:00:00+08:00',
        });
        expect(validateIntradayMonitorFunctionalAcceptanceBundle(value)).toMatchObject({
            readyForHumanReview: true,
            metrics: {
                baselineProvenance: 'historical_baseline_verified',
                triggerCount: 2,
            },
        });
    });

    it('拒絕 assurance 前日不符或 bundle 內容被竄改', () => {
        expect(() => createIntradayMonitorFunctionalAcceptanceBundle({
            plan: plan(),
            baselineCapture: capture('2026-09-10', 10),
            capture: capture('2026-09-11', 20),
            assurance: assurance('2026-09-11', '2026-09-09'),
            gateEvidenceSha256: H,
            configRevision: 3,
            threshold: '1.5',
            calendarSourceVersion: 'calendar-v1',
            createdAt: '2026-09-11T14:00:00+08:00',
        })).toThrow(/functional/);

        const value = createIntradayMonitorFunctionalAcceptanceBundle({
            plan: plan(),
            baselineCapture: capture('2026-09-10', 10),
            capture: capture('2026-09-11', 20),
            assurance: assurance('2026-09-11', '2026-09-10'),
            gateEvidenceSha256: H,
            configRevision: 3,
            threshold: '1.5',
            calendarSourceVersion: 'calendar-v1',
            createdAt: '2026-09-11T14:00:00+08:00',
        });
        expect(validateIntradayMonitorFunctionalAcceptanceBundle({
            ...value,
            stabilityFollowUpRequired: true,
        })).toMatchObject({
            valid: false,
            readyForHumanReview: false,
        });
    });
});
