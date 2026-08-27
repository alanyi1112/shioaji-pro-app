import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_RUNTIME_READINESS_CONJUNCT_IDS,
    projectSmartOrderRuntimeReadinessCandidate,
} from './runtime-readiness-policy.mjs';

const NOW = 1_800_000_000_000;
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

function currentConjunct(conjunctId, overrides = {}) {
    const shortLived = new Set([
        'account_reconciliation',
        'canonical_pnl',
        'canonical_risk',
        'external_working_visibility',
        'fresh_quote',
        'global_resources',
        'mode_api_attestation',
        'trade_subscription',
        'unknown_intent_clear',
    ]);
    return {
        conjunctId,
        evidenceSha256: DIGEST_A,
        observedAtEpochMs: NOW - 1_000,
        state: 'current_verified',
        validUntilEpochMs: NOW + (shortLived.has(conjunctId) ? 4_000 : 9_000),
        ...overrides,
    };
}

function nonCurrentConjunct(conjunctId, state) {
    return {
        conjunctId,
        evidenceSha256: null,
        observedAtEpochMs: null,
        state,
        validUntilEpochMs: null,
    };
}

function input(overrides = {}) {
    return {
        apiGenerationSha256: DIGEST_B,
        conjuncts: SMART_ORDER_RUNTIME_READINESS_CONJUNCT_IDS.map((id) =>
            currentConjunct(id),
        ),
        health: { processResponsive: true },
        nowEpochMs: NOW,
        runtimeEpochIdSha256: DIGEST_A,
        ...overrides,
    };
}

describe('smart-order runtime health/readiness policy core', () => {
    it('keeps health up while trade subscription and reconciliation are blocked', () => {
        const conjuncts = input().conjuncts.map((entry) =>
            entry.conjunctId === 'trade_subscription'
                ? nonCurrentConjunct(entry.conjunctId, 'missing')
                : entry.conjunctId === 'account_reconciliation'
                  ? nonCurrentConjunct(entry.conjunctId, 'unknown')
                  : entry,
        );
        expect(
            projectSmartOrderRuntimeReadinessCandidate(
                input({ conjuncts }),
            ),
        ).toMatchObject({
            health: 'up',
            allConjunctsStructurallyCurrent: false,
            readiness: false,
            blockers: [
                'account_reconciliation:unknown',
                'trade_subscription:missing',
            ],
            brokerAuthority: false,
        });
    });

    it('does not let fresh quote or a responsive process hide repository failure', () => {
        const conjuncts = input().conjuncts.map((entry) =>
            entry.conjunctId === 'repository_integrity'
                ? nonCurrentConjunct(entry.conjunctId, 'invalid')
                : entry,
        );
        const result = projectSmartOrderRuntimeReadinessCandidate(
            input({ conjuncts }),
        );
        expect(result).toMatchObject({
            health: 'up',
            readiness: false,
            blockers: ['repository_integrity:invalid'],
            snapshotWatchdogAuthoritativeForReadiness: false,
        });
    });

    it('keeps production dispatch closed when calendar and business-session evidence conflict at an early close', () => {
        const conjuncts = input().conjuncts.map((entry) =>
            entry.conjunctId === 'calendar'
                ? nonCurrentConjunct(entry.conjunctId, 'conflict')
                : entry,
        );

        expect(
            projectSmartOrderRuntimeReadinessCandidate(
                input({ conjuncts }),
            ),
        ).toMatchObject({
            health: 'up',
            readiness: false,
            blockers: ['calendar:conflict'],
            authoritativeForDispatch: false,
            writeMasterAuthority: false,
            brokerAuthority: false,
        });
    });

    it('keeps the fully satisfied structural projection non-authoritative until production issuers are integrated', () => {
        const result = projectSmartOrderRuntimeReadinessCandidate(input());
        expect(result).toMatchObject({
            allConjunctsStructurallyCurrent: true,
            authorityIntegrated: false,
            readiness: false,
            readinessState: 'authority_unintegrated',
            blockers: ['production_readiness_authority_unintegrated'],
            authoritativeForDispatch: false,
            writeMasterAuthority: false,
            brokerAuthority: false,
            accountIdentifiersExposed: false,
        });
        expect(result.projectionSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.blockers)).toBe(true);
    });

    it.each([
        ['fresh_quote', NOW - 1_000, NOW],
        ['canonical_pnl', NOW - 6_000, NOW + 1_000],
        ['trade_subscription', NOW + 1, NOW + 2_000],
        ['gate_manifest', NOW - 1_000, NOW + 700_000],
        ['calendar', NOW - 1_000, NOW],
    ])(
        'fails closed for stale, future, or overlong %s evidence',
        (conjunctId, observedAtEpochMs, validUntilEpochMs) => {
            const conjuncts = input().conjuncts.map((entry) =>
                entry.conjunctId === conjunctId
                    ? currentConjunct(conjunctId, {
                          observedAtEpochMs,
                          validUntilEpochMs,
                      })
                    : entry,
            );
            expect(
                projectSmartOrderRuntimeReadinessCandidate(
                    input({ conjuncts }),
                ).blockers,
            ).toEqual([`${conjunctId}:stale`]);
        },
    );

    it('rejects a missing, duplicate, reordered, or invented deny-union conjunct', () => {
        const baseline = input().conjuncts;
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(
                input({ conjuncts: baseline.slice(1) }),
            ),
        ).toThrow('exact canonical deny-union');
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(
                input({ conjuncts: [...baseline.slice(0, -1), baseline[0]] }),
            ),
        ).toThrow('exact canonical deny-union');
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(
                input({ conjuncts: [...baseline].reverse() }),
            ),
        ).toThrow('exact canonical deny-union');
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(
                input({
                    conjuncts: baseline.map((entry, index) =>
                        index === 0
                            ? { ...entry, conjunctId: 'snapshot_2330' }
                            : entry,
                    ),
                }),
            ),
        ).toThrow('exact canonical deny-union');
    });

    it('rejects extra account, watchdog, and caller-ready fields rather than silently trusting them', () => {
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate({
                ...input(),
                accountId: 'must-not-enter-projection',
            }),
        ).toThrow('input schema');
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate({
                ...input(),
                health: {
                    processResponsive: true,
                    snapshot2330Ok: true,
                },
            }),
        ).toThrow('input schema');
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate({
                ...input(),
                ready: true,
            }),
        ).toThrow('input schema');
    });

    it('snapshots own data descriptors once and never executes accessors', () => {
        let rootReads = 0;
        let conjunctReads = 0;
        const root = input();
        Object.defineProperty(root, 'nowEpochMs', {
            enumerable: true,
            get() {
                rootReads += 1;
                return NOW;
            },
        });
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(root),
        ).toThrow('input schema');
        expect(rootReads).toBe(0);

        const conjuncts = input().conjuncts;
        Object.defineProperty(conjuncts[0], 'state', {
            enumerable: true,
            get() {
                conjunctReads += 1;
                return 'current_verified';
            },
        });
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(
                input({ conjuncts }),
            ),
        ).toThrow('exact canonical deny-union');
        expect(conjunctReads).toBe(0);
    });

    it('rejects Proxy inputs without invoking any structural traps', () => {
        let rootTraps = 0;
        const rootProxy = new Proxy(input(), {
            getPrototypeOf() {
                rootTraps += 1;
                return Object.prototype;
            },
            ownKeys(target) {
                rootTraps += 1;
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, property) {
                rootTraps += 1;
                return Reflect.getOwnPropertyDescriptor(target, property);
            },
        });
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(rootProxy),
        ).toThrow('input schema');
        expect(rootTraps).toBe(0);

        let arrayTraps = 0;
        const conjunctProxy = new Proxy(input().conjuncts, {
            getPrototypeOf() {
                arrayTraps += 1;
                return Array.prototype;
            },
            ownKeys(target) {
                arrayTraps += 1;
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, property) {
                arrayTraps += 1;
                return Reflect.getOwnPropertyDescriptor(target, property);
            },
        });
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(
                input({ conjuncts: conjunctProxy }),
            ),
        ).toThrow('input schema');
        expect(arrayTraps).toBe(0);

        let healthTraps = 0;
        const healthProxy = new Proxy(
            { processResponsive: true },
            {
                getPrototypeOf() {
                    healthTraps += 1;
                    return Object.prototype;
                },
                ownKeys(target) {
                    healthTraps += 1;
                    return Reflect.ownKeys(target);
                },
                getOwnPropertyDescriptor(target, property) {
                    healthTraps += 1;
                    return Reflect.getOwnPropertyDescriptor(
                        target,
                        property,
                    );
                },
            },
        );
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(
                input({ health: healthProxy }),
            ),
        ).toThrow('input schema');
        expect(healthTraps).toBe(0);
    });

    it('rejects custom-prototype records and arrays', () => {
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(
                Object.assign(Object.create({ inheritedReady: true }), input()),
            ),
        ).toThrow('input schema');

        const conjuncts = input().conjuncts;
        Object.setPrototypeOf(conjuncts, Object.create(Array.prototype));
        expect(() =>
            projectSmartOrderRuntimeReadinessCandidate(input({ conjuncts })),
        ).toThrow('input schema');
    });

    it('reports process health independently in both directions', () => {
        const result = projectSmartOrderRuntimeReadinessCandidate(
            input({ health: { processResponsive: false } }),
        );
        expect(result.health).toBe('down');
        expect(result.allConjunctsStructurallyCurrent).toBe(true);
        expect(result.readiness).toBe(false);
        expect(result.readinessState).toBe('process_unresponsive');
        expect(result.blockers).toEqual([
            'process_health:down',
            'production_readiness_authority_unintegrated',
        ]);
    });

    it('domain-separates missing, conflict, and stale diagnostic projections', () => {
        const projectionFor = (state) => {
            const conjuncts = input().conjuncts.map((entry) =>
                entry.conjunctId === 'identity'
                    ? nonCurrentConjunct(entry.conjunctId, state)
                    : entry,
            );
            return projectSmartOrderRuntimeReadinessCandidate(
                input({ conjuncts }),
            ).projectionSha256;
        };
        expect(
            new Set([
                projectionFor('missing'),
                projectionFor('conflict'),
                projectionFor('stale'),
            ]).size,
        ).toBe(3);
    });
});
