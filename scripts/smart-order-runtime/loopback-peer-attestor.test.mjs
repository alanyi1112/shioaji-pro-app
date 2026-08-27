import { describe, expect, it } from 'vitest';
import { parseSmartOrderLoopbackPeerLsofOutput } from './loopback-peer-attestor.mjs';

const EXPECTED = Object.freeze({
    clientPort: 58041,
    serverPort: 5173,
    expectedUid: 501,
});

describe('smart-order loopback peer attestor', () => {
    it('accepts only an exact client endpoint owned by the expected UID', () => {
        expect(
            parseSmartOrderLoopbackPeerLsofOutput(
                [
                    'p123',
                    'u501',
                    'f13',
                    'tIPv4',
                    'n127.0.0.1:58041->127.0.0.1:5173',
                    'f14',
                    'tIPv4',
                    'n127.0.0.1:5173->127.0.0.1:58041',
                    '',
                ].join('\n'),
                EXPECTED,
            ),
        ).toBe(true);
    });

    it.each([
        ['wrong UID', 'p123\nu502\nn127.0.0.1:58041->127.0.0.1:5173\n'],
        ['wrong client port', 'p123\nu501\nn127.0.0.1:58042->127.0.0.1:5173\n'],
        ['wrong server port', 'p123\nu501\nn127.0.0.1:58041->127.0.0.1:5174\n'],
        ['reverse server socket only', 'p123\nu501\nn127.0.0.1:5173->127.0.0.1:58041\n'],
        ['missing UID', 'p123\nn127.0.0.1:58041->127.0.0.1:5173\n'],
        ['malformed process record', 'pnot-a-pid\nu501\nn127.0.0.1:58041->127.0.0.1:5173\n'],
        ['empty output', ''],
    ])('fails closed for %s', (_label, output) => {
        expect(
            parseSmartOrderLoopbackPeerLsofOutput(output, EXPECTED),
        ).toBe(false);
    });

    it('rejects a mixed record set when the exact socket is attributed to another UID', () => {
        const mixed = [
            'p123',
            'u501',
            'n127.0.0.1:5173->127.0.0.1:58041',
            'p456',
            'u502',
            'n127.0.0.1:58041->127.0.0.1:5173',
            '',
        ].join('\n');
        expect(
            parseSmartOrderLoopbackPeerLsofOutput(mixed, EXPECTED),
        ).toBe(false);
    });
});
