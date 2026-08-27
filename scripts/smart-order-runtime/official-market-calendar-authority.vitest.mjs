import { createOfficialMarketCalendarAuthorityCore } from './official-market-calendar-core.mjs';
import {
    isTrustedSmartOrderProtectiveQuoteObservation,
    isTrustedSmartOrderQuickConditionObservation,
} from './quote-subscription-coordinator.mjs';

const issuedAuthorities = new WeakSet();
const coreByIssuedAuthority = new WeakMap();
let nextAdapters;

function createCurrentHarnessAuthority() {
    const status = () =>
        Object.freeze({
            state: 'vitest_current_verified',
            activationReady: true,
            calendarCurrent: true,
            exchangeTimeCurrent: true,
            exchangeEvidence: Object.freeze({
                TSE: Object.freeze({ current: true }),
                OTC: Object.freeze({ current: true }),
            }),
            brokerWriteAuthority: false,
        });
    return Object.freeze({
        schemaVersion: 'smart-order-official-market-calendar/vitest-current',
        status,
        async refresh() {
            return status();
        },
        admitObservation() {
            return Object.freeze({ allowed: true, brokerWriteAuthority: false });
        },
        assertDispatchEnvelope() {
            return Object.freeze({ allowed: true, brokerWriteAuthority: false });
        },
        close() {},
    });
}

export const SMART_ORDER_OFFICIAL_MARKET_CALENDAR_TEST_ONLY = Object.freeze({
    configureNext(adapters) {
        if (
            !adapters ||
            typeof adapters.fetchImpl !== 'function' ||
            typeof adapters.nowEpochMs !== 'function'
        ) {
            throw new TypeError('calendar test adapters are invalid');
        }
        nextAdapters = Object.freeze({ ...adapters });
    },
    create(adapters) {
        const authority = createOfficialMarketCalendarAuthorityCore(adapters);
        issuedAuthorities.add(authority);
        coreByIssuedAuthority.set(authority, authority);
        return authority;
    },
    reset() {
        nextAdapters = undefined;
    },
});

export function createSmartOrderOfficialMarketCalendarAuthority() {
    if (!nextAdapters) {
        const authority = createCurrentHarnessAuthority();
        issuedAuthorities.add(authority);
        coreByIssuedAuthority.set(authority, authority);
        return authority;
    }
    const adapters = nextAdapters;
    nextAdapters = undefined;
    const authority = createOfficialMarketCalendarAuthorityCore(adapters);
    issuedAuthorities.add(authority);
    coreByIssuedAuthority.set(authority, authority);
    void authority.refresh().catch(() => {});
    return authority;
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
