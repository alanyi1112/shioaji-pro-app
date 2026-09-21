import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
    collectIntradayMonitorAcceptanceDossierRefs,
    validateIntradayMonitorAcceptanceDossier,
} from '../../../../../scripts/intraday-monitor-runtime/acceptance-dossier.mjs';

const inputPath = process.argv[2];
if (!inputPath || process.argv.length !== 3) {
    console.error('usage: node verify-acceptance-dossier.mjs <acceptance-dossier.json>');
    process.exit(2);
}

let dossier;
try {
    dossier = JSON.parse(await readFile(inputPath, 'utf8'));
} catch {
    console.error(JSON.stringify({
        valid: false,
        readyForArchive: false,
        reasons: ['unreadable_or_invalid_json'],
    }));
    process.exit(2);
}

const structural = validateIntradayMonitorAcceptanceDossier(dossier);
if (!structural.valid) {
    console.log(JSON.stringify(structural, null, 2));
    process.exit(1);
}

const changeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fileReasons = [];
for (const ref of collectIntradayMonitorAcceptanceDossierRefs(dossier)) {
    const absolutePath = path.resolve(changeRoot, ref.path);
    if (absolutePath !== changeRoot && !absolutePath.startsWith(`${changeRoot}${path.sep}`)) {
        fileReasons.push(`evidence_path_outside_change:${ref.path}`);
        continue;
    }
    try {
        const digest = createHash('sha256')
            .update(await readFile(absolutePath))
            .digest('hex');
        if (digest !== ref.sha256) fileReasons.push(`evidence_hash_mismatch:${ref.path}`);
    } catch {
        fileReasons.push(`evidence_unreadable:${ref.path}`);
    }
}

const reasons = [...new Set([...structural.reasons, ...fileReasons])].sort();
const result = {
    ...structural,
    readyForArchive: structural.readyForArchive && fileReasons.length === 0,
    reasons,
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.readyForArchive ? 0 : 1);
