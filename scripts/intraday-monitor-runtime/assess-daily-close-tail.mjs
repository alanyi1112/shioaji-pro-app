import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { publishCloseTailException } from './daily-close-tail-exception.mjs';

// Derived assessment only. This entry has no collector or broker transport port.
export async function assessCompletedDailyCloseTail({ root, tradeDate } = {}) {
    if (!path.isAbsolute(root ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate ?? ''))
        throw new Error('close_tail_inputs_invalid');
    const directory = path.join(root, 'IntradayMonitor', 'daily-minute-volume-collection', tradeDate);
    for (let attempt = 1; attempt <= 3; attempt++) {
        let receipt;
        try {
            receipt = JSON.parse(await readFile(path.join(directory,
                `attempt-${String(attempt).padStart(2, '0')}-receipt.json`), 'utf8'));
        } catch (error) {
            if (error?.code === 'ENOENT') continue;
            throw error;
        }
        if (receipt.outcome === 'complete') return publishCloseTailException({ root, tradeDate,
            collectionReceipt: receipt, assessmentTrigger: 'operator_after_original_collection' });
    }
    return { state: 'pending_postclose', reason: 'complete_original_receipt_required',
        liveAcceptance: false, notificationAuthority: false, brokerWriteAuthority: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--source-date') throw new Error('usage: --source-date YYYY-MM-DD');
    const root = path.join(os.homedir(), 'Library', 'Application Support', 'RealTimeStock');
    const result = await assessCompletedDailyCloseTail({ root, tradeDate: args[1] });
    console.log(JSON.stringify({ state: result.state, reason: result.reason ?? null,
        file: result.file ?? null, alreadyPresent: result.alreadyPresent ?? false,
        evidenceHash: result.evidenceHash ?? null, rowCount: result.rows?.length ?? 0 }));
}
