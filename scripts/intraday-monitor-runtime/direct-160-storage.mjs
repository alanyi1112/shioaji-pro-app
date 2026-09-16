import { createHash, randomUUID } from 'node:crypto';
import { open, link, unlink, statfs } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';

const MiB = 1024 * 1024;
export const DIRECT_160_STORAGE = Object.freeze({
    schemaVersion: 'intraday-monitor-direct-160-storage/1',
    targetCount: 160,
    minuteCountPerDay: 43_200,
    sessionCanonicalBytes: 32 * MiB,
    captureOutputBytes: 64 * MiB,
    bundleCanonicalBytes: 128 * MiB,
    bundleOutputBytes: 128 * MiB,
    offlineFixtureBytes: 128 * MiB,
    streamTotalBytes: 128 * MiB,
    streamFrameBytes: 128 * 1024,
    logBytes: 16 * MiB,
    minimumAvailableDiskBytes: 8 * 1024 * MiB,
});

const KINDS = Object.freeze({ session: 'sessionCanonicalBytes', capture: 'captureOutputBytes',
    bundle: 'bundleCanonicalBytes', fixture: 'offlineFixtureBytes' });

function limit(kind) {
    if (!Object.hasOwn(KINDS, kind)) throw new TypeError('unknown direct-160 artifact kind');
    return DIRECT_160_STORAGE[KINDS[kind]];
}

export function canonicalDirect160(value, kind) {
    return canonicalJson(value, { maximumBytes: limit(kind) });
}

export function hashDirect160(value, kind) {
    return createHash('sha256').update(canonicalDirect160(value, kind)).digest('hex');
}

export function assessDirect160Disk(availableBytes, requiredBytes = DIRECT_160_STORAGE.minimumAvailableDiskBytes) {
    const valid = Number.isSafeInteger(availableBytes) && availableBytes >= 0 &&
        Number.isSafeInteger(requiredBytes) && requiredBytes >= DIRECT_160_STORAGE.minimumAvailableDiskBytes;
    return Object.freeze({ ready: valid && availableBytes >= requiredBytes, availableBytes,
        requiredBytes, reason: !valid ? 'invalid_disk_measurement' : availableBytes < requiredBytes ? 'insufficient_disk_reserve' : null });
}

// 專用離線／未來 160 路徑，不放寬既有 fixed-20 writer。失敗保留既有檔。
export async function writeDirect160Artifact(outputPath, value, kind) {
    if (!path.isAbsolute(outputPath)) throw new TypeError('absolute output path required');
    const serialized = `${canonicalDirect160(value, kind)}\n`;
    if (Buffer.byteLength(serialized) > limit(kind)) throw new RangeError('direct-160 output limit exceeded');
    const storage = await statfs(path.dirname(outputPath));
    const disk = assessDirect160Disk(storage.bavail * storage.bsize);
    if (!disk.ready) throw new Error(disk.reason);
    const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    let created = false;
    try {
        const file = await open(temporaryPath, 'wx', 0o600);
        created = true;
        try { await file.writeFile(serialized); await file.sync(); } finally { await file.close(); }
        await link(temporaryPath, outputPath);
        return { outputPath, bytes: Buffer.byteLength(serialized), sha256: createHash('sha256').update(serialized).digest('hex') };
    } finally {
        if (created) await unlink(temporaryPath);
    }
}
