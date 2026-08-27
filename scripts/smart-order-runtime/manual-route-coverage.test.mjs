import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
    SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE,
    SMART_ORDER_STOCK_MANUAL_ORDER_CLASSES,
    SMART_ORDER_STOCK_WRITE_CALLSITES,
    SMART_ORDER_STOCK_WRITE_ROUTES,
    SMART_ORDER_STOCK_WRITE_SINKS,
    projectSmartOrderManualRouteCoverageStatus,
} from './manual-route-coverage.mjs';
import { createSmartOrderBrokerWriteProvenanceBoundary } from './broker-write-provenance-classifier.mjs';

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(runtimeDirectory, '..', '..');
const sourceRoot = join(repositoryRoot, 'src');
const trackedCallees = new Set([
    'cancelAllOrders',
    'cancelOrder',
    'placeQuickOrder',
    'placeStockExitByShares',
    'placeStockOrder',
    'updateOrderPrice',
    'updateOrderQty',
]);

function productionSourceFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...productionSourceFiles(absolute));
        } else if (
            /\.(?:ts|tsx)$/.test(entry.name) &&
            !/\.(?:test|browser\.test)\.(?:ts|tsx)$/.test(entry.name)
        ) {
            files.push(absolute);
        }
    }
    return files.sort();
}

function identifierName(expression) {
    if (ts.isIdentifier(expression)) return expression.text;
    return null;
}

function scanTrackedCallsites() {
    const records = [];
    for (const absolute of productionSourceFiles(sourceRoot)) {
        const sourceText = readFileSync(absolute, 'utf8');
        const source = ts.createSourceFile(
            absolute,
            sourceText,
            ts.ScriptTarget.Latest,
            true,
            absolute.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        const counts = new Map();
        function visit(node) {
            if (ts.isCallExpression(node)) {
                const callee = identifierName(node.expression);
                if (callee && trackedCallees.has(callee)) {
                    const ordinal = (counts.get(callee) ?? 0) + 1;
                    counts.set(callee, ordinal);
                    records.push(
                        `${relative(repositoryRoot, absolute)}#${callee}#${ordinal}`,
                    );
                }
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
    }
    return records.sort();
}

function enclosingFunctionName(node) {
    let current = node.parent;
    while (current) {
        if (ts.isFunctionDeclaration(current) && current.name) {
            return current.name.text;
        }
        current = current.parent;
    }
    return null;
}

function scanRawOrderWrites() {
    const records = [];
    for (const absolute of productionSourceFiles(sourceRoot)) {
        const source = ts.createSourceFile(
            absolute,
            readFileSync(absolute, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
            absolute.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        function visit(node) {
            if (
                ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                ['apiDelete', 'apiPost', 'apiPut', 'fetch'].includes(
                    node.expression.text,
                ) &&
                node.arguments.length > 0 &&
                ts.isStringLiteral(node.arguments[0]) &&
                [
                    '/api/v1/order/cancel_order',
                    '/api/v1/order/place_order',
                    '/api/v1/order/update_price',
                    '/api/v1/order/update_qty',
                ].includes(node.arguments[0].text)
            ) {
                records.push(
                    `${relative(repositoryRoot, absolute)}#${enclosingFunctionName(node)}#${node.expression.text}#${node.arguments[0].text}`,
                );
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
    }
    return records.sort();
}

function boundaryClock() {
    let nowEpochMs = 1_786_468_000_000;
    return {
        now: () => nowEpochMs,
        advance: (delta) => {
            nowEpochMs += delta;
        },
    };
}

function classifyInput(overrides = {}) {
    return {
        automationBinding: null,
        callerEvidence: null,
        canonicalPayloadSha256: `sha256:${'a'.repeat(64)}`,
        manualConfirmationEvidence: null,
        probeNonceEvidence: null,
        routeEvidence: null,
        ...overrides,
    };
}

describe('manual stock broker-write route coverage', () => {
    it('keeps a unique governed inventory while downstream gates disable automation', () => {
        expect(SMART_ORDER_STOCK_WRITE_SINKS).toHaveLength(4);
        expect(new Set(SMART_ORDER_STOCK_WRITE_ROUTES.map((item) => item.routeId)).size)
            .toBe(SMART_ORDER_STOCK_WRITE_ROUTES.length);
        expect(
            new Set(SMART_ORDER_STOCK_MANUAL_ORDER_CLASSES.map((item) => item.classId))
                .size,
        ).toBe(SMART_ORDER_STOCK_MANUAL_ORDER_CLASSES.length);
        expect(SMART_ORDER_STOCK_MANUAL_ORDER_CLASSES).toHaveLength(24);
        for (const lot of ['Common', 'IntradayOdd']) {
            for (const priceType of ['LMT', 'MKT']) {
                for (const timeInForce of ['ROD', 'IOC', 'FOK']) {
                    expect(
                        SMART_ORDER_STOCK_MANUAL_ORDER_CLASSES.some(
                            (item) =>
                                item.cond === 'Cash_candidate_unverified' &&
                                item.lot === lot &&
                                item.priceType === priceType &&
                                item.timeInForce === timeInForce,
                        ),
                    ).toBe(true);
                }
            }
        }
        expect(SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE).toMatchObject({
            inventoryComplete: true,
            classifierContractPassed: true,
            coverageComplete: true,
            manualEquivalencePassed: true,
            serverDerivedProvenancePassed: true,
            automationAccountEligibility: 'disabled',
            brokerWriteAuthority: false,
            writeMasterAuthority: false,
        });
        expect(
            SMART_ORDER_CURRENT_MANUAL_ROUTE_COVERAGE.ungovernedRouteIds,
        ).toEqual(
            SMART_ORDER_STOCK_WRITE_ROUTES.filter(
                (route) => route.state === 'observed_bypass',
            ).map((route) => route.routeId),
        );
        expect(projectSmartOrderManualRouteCoverageStatus()).toMatchObject({
            automationAccountEligibility: 'disabled',
            ungovernedRouteCount: 0,
            brokerWriteAuthority: false,
        });
    });

    it('matches every tracked production callsite and raw stock sink exactly', () => {
        expect(scanTrackedCallsites()).toEqual(
            SMART_ORDER_STOCK_WRITE_CALLSITES.map((item) => item.callsiteKey).sort(),
        );
        expect(scanRawOrderWrites()).toEqual([
            'src/lib/shioaji.ts#cancelFuturesOrder#apiPost#/api/v1/order/cancel_order',
            'src/lib/shioaji.ts#placeFuturesOrder#apiPost#/api/v1/order/place_order',
            'src/lib/shioaji.ts#updateFuturesOrderPrice#apiPost#/api/v1/order/update_price',
            'src/lib/shioaji.ts#updateFuturesOrderQty#apiPost#/api/v1/order/update_qty',
        ]);
        const stockSymbols = new Set(
            SMART_ORDER_STOCK_WRITE_SINKS.map((sink) => sink.sourceSymbol),
        );
        expect(stockSymbols).toEqual(
            new Set([
                'cancelOrder',
                'placeStockOrder',
                'updateOrderPrice',
                'updateOrderQty',
            ]),
        );
        expect(
            productionSourceFiles(sourceRoot)
                .map((absolute) => readFileSync(absolute, 'utf8'))
                .join('\n'),
        ).not.toContain('bypassRisk');
        const reachableRouteIds = new Set(
            SMART_ORDER_STOCK_WRITE_CALLSITES.flatMap((item) => item.routeIds),
        );
        for (const route of SMART_ORDER_STOCK_WRITE_ROUTES) {
            expect(reachableRouteIds.has(route.routeId)).toBe(
                route.state === 'governed',
            );
        }
        expect(
            SMART_ORDER_STOCK_WRITE_CALLSITES.filter(
                (item) => item.routeIds.length === 0,
            ),
        ).toEqual([
            expect.objectContaining({
                callsiteKey:
                    'src/components/bottom-dock.tsx#placeQuickOrder#1',
                stockReachability: 'excluded_by_isStockPosition_branch',
            }),
        ]);
    });

    it('derives manual provenance from an opaque server route, caller and one-shot payload binding', () => {
        const clock = boundaryClock();
        const boundary = createSmartOrderBrokerWriteProvenanceBoundary({
            now: clock.now,
        });
        const routeEvidence = boundary.registerServerRoute({
            family: 'manual',
            operation: 'place',
            routeId: 'STK-MAN-PLACE-TICKET',
        });
        const callerEvidence = boundary.registerCaller({
            callerClass: 'interactive_ui',
        });
        const confirmation = boundary.issueManualConfirmation({
            callerEvidence,
            canonicalPayloadSha256: `sha256:${'a'.repeat(64)}`,
            confirmationId: 'manual-confirmation-1',
            confirmationRevision: 3,
            routeEvidence,
            validForMs: 5_000,
        });
        const first = boundary.classify(
            classifyInput({
                callerEvidence,
                manualConfirmationEvidence: confirmation,
                routeEvidence,
            }),
        );
        expect(first).toMatchObject({
            classified: true,
            admitted: false,
            provenance: 'manual_user_confirmed',
            callerClass: 'interactive_ui',
            routeId: 'STK-MAN-PLACE-TICKET',
            reason: 'downstream_broker_admission_required',
            automationAccountEligibility: 'disabled',
            brokerWriteAuthority: false,
        });
        expect(boundary.isServerDerivedDecision(first)).toBe(true);
        expect(boundary.isServerDerivedDecision({ ...first })).toBe(false);
        expect(
            boundary.classify(
                classifyInput({
                    callerEvidence,
                    manualConfirmationEvidence: confirmation,
                    routeEvidence,
                }),
            ),
        ).toMatchObject({
            classified: false,
            reason: 'manual_confirmation_invalid_or_replayed',
        });
    });

    it('rejects a scheduler on a manual route without consuming the user confirmation', () => {
        const clock = boundaryClock();
        const boundary = createSmartOrderBrokerWriteProvenanceBoundary({
            now: clock.now,
        });
        const routeEvidence = boundary.registerServerRoute({
            family: 'manual',
            operation: 'cancel',
            routeId: 'STK-MAN-CANCEL-ORDER-TABLE',
        });
        const interactiveCaller = boundary.registerCaller({
            callerClass: 'interactive_ui',
        });
        const schedulerCaller = boundary.registerCaller({
            callerClass: 'runtime_scheduler',
        });
        const confirmation = boundary.issueManualConfirmation({
            callerEvidence: interactiveCaller,
            canonicalPayloadSha256: `sha256:${'a'.repeat(64)}`,
            confirmationId: 'cancel-confirmation-1',
            confirmationRevision: 1,
            routeEvidence,
            validForMs: 5_000,
        });
        expect(
            boundary.classify(
                classifyInput({
                    callerEvidence: schedulerCaller,
                    manualConfirmationEvidence: confirmation,
                    routeEvidence,
                }),
            ),
        ).toMatchObject({
            provenance: 'unknown',
            reason: 'caller_route_family_mismatch',
        });
        expect(
            boundary.classify(
                classifyInput({
                    callerEvidence: interactiveCaller,
                    manualConfirmationEvidence: confirmation,
                    routeEvidence,
                }),
            ),
        ).toMatchObject({
            provenance: 'manual_user_confirmed',
            classified: true,
        });
    });

    it('keeps automation and probe lineages separate and never grants broker authority', () => {
        const clock = boundaryClock();
        const boundary = createSmartOrderBrokerWriteProvenanceBoundary({
            now: clock.now,
        });
        const automationRoute = boundary.registerServerRoute({
            family: 'automation',
            operation: 'place',
            routeId: 'STK-AUTO-PLACE-GRID-FOLLOW',
        });
        const scheduler = boundary.registerCaller({
            callerClass: 'runtime_scheduler',
        });
        expect(
            boundary.classify(
                classifyInput({
                    automationBinding: {
                        strategyId: 'strategy-1',
                        activationId: 'activation-1',
                        intentId: 'intent-1',
                        intentRevision: 2,
                    },
                    callerEvidence: scheduler,
                    routeEvidence: automationRoute,
                }),
            ),
        ).toMatchObject({
            provenance: 'automation',
            admitted: false,
            reason: 'downstream_broker_admission_required',
            brokerWriteAuthority: false,
        });

        const probeRoute = boundary.registerServerRoute({
            family: 'gate_probe',
            operation: 'update',
            routeId: 'STK-PROBE-UPDATE',
        });
        const gateCli = boundary.registerCaller({ callerClass: 'gate_cli' });
        const nonce = boundary.issueProbeNonce({
            callerEvidence: gateCli,
            canonicalPayloadSha256: `sha256:${'a'.repeat(64)}`,
            operationNonce: 'probe-nonce-1',
            probeRunId: 'probe-run-1',
            routeEvidence: probeRoute,
            validForMs: 5_000,
        });
        expect(
            boundary.classify(
                classifyInput({
                    callerEvidence: gateCli,
                    probeNonceEvidence: nonce,
                    routeEvidence: probeRoute,
                }),
            ),
        ).toMatchObject({
            provenance: 'gate_probe',
            admitted: false,
            brokerWriteAuthority: false,
        });
    });

    it('rejects client provenance fields and accessor-based TOCTOU without reading the accessor', () => {
        const boundary = createSmartOrderBrokerWriteProvenanceBoundary();
        const extra = { ...classifyInput(), provenance: 'manual_user_confirmed' };
        expect(boundary.classify(extra)).toMatchObject({
            reason: 'client_supplied_or_noncanonical_context',
        });
        let accessorReads = 0;
        const input = classifyInput();
        Object.defineProperty(input, 'canonicalPayloadSha256', {
            enumerable: true,
            get() {
                accessorReads += 1;
                return `sha256:${'a'.repeat(64)}`;
            },
        });
        expect(boundary.classify(input)).toMatchObject({
            reason: 'client_supplied_or_noncanonical_context',
        });
        expect(accessorReads).toBe(0);
    });
});
