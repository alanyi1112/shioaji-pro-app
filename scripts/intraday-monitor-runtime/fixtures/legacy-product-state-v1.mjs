export function legacyProductStateV1Fixture(overrides = {}) {
    return {
        schemaVersion: 'intraday-monitor-direct-160-product-runtime/1',
        phase: 'complete_go',
        tradeDate: '2026-09-16',
        baselineTradeDate: '2026-09-15',
        manifestHash: '1'.repeat(64),
        baselineHash: '2'.repeat(64),
        connectionGeneration: 'simulation:legacy-generation-20260916',
        configRevision: 4,
        approvedActiveLimit: 160,
        evaluationStageTarget: 160,
        evaluationState: 'go',
        controlPlaneSubscriptionRequested: true,
        dataActive: 160,
        awaitingFirstKbar: 0,
        boundedTransportReady: true,
        notificationAuthority: false,
        updatedAt: '2026-09-16T06:13:31.004Z',
        provider: {
            physicalUsage: null,
            globalOwnershipComplete: null,
            releaseProven: null,
            headroom: null,
        },
        items: [],
        ...overrides,
    };
}
