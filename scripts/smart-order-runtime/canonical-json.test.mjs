import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.mjs';

describe('smart-order canonical JSON', () => {
    it('sorts object keys recursively while preserving array order', () => {
        expect(
            canonicalJson({ z: 1, a: { y: true, b: 'x' }, items: [2, 1] }),
        ).toBe('{"a":{"b":"x","y":true},"items":[2,1],"z":1}');
        expect(canonicalJson({ b: 2, a: 1 })).toBe(
            canonicalJson({ a: 1, b: 2 }),
        );
    });

    it.each([NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects non-canonical number %s',
        (value) => {
            expect(() => canonicalJson({ value })).toThrow('safe integer');
        },
    );

    it('rejects cycles, class instances, undefined, and oversized payloads', () => {
        const cycle = {};
        cycle.self = cycle;
        expect(() => canonicalJson(cycle)).toThrow('circular');
        expect(() => canonicalJson({ value: new Date() })).toThrow(
            'plain objects',
        );
        expect(() => canonicalJson({ value: undefined })).toThrow(
            'unsupported',
        );
        expect(() => canonicalJson({ value: 'xx' }, { maximumBytes: 2 })).toThrow(
            'byte limit',
        );
    });
});
