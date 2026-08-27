import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY,
    SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
    SMART_ORDER_RUNTIME_GAP_POLICY_VERSION,
    createSmartOrderRuntimeGapDetector,
} from './runtime-gap-detector.mjs';

const RAW_API_GENERATION = 'simulation:private-api-generation';

function detector(overrides = {}) {
    return createSmartOrderRuntimeGapDetector({
        apiGeneration: RAW_API_GENERATION,
        observedWallTimeMs: 1_000_000,
        observedMonotonicTimeMs: 10_000,
        ...overrides,
    });
}

describe('private smart-order runtime gap detector facade', () => {
    it('mints fixed policy state inside a frozen and sanitized facade', () => {
        const current = detector();
        expect(Object.isFrozen(current)).toBe(true);
        expect(current.status()).toMatchObject({
            schemaVersion: SMART_ORDER_RUNTIME_GAP_DETECTOR_SCHEMA_VERSION,
            policyVersion: SMART_ORDER_RUNTIME_GAP_POLICY_VERSION,
            policySha256:
                DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY.policySha256,
            sseContinuityAuthority: 'critical_transport_lifecycle_only',
            observationRevision: 0,
            recoveryRequired: false,
            grantsDispatchAuthority: false,
        });
        expect(Object.isFrozen(current.status())).toBe(true);
        expect(JSON.stringify(current.status())).not.toContain(
            RAW_API_GENERATION,
        );
        expect(current).not.toHaveProperty('state');
        expect(current).not.toHaveProperty('restore');
        expect(current).not.toHaveProperty('reset');
    });

    it.each([
        ['policy', DEFAULT_SMART_ORDER_RUNTIME_GAP_POLICY],
        ['state', {}],
        ['sseBaselines', []],
        ['continuityMode', 'gate_verified_sequence'],
        ['detectorFactory', () => ({})],
    ])('rejects caller-controlled %s at construction', (key, value) => {
        const options = {
            apiGeneration: RAW_API_GENERATION,
            observedWallTimeMs: 1_000_000,
            observedMonotonicTimeMs: 10_000,
            [key]: value,
        };
        expect(() => createSmartOrderRuntimeGapDetector(options)).toThrow(
            'options schema is invalid',
        );
    });

    it('does not export raw state, policy, or reducer factories', async () => {
        const module = await import('./runtime-gap-detector.mjs');
        expect(module.createSmartOrderRuntimeGapDetectorState).toBeUndefined();
        expect(module.createSmartOrderRuntimeGapPolicy).toBeUndefined();
        expect(module.observeSmartOrderRuntimeGap).toBeUndefined();
    });

    it('accepts continuous samples through the exact fixed threshold', () => {
        const current = detector();
        const first = current.observeClockSample({
            observedWallTimeMs: 1_001_000,
            observedMonotonicTimeMs: 11_000,
        });
        const boundary = current.observeClockSample({
            observedWallTimeMs: 1_006_000,
            observedMonotonicTimeMs: 16_000,
        });
        expect(first).toMatchObject({
            classification: 'continuous',
            recoveryRequired: false,
            observationRevision: 1,
        });
        expect(boundary).toMatchObject({
            classification: 'continuous',
            recoveryRequired: false,
            observationRevision: 2,
        });
    });

    it('latches an event-loop pause and never grants dispatch authority', () => {
        const current = detector();
        const result = current.observeClockSample({
            observedWallTimeMs: 1_005_001,
            observedMonotonicTimeMs: 15_001,
        });
        expect(result).toMatchObject({
            classification: 'recovery_required',
            newlyDetectedReasonCodes: ['EVENT_LOOP_PAUSE_GAP'],
            recoveryRequired: true,
            signal: {
                dispatchReadiness: 'blocked_by_continuity_gap',
                userRearmRequiredAfterReconciliation: true,
            },
        });
        expect(result.signal).not.toHaveProperty('dispatchAllowed');
        expect(current.status()).toMatchObject({
            recoveryRequired: true,
            grantsDispatchAuthority: false,
        });
    });

    it.each([
        [1_004_001, 11_000],
        [999_999, 11_000],
    ])('latches forward or backward wall-clock discontinuity', (wall, mono) => {
        const result = detector().observeClockSample({
            observedWallTimeMs: wall,
            observedMonotonicTimeMs: mono,
        });
        expect(result.signal.reasonCodes).toContain('WALL_CLOCK_JUMP_GAP');
    });

    it.each(['sleep', 'wake'])('treats %s as an immediate gap', (phase) => {
        const result = detector().observeLifecycle({
            phase,
            observedWallTimeMs: 1_000_100,
            observedMonotonicTimeMs: 10_100,
        });
        expect(result.signal.reasonCodes).toContain('SLEEP_WAKE_GAP');
    });

    it('keeps its one-way latch across later healthy samples', () => {
        const current = detector();
        const gap = current.observeClockSample({
            observedWallTimeMs: 1_005_001,
            observedMonotonicTimeMs: 15_001,
        });
        const later = current.observeClockSample({
            observedWallTimeMs: 1_006_001,
            observedMonotonicTimeMs: 16_001,
        });
        expect(later.recoveryRequired).toBe(true);
        expect(later.signal.signalSha256).toBe(gap.signal.signalSha256);
        expect(later.newlyDetectedReasonCodes).toEqual([]);
    });

    it('detects API generation change without disclosing either generation', () => {
        const current = detector();
        expect(
            current.observeApiGeneration({ apiGeneration: RAW_API_GENERATION }),
        ).toMatchObject({ recoveryRequired: false });
        const result = current.observeApiGeneration({
            apiGeneration: 'simulation:next-private-generation',
        });
        expect(result.signal.reasonCodes).toEqual(['API_GENERATION_GAP']);
        expect(result.signal.runtimeTransitionReasonCodes).toEqual([
            'RUNTIME_API_GENERATION_SUPERSEDED',
            'RUNTIME_RECONCILIATION_REQUIRED',
        ]);
        expect(JSON.stringify(result)).not.toContain('private-generation');
    });

    it('turns malformed observation input into a fail-closed signal', () => {
        const malformed = detector().observeClockSample({
            observedWallTimeMs: Number.NaN,
            observedMonotonicTimeMs: 11_000,
        });
        expect(malformed.signal.reasonCodes).toContain(
            'RUNTIME_GAP_INPUT_INVALID',
        );
    });

    it('accepts only critical SSE lifecycle and keeps event continuity absent', () => {
        const current = detector();
        expect(Object.keys(current)).not.toContain('observeSseEvent');
        const gap = current.observeSseLifecycle({
            phase: 'disconnect',
            streamEpoch: 'trade-connection-1',
            streamId: 'shioaji-trade-sse',
        });
        expect(gap).toMatchObject({
            recoveryRequired: true,
            newlyDetectedReasonCodes: ['SSE_STREAM_BASELINE_MISSING'],
        });
        expect(Object.keys(current)).not.toContain('registerSseBaseline');
        expect(Object.keys(current)).not.toContain('continuityMode');
        expect(current.status().sseContinuityAuthority).toBe(
            'critical_transport_lifecycle_only',
        );
    });

    it('is deterministic, immutable and does not mutate caller input', () => {
        const left = detector();
        const right = detector();
        const input = {
            observedWallTimeMs: 1_005_001,
            observedMonotonicTimeMs: 15_001,
        };
        const before = structuredClone(input);
        expect(left.observeClockSample(input)).toEqual(
            right.observeClockSample(input),
        );
        expect(input).toEqual(before);
        expect(Object.isFrozen(left.status().reasonCodes)).toBe(true);
    });

    it('has no network, broker, process-control or service side effects', () => {
        const source = readFileSync(
            new URL('./runtime-gap-detector.mjs', import.meta.url),
            'utf8',
        );
        expect(source).not.toMatch(
            /from ['"]node:(?:http|https|net|child_process)['"]/,
        );
        expect(source).not.toMatch(/\bfetch\s*\(/);
        expect(source).not.toContain('8080');
        expect(source).not.toMatch(/place_order|update_order|cancel_order/);
        expect(source).not.toMatch(
            /startSmartOrderRuntime|stopSmartOrderRuntime/,
        );
    });
});
