export const SMART_ORDER_CANONICAL_JSON_SCHEMA_VERSION =
    'smart-order-canonical-json/2026-08-11.1';

export function canonicalJson(value, { maximumBytes = 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
        throw new TypeError('maximumBytes must be a positive safe integer');
    }
    const ancestors = new Set();
    const normalize = (candidate, path) => {
        if (
            candidate === null ||
            typeof candidate === 'string' ||
            typeof candidate === 'boolean'
        ) {
            return candidate;
        }
        if (typeof candidate === 'number') {
            if (!Number.isSafeInteger(candidate)) {
                throw new TypeError(`${path} must be a safe integer`);
            }
            return candidate;
        }
        if (Array.isArray(candidate)) {
            if (ancestors.has(candidate)) {
                throw new TypeError(`${path} must not be circular`);
            }
            ancestors.add(candidate);
            const normalized = candidate.map((entry, index) =>
                normalize(entry, `${path}[${index}]`),
            );
            ancestors.delete(candidate);
            return normalized;
        }
        if (candidate && typeof candidate === 'object') {
            const prototype = Object.getPrototypeOf(candidate);
            if (prototype !== Object.prototype && prototype !== null) {
                throw new TypeError(`${path} must contain only plain objects`);
            }
            if (ancestors.has(candidate)) {
                throw new TypeError(`${path} must not be circular`);
            }
            ancestors.add(candidate);
            const normalized = {};
            for (const key of Object.keys(candidate).sort()) {
                if (
                    key.length === 0 ||
                    key.length > 256 ||
                    /[\u0000-\u001f\u007f]/.test(key)
                ) {
                    throw new TypeError(`${path} contains an invalid key`);
                }
                normalized[key] = normalize(candidate[key], `${path}.${key}`);
            }
            ancestors.delete(candidate);
            return normalized;
        }
        throw new TypeError(`${path} contains an unsupported value`);
    };
    const serialized = JSON.stringify(normalize(value, '$'));
    if (Buffer.byteLength(serialized) > maximumBytes) {
        throw new RangeError('canonical JSON exceeds its byte limit');
    }
    return serialized;
}
