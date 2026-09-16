import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function classify(line, stream) {
    const value = line.toLowerCase();
    if (/login|auth|session.*establish/.test(value)) return 'business_session';
    if (/subscribe|unsubscribe/.test(value)) return 'subscription';
    if (/kbar|quote|stream|websocket|sse/.test(value)) return 'market_data';
    if (/error|exception|failed|traceback/.test(value) || stream === 'stderr') return 'error';
    return 'process_output';
}

async function append(logPath, event) {
    await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
    try {
        if ((await stat(logPath)).size >= 5 * 1024 * 1024) {
            for (let index = 4; index >= 1; index -= 1) {
                await rename(`${logPath}.${index}`, `${logPath}.${index + 1}`).catch(() => {});
            }
            await rename(logPath, `${logPath}.1`);
        }
    } catch {}
    const handle = await open(logPath, 'a', 0o600);
    try { await handle.writeFile(`${JSON.stringify(event)}\n`); }
    finally { await handle.close(); }
}

async function main() {
    const separator = process.argv.indexOf('--');
    const logPath = process.argv.find((value) => value.startsWith('--log='))?.slice(6);
    if (!path.isAbsolute(logPath ?? '') || separator < 0 || !process.argv[separator + 1]) {
        throw new TypeError('service log wrapper arguments are invalid');
    }
    const command = process.argv[separator + 1];
    const args = process.argv.slice(separator + 2);
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    await append(logPath, { schemaVersion: 'realtimestock-redacted-service-log/1',
        event: 'process_start', at: new Date().toISOString(), pid: child.pid ?? null,
        command: path.basename(command), argumentCount: args.length });
    let pendingWrites = Promise.resolve();
    const enqueue = (event) => {
        pendingWrites = pendingWrites.then(() => append(logPath, event));
    };
    const pending = { stdout: '', stderr: '' };
    const accept = (stream, chunk) => {
        pending[stream] += chunk.toString('utf8').replace(/\r/g, '');
        const lines = pending[stream].split('\n');
        pending[stream] = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.trim()) continue;
            enqueue({ schemaVersion: 'realtimestock-redacted-service-log/1',
                event: classify(line, stream), stream, at: new Date().toISOString(),
                messageHash: `sha256:${createHash('sha256').update(line).digest('hex')}`,
                messageBytes: Buffer.byteLength(line), rawMessageSaved: false });
        }
    };
    child.stdout.on('data', (chunk) => accept('stdout', chunk));
    child.stderr.on('data', (chunk) => accept('stderr', chunk));
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
    const result = await new Promise((resolve) => {
        child.once('error', (error) => resolve({ code: 1, signal: null, error: error.message }));
        child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal, error: null }));
    });
    await pendingWrites;
    await append(logPath, { schemaVersion: 'realtimestock-redacted-service-log/1',
        event: 'process_exit', at: new Date().toISOString(), exitCode: result.code,
        signal: result.signal, errorClass: result.error ? 'spawn_error' : null,
        rawMessageSaved: false });
    process.exitCode = result.code;
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
