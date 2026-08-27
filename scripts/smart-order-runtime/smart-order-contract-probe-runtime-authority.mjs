import {
    acquireSharedModeExecutionLease,
} from './mode-execution-lease.mjs';
import {
    createSmartOrderManagedApiProcessAttestor,
    isIssuedSmartOrderManagedApiProcessAttestation,
} from './managed-api-process-attestor.mjs';
import { resolveExpectedManagedApiRepositoryRoot } from './installed-managed-api-binding.mjs';
import { homedir } from 'node:os';
import path from 'node:path';

export const SMART_ORDER_CONTRACT_PROBE_TEST_ONLY = undefined;

export function takeSmartOrderContractProbeRuntimeAuthority() {
    if (typeof globalThis.fetch !== 'function') {
        throw new Error('native fetch is unavailable for the managed read-only probe');
    }
    return Object.freeze({
        fetchImpl: globalThis.fetch,
        acquireSharedLease: acquireSharedModeExecutionLease,
        processAttestor: createSmartOrderManagedApiProcessAttestor({
            expectedAppSupportRoot: path.join(
                homedir(),
                'Library',
                'Application Support',
                'RealTimeStock',
            ),
            expectedRepositoryRoot:
                resolveExpectedManagedApiRepositoryRoot(),
        }),
        isManagedAttestation: isIssuedSmartOrderManagedApiProcessAttestation,
    });
}
