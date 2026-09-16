import { createHash } from 'node:crypto';
import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { createIntradayRelativeVolumeTriggerLedger } from './relative-volume-evaluator.mjs';

export const INTRADAY_MONITOR_REPLAY_FIXTURE_SCHEMA =
    'intraday-monitor-replay-fixture/1';
export const INTRADAY_MONITOR_REPLAY_RESULT_SCHEMA =
    'intraday-monitor-replay-result/1';

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function safeFixture(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('replay fixture is invalid');
    }
    const keys = Object.keys(value).sort();
    if (
        keys.length !== 4 ||
        !keys.every(
            (key, index) =>
                key ===
                [
                    'evidenceClass',
                    'scenarioId',
                    'schemaVersion',
                    'steps',
                ][index],
        )
    ) {
        throw new TypeError('replay fixture schema is invalid');
    }
    if (
        value.schemaVersion !== INTRADAY_MONITOR_REPLAY_FIXTURE_SCHEMA ||
        value.evidenceClass !== 'synthetic_non_market' ||
        typeof value.scenarioId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(value.scenarioId) ||
        !Array.isArray(value.steps) ||
        value.steps.length < 1 ||
        value.steps.length > 100_000
    ) {
        throw new TypeError('replay fixture is invalid');
    }
    return structuredClone(value);
}

export function runIntradayMonitorDeterministicReplay(value) {
    const fixture = safeFixture(value);
    const ledger = createIntradayRelativeVolumeTriggerLedger();
    const evaluations = fixture.steps.map((step, index) => {
        const result = ledger.evaluate(step);
        return {
            index,
            tradeDate: step.tradeDate,
            canonicalSymbol: step.canonicalSymbol,
            minuteKey: step.minuteKey,
            classification: result.classification,
            reason: result.reason,
            eventId: result.triggerEvent?.eventId ?? null,
            eventHash: result.triggerEvent?.eventHash ?? null,
            eventKind: result.triggerEvent?.kind ?? null,
            newlyCreated: result.newlyCreated,
            notificationEligible: result.notificationEligible,
        };
    });
    const events = ledger.getEvents();
    const matched = evaluations.filter(
        (entry) => entry.classification === 'matched',
    ).length;
    const notMatched = evaluations.filter(
        (entry) => entry.classification === 'not_matched',
    ).length;
    const unknown = evaluations.length - matched - notMatched;
    const seed = {
        schemaVersion: INTRADAY_MONITOR_REPLAY_RESULT_SCHEMA,
        fixtureSchemaVersion: fixture.schemaVersion,
        evidenceClass: fixture.evidenceClass,
        scenarioId: fixture.scenarioId,
        stepCount: evaluations.length,
        matched,
        notMatched,
        unknown,
        conservationValid: matched + notMatched + unknown === evaluations.length,
        evaluations,
        events,
        notificationDispatchAuthority: false,
        providerRequestAuthority: false,
        subscriptionTransportAuthority: false,
        brokerWriteAuthority: false,
    };
    return deepFreeze({
        ...seed,
        replayHash: createHash('sha256')
            .update(canonicalJson(seed))
            .digest('hex'),
    });
}
