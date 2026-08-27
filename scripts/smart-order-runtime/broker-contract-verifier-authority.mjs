// Gate 0 task 0.3b owns the future issuer.  Keeping this module predicate-only
// makes the production Node-safe adapter mechanically unavailable until the
// live simulation HTTP contract has been independently verified.
export function isIssuedCurrentSmartOrderBrokerContractCapability(_value) {
    return false;
}
