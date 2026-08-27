import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runSmartOrderTask03cAuthorizationPreview } from './smart-order-task0-3c-authorization-preview.mjs';

const PREVIEW_URL = new URL(
    './smart-order-task0-3c-authorization-preview.mjs',
    import.meta.url,
);

describe('Task 0.3c read-only authorization preview boundary', () => {
    it('rejects incomplete arguments before reading live state', async () => {
        await expect(
            runSmartOrderTask03cAuthorizationPreview({ args: [] }),
        ).rejects.toThrow('arguments');
    });

    it('has no executor, transport, broker-write, or authorization-consumption import', async () => {
        const source = await readFile(PREVIEW_URL, 'utf8');
        expect(source).toContain(
            'prepareSmartOrderTask03cCandidateOperation',
        );
        expect(source).toContain('brokerWriteAttempted: false');
        expect(source).toContain('brokerAuthority: false');
        expect(source).not.toContain('operation-executor');
        expect(source).not.toContain('pinned-transport');
        expect(source).not.toContain('runSmartOrderTask03cAuthorizationCli');
        expect(source).not.toContain('place_order');
    });
});
