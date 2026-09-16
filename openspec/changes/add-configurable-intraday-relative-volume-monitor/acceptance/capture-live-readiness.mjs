import { writeFile } from 'node:fs/promises';
import { runLiveReadinessAudit } from '../../../../scripts/intraday-monitor-runtime/live-readiness-audit.mjs';

const [output, ...extra] = process.argv.slice(2);
if (!output || extra.length || !output.endsWith('.json')) {
    console.error('usage: node capture-live-readiness.mjs <new-evidence.json>');
    process.exit(2);
}
try {
    const report = await runLiveReadinessAudit();
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ output, assessment: report.assessment, passiveCapture: report.passiveCapture }, null, 2));
} catch (error) {
    const reason = ['simulation_not_confirmed', 'read_endpoint_failed'].includes(error.message) ? error.message :
        error.code === 'EEXIST' ? 'output_exists' : 'audit_failed';
    console.error(JSON.stringify({ reason }));
    process.exitCode = 2;
}
