#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './smart-order-runtime/canonical-json.mjs';
import { readSmartOrderTradingRuntimePlatformSupport } from './smart-order-runtime/trading-runtime-platform-support.mjs';
import {
    ensureNodeSqliteCapabilityHostSigningIdentity,
    importNodeSqliteCapabilityReport,
    writeNodeSqliteCapabilityTrustedHost,
} from './smart-order-runtime/node-sqlite-capability-host-attestation.mjs';

async function readBoundedNoFollowJson(filePath, maximumBytes) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
        throw new TypeError('admin input must be an explicit absolute path');
    }
    const handle = await open(
        path.resolve(filePath),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    let metadata;
    let bytes;
    try {
        metadata = await handle.stat();
        if (
            !metadata.isFile() ||
            metadata.size < 2 ||
            metadata.size > maximumBytes ||
            (metadata.mode & 0o077) !== 0 ||
            (typeof process.getuid === 'function' &&
                metadata.uid !== process.getuid())
        ) {
            throw new Error('admin input must be a current-user private file');
        }
        bytes = await handle.readFile();
    } finally {
        await handle.close();
    }
    const current = await lstat(filePath);
    if (
        current.isSymbolicLink() ||
        current.dev !== metadata.dev ||
        current.ino !== metadata.ino ||
        current.size !== metadata.size ||
        current.mtimeMs !== metadata.mtimeMs
    ) {
        bytes?.fill(0);
        throw new Error('admin input changed while reading');
    }
    try {
        return JSON.parse(bytes.toString('utf8'));
    } finally {
        bytes.fill(0);
    }
}

async function main() {
    const appSupportRoot = process.env.REALTIME_STOCK_NODE_SQLITE_APP_SUPPORT;
    const command = process.argv[2];
    if (!appSupportRoot || !path.isAbsolute(appSupportRoot)) {
        throw new Error('managed app-support binding is required');
    }
    await readSmartOrderTradingRuntimePlatformSupport();
    if (command === 'host-public') {
        const architecture = process.arch;
        if (architecture !== 'arm64') {
            throw new Error('host-public requires native Apple Silicon arm64');
        }
        const identity = await ensureNodeSqliteCapabilityHostSigningIdentity({
            appSupportRoot,
            architecture,
        });
        process.stdout.write(`${canonicalJson(identity.publicRecord)}\n`);
        return;
    }
    if (command === 'trust-host') {
        const [host, report] = await Promise.all([
            readBoundedNoFollowJson(process.argv[3], 8_192),
            readBoundedNoFollowJson(process.argv[4], 128 * 1024),
        ]);
        const result = await writeNodeSqliteCapabilityTrustedHost({
            appSupportRoot,
            host,
            report,
        });
        process.stdout.write(`${canonicalJson(result)}\n`);
        return;
    }
    if (command === 'import-report') {
        const architecture = process.argv[3];
        const report = await readBoundedNoFollowJson(
            process.argv[4],
            128 * 1024,
        );
        const result = await importNodeSqliteCapabilityReport({
            appSupportRoot,
            architecture,
            report,
        });
        process.stdout.write(`${canonicalJson(result)}\n`);
        return;
    }
    throw new Error('unsupported Node SQLite capability admin command');
}

await main();
