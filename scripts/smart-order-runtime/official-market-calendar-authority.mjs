import {
    SMART_ORDER_OFFICIAL_MARKET_CALENDAR_REFRESH_MS,
    createOfficialMarketCalendarAuthorityCore,
} from './official-market-calendar-core.mjs';
import {
    isTrustedSmartOrderProtectiveQuoteObservation,
    isTrustedSmartOrderQuickConditionObservation,
} from './quote-subscription-coordinator.mjs';

const issuedAuthorities = new WeakSet();
const coreByIssuedAuthority = new WeakMap();

export const SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY = undefined;

export function createSmartOrderOfficialMarketCalendarAuthority() {
    const authority = createOfficialMarketCalendarAuthorityCore({
        fetchImpl: globalThis.fetch,
        nowEpochMs: () => Date.now(),
    });
    void authority.refresh().catch(() => {
        // Network, schema or source disagreement remains visible as fail closed.
    });
    const timer = setInterval(() => {
        void authority.refresh().catch(() => {});
    }, SMART_ORDER_OFFICIAL_MARKET_CALENDAR_REFRESH_MS);
    timer.unref?.();
    const issued = Object.freeze({
        schemaVersion: authority.schemaVersion,
        status: authority.status,
        refresh: authority.refresh,
        assertDispatchEnvelope: authority.assertDispatchEnvelope,
        close() {
            clearInterval(timer);
            authority.close();
        },
    });
    issuedAuthorities.add(issued);
    coreByIssuedAuthority.set(issued, authority);
    return issued;
}

export function admitSmartOrderOfficialMarketQuoteObservation(
    authority,
    observation,
) {
    const core = coreByIssuedAuthority.get(authority);
    if (!core || !issuedAuthorities.has(authority)) {
        throw new TypeError('official market calendar authority is invalid');
    }
    if (
        !isTrustedSmartOrderQuickConditionObservation(observation) &&
        !isTrustedSmartOrderProtectiveQuoteObservation(observation)
    ) {
        throw new TypeError('official market quote observation authority is invalid');
    }
    return core.admitObservation(observation);
}

export function isIssuedSmartOrderOfficialMarketCalendarAuthority(value) {
    return issuedAuthorities.has(value);
}
