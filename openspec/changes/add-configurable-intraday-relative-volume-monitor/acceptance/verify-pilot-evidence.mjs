import { readFile } from 'node:fs/promises';
import process from 'node:process';

import {
    INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_SCHEMA,
    validateIntradayMonitorFunctionalAcceptanceBundle,
} from '../../../../scripts/intraday-monitor-runtime/pilot-acceptance-bundle.mjs';
import { validateIntradayMonitorPilotEvidenceBundle } from '../../../../scripts/intraday-monitor-runtime/pilot-shadow-evidence.mjs';

const inputPath = process.argv[2];
if (!inputPath || process.argv.length !== 3) {
    console.error('usage: node verify-pilot-evidence.mjs <evidence-bundle.json>');
    process.exit(2);
}

let input;
try {
    input = JSON.parse(await readFile(inputPath, 'utf8'));
} catch {
    console.error(JSON.stringify({ valid: false, reason: 'unreadable_or_invalid_json' }));
    process.exit(2);
}

const result = input?.schemaVersion === INTRADAY_MONITOR_FUNCTIONAL_ACCEPTANCE_BUNDLE_SCHEMA
    ? validateIntradayMonitorFunctionalAcceptanceBundle(input)
    : validateIntradayMonitorPilotEvidenceBundle(input);
console.log(JSON.stringify(result, null, 2));
process.exit(result.readyForHumanReview ? 0 : 1);
