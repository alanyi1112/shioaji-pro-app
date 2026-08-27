// Production code may verify observer-issued contract evidence, but no module
// outside the Shioaji observer can mint it.  The issuing WeakSet remains
// module-private in shioaji-trade-observer.mjs.
export { isVerifiedSmartOrderCanonicalContractEvidence } from './shioaji-trade-observer.mjs';
