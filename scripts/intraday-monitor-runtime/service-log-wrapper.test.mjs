import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { consumeLines, LOG_SCHEMA, MAX_ANALYSIS_BYTES, projectDiagnostic } from './service-log-wrapper.mjs';

const execute = promisify(execFile);
const wrapper = path.resolve('scripts/intraday-monitor-runtime/service-log-wrapper.mjs');

async function fixture(run) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'service-log-wrapper-'));
    const logPath = path.join(root, 'service.jsonl');
    const invoke = async (script, options = {}) => {
        let result;
        try {
            result = { code: 0, ...await execute(process.execPath,
                [wrapper, `--log=${logPath}`, '--', process.execPath, '-e', script],
                { timeout: 10_000, ...options }) };
        } catch (error) { result = error; }
        const content = await readFile(logPath, 'utf8').catch(() => '');
        return { ...result, content, events: content.trim().split('\n').filter(Boolean).map(JSON.parse) };
    };
    try { await run({ root, logPath, invoke }); }
    finally { await rm(root, { recursive: true, force: true }); }
}

describe('去敏 service JSONL log wrapper', () => {
    it('只保存事件分類與 hash，不保存 stdout／stderr 原文或秘密值', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'service-log-wrapper-'));
        const logPath = path.join(root, 'service.jsonl');
        try {
            await execute(process.execPath, [
                path.resolve('scripts/intraday-monitor-runtime/service-log-wrapper.mjs'),
                `--log=${logPath}`, '--', process.execPath, '-e',
                "console.log('login token=VERY_PRIVATE_VALUE'); console.error('kbar stream failed')",
            ]);
            const content = await readFile(logPath, 'utf8');
            expect(content).not.toContain('VERY_PRIVATE_VALUE');
            expect(content).not.toContain('kbar stream failed');
            const events = content.trim().split('\n').map(JSON.parse);
            expect(events[0].event).toBe('wrapper_start');
            expect(events.at(-1).event).toBe('process_exit');
            expect(new Set(events.filter((event) => event.messageHash).map((event) => event.event)))
                .toEqual(new Set(['business_session', 'market_data']));
            expect((await stat(logPath)).mode & 0o777).toBe(0o600);
            expect(events.filter((event) => event.messageHash)
                .every((event) => event.rawMessageSaved === false)).toBe(true);
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it.each([
        ['login failed: connect ECONNREFUSED host=private', 'connection_refused', 'ECONNREFUSED', 'business_session'],
        ['connect EAI_AGAIN', 'dns_resolution_failed', 'EAI_AGAIN', 'connection'],
        ['DNS failure ENOTFOUND', 'dns_resolution_failed', 'ENOTFOUND', 'connection'],
        ['connect ETIMEDOUT', 'connection_timeout', 'ETIMEDOUT', 'connection'],
        ['connect ECONNRESET', 'connection_reset', 'ECONNRESET', 'connection'],
        ['connect ENETUNREACH', 'network_unreachable', 'ENETUNREACH', 'connection'],
        ['connect EHOSTUNREACH', 'network_unreachable', 'EHOSTUNREACH', 'connection'],
        ['TLS CERT_HAS_EXPIRED', 'tls_verification_failed', 'CERT_HAS_EXPIRED', 'connection'],
        ['TLS DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_verification_failed', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'connection'],
        ['TLS UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls_verification_failed', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'connection'],
        ['TLS ERR_TLS_CERT_ALTNAME_INVALID', 'tls_verification_failed', 'ERR_TLS_CERT_ALTNAME_INVALID', 'connection'],
        ['SSL ERR_SSL_CERTIFICATE_VERIFY_FAILED', 'tls_verification_failed', 'ERR_SSL_CERTIFICATE_VERIFY_FAILED', 'connection'],
        ['bind EADDRINUSE', 'address_in_use', 'EADDRINUSE', 'listener_bind'],
        ['PermissionError EACCES', 'permission_denied', 'EACCES', 'unknown'],
        ['operation not permitted EPERM', 'permission_denied', 'EPERM', 'unknown'],
        ['no such file or directory ENOENT', 'missing_file', 'ENOENT', 'unknown'],
        ['login failed: invalid credentials', 'authentication_rejected', null, 'business_session'],
        ['login failed', 'business_session_failed', null, 'business_session'],
        ['failed to login', 'business_session_failed', null, 'business_session'],
        ['SessionNotEstablished', 'session_not_established', null, 'business_session'],
        ['智慧下單 Runtime 僅支援 Node.js LTS >=24.15.0 且 <25', 'runtime_contract_rejected', null, 'runtime_preflight'],
        ['找不到專案 .env；請先設定', 'configuration_missing', null, 'runtime_preflight'],
        ['Os { code: 61, kind: ConnectionRefused, message: "private endpoint" }', 'connection_refused', null, 'unknown'],
        ['fatal unexplained vendor output', 'unknown', null, 'unknown'],
    ])('安全投影 %s', (line, reason, code, stage) => {
        expect(projectDiagnostic(line)).toMatchObject({ reason, code, stage, evidence: 'pattern_match' });
    });

    it.each([
        ['HTTP/1.1 401 Unauthorized', 401, 'authentication_rejected'],
        ['HTTP status: 403', 403, 'http_forbidden'],
        ['HTTP 429 Too Many Requests', 429, 'rate_limited'],
        ['status_code=503', 503, 'http_server_error'],
        ['login failed: HTTP 503', 503, 'http_server_error'],
        ['status code 400', 400, 'http_error'],
    ])('只保留允許的 HTTP 狀態 %s', (line, httpStatus, reason) => {
        expect(projectDiagnostic(line)).toMatchObject({ httpStatus, reason });
    });

    it('解析有界 JSON 原因鏈，忽略帳務／header／request 等容器', () => {
        expect(projectDiagnostic(JSON.stringify({
            message: 'login failed', status: 503,
            error: { code: 'ECONNREFUSED', cause: { message: 'connect failed' } },
            account: 'PRIVATE_ACCOUNT', headers: { Authorization: 'Bearer PRIVATE_TOKEN' },
        }))).toMatchObject({ reason: 'connection_refused', code: 'ECONNREFUSED', httpStatus: 503, stage: 'business_session' });
        expect(projectDiagnostic(JSON.stringify({
            account: 'ECONNREFUSED', token: 'EACCES', request: { code: 'ENOENT' },
            message: 'unexplained',
        }))).toMatchObject({ reason: 'unknown', code: null });
    });

    it.each([
        'token=ECONNREFUSED', 'api_key=EACCES', 'Authorization: Bearer ENOENT',
        'https://private:pass@host/ECONNREFUSED?token=EACCES',
        '-----BEGIN PRIVATE KEY-----\nECONNREFUSED\n-----END PRIVATE KEY-----',
        'account_id=ECONNREFUSED', '"EACCES"',
    ])('敏感容器不能成為診斷證據 %s', (line) => {
        expect(projectDiagnostic(line)).toMatchObject({ reason: 'unknown', code: null, httpStatus: null });
    });

    it('多行／ANSI／JSON／URL／無標籤秘密皆不出現在 JSONL 或 console', async () => {
        await fixture(async ({ root, invoke }) => {
            const secrets = ['SYNTHETIC_ACCOUNT_71', 'SYNTHETIC_KEY_92', 'SYNTHETIC_TOKEN_83',
                'SYNTHETIC_PASSWORD_64', 'SYNTHETIC_UNLABELLED_55'];
            const lines = [
                `\x1b[31mlogin failed ECONNREFUSED account=${secrets[0]} api_key=${secrets[1]}\x1b[0m`,
                JSON.stringify({ message: 'SessionNotEstablished', token: secrets[2], account: secrets[0] }),
                `https://${secrets[0]}:${secrets[3]}@private.invalid/?token=${secrets[2]}`,
                'Authorization: Bearer '+secrets[2],
                '-----BEGIN PRIVATE KEY-----', secrets[1], '-----END PRIVATE KEY-----',
                secrets[4],
            ];
            const result = await invoke(`for (const line of ${JSON.stringify(lines)}) console.error(line); process.exitCode=7;`);
            expect(result.code).toBe(7);
            expect(result.stdout).toBe(''); expect(result.stderr).toBe('');
            for (const p of await readdir(root)) {
                const output = await readFile(path.join(root, p), 'utf8');
                for (const secret of secrets) expect(output).not.toContain(secret);
            }
            expect(result.events.find((event) => event.diagnostic?.code === 'ECONNREFUSED')).toBeDefined();
            expect(result.events.find((event) => event.diagnostic?.reason === 'session_not_established')).toBeDefined();
            expect(result.events.every((event) => event.schemaVersion === LOG_SCHEMA && event.rawMessageSaved === false)).toBe(true);
        });
    });

    it('非零退出前的未換行尾段、UTF-8 與跨 chunk 秘密不遺失／不洩漏', async () => {
        await fixture(async ({ invoke }) => {
            const script = `process.stderr.write('login failed: ECONN');
                setTimeout(() => { process.stderr.write('REFUSED token=SYNTHETIC_SPLIT_SECRET 中文'); process.exitCode=9; }, 15);`;
            const result = await invoke(script);
            expect(result.code).toBe(9);
            expect(result.content).not.toContain('SYNTHETIC_SPLIT_SECRET');
            const event = result.events.find((item) => item.messageHash);
            expect(event).toMatchObject({ unterminated: true, analysisTruncated: false,
                diagnostic: { code: 'ECONNREFUSED', stage: 'business_session' } });
            expect(result.events.at(-1)).toMatchObject({ event: 'process_exit', exitCode: 9,
                lineCount: 1, lastDiagnostic: { reason: 'connection_refused' } });
            expect(new Set(result.events.map((item) => item.attemptId)).size).toBe(1);
            expect(result.events.map((item) => item.sequence)).toEqual([0, 1, 2, 3]);
            expect(result.events.slice(1).every((item) => item.childPid === event.childPid && item.elapsedMs >= 0)).toBe(true);
        });
    });

    it('快速輸出雙 pipe 時等待排空，最後診斷在退出事件前', async () => {
        await fixture(async ({ invoke }) => {
            const result = await invoke(`for(let i=0;i<100;i++){ console.log('public output'); console.error('connect ECONNREFUSED'); } process.exitCode=3;`);
            expect(result.events.filter((event) => event.messageHash)).toHaveLength(200);
            expect(result.events.at(-1)).toMatchObject({ event: 'process_exit', exitCode: 3, lineCount: 200 });
            expect(result.events.map((item) => item.sequence)).toEqual(result.events.map((_, index) => index));
        });
    });

    it('spawn ENOENT 不保存私密命令路徑或 error.message', async () => {
        await fixture(async ({ root, logPath }) => {
            const target = path.join(root, 'SYNTHETIC_PRIVATE_COMMAND');
            await expect(execute(process.execPath, [wrapper, `--log=${logPath}`, '--', target], { timeout: 5000 }))
                .rejects.toMatchObject({ code: 1, stdout: '', stderr: '' });
            const content = await readFile(logPath, 'utf8');
            expect(content).not.toContain(target); expect(content).not.toContain('SYNTHETIC_PRIVATE_COMMAND');
            expect(JSON.parse(content.trim().split('\n').at(-1))).toMatchObject({
                event: 'process_exit', childPid: null, errorClass: 'spawn_error', spawnCode: 'ENOENT',
                lastDiagnostic: { code: 'ENOENT', reason: 'missing_file' },
            });
        });
    });

    it('跨多個 chunk 的超長行完整 hash，但分析前綴有界', async () => {
        const line = Buffer.from('connect ETIMEDOUT '+ 'x'.repeat(MAX_ANALYSIS_BYTES * 4) + 'SYNTHETIC_TAIL_SECRET');
        const chunks = [];
        for (let i = 0; i < line.length; i += 97) chunks.push(line.subarray(i, i + 97));
        const events = [];
        await consumeLines(Readable.from(chunks), async (event) => { events.push(event); });
        expect(events).toHaveLength(1);
        expect(Buffer.byteLength(events[0].line)).toBeLessThanOrEqual(MAX_ANALYSIS_BYTES);
        expect(events[0]).toMatchObject({ messageBytes: line.length, analysisTruncated: true, unterminated: true,
            messageHash: 'sha256:'+createHash('sha256').update(line).digest('hex') });
        expect(projectDiagnostic(events[0].line)).toMatchObject({ reason: 'connection_timeout' });
    });

    it('正常 CRLF、空行及 UTF-8 跨 byte chunk 皆可結束', async () => {
        const input = Buffer.from('\n中文 connect ECONNREFUSED\r\n\nlast');
        const events = [];
        await consumeLines(Readable.from([...input].map((byte) => Buffer.from([byte]))), async (event) => { events.push(event); });
        expect(events.map((event) => event.line)).toEqual(['中文 connect ECONNREFUSED\r', 'last']);
        expect(events.map((event) => event.unterminated)).toEqual([false, true]);
    });

    it('正式 JSONL 超長行標示截斷且不同啟動使用不同 attemptId', async () => {
        await fixture(async ({ invoke }) => {
            const first = await invoke(`console.error('connect ETIMEDOUT '+ 'x'.repeat(${MAX_ANALYSIS_BYTES * 2}));`);
            expect(first.events.at(-1)).toMatchObject({ truncatedLineCount: 1, exitCode: 0 });
            const second = await invoke('console.log("public");');
            const starts = second.events.filter((event) => event.event === 'wrapper_start');
            expect(new Set(starts.map((event) => event.attemptId)).size).toBe(2);
        });
    });

    it('收緊現存 log／目錄權限，輪替沿用 5 MiB／五份上限', async () => {
        await fixture(async ({ root, logPath, invoke }) => {
            await writeFile(logPath, 'x'.repeat(5 * 1024 * 1024), { mode: 0o644 });
            await chmod(root, 0o755);
            for(let i=1;i<=5;i++) await writeFile(logPath+'.'+i, 'old-'+i, { mode: 0o600 });
            const result = await invoke('console.error("connect ECONNREFUSED");');
            expect(result.code).toBe(0);
            expect((await stat(logPath)).mode & 0o777).toBe(0o600);
            expect((await stat(root)).mode & 0o777).toBe(0o700);
            expect((await stat(logPath+'.1')).size).toBe(5 * 1024 * 1024);
            expect((await stat(logPath+'.1')).mode & 0o777).toBe(0o600);
            expect(await readFile(logPath+'.5', 'utf8')).toBe('old-4');
            expect((await readdir(root)).filter((name) => name.startsWith('service.jsonl'))).toHaveLength(6);
        });
    });

    it('log symlink 與寫入失敗只回固定錯誤，不啟動子程序或洩漏路徑', async () => {
        await fixture(async ({ root, logPath }) => {
            const target = path.join(root, 'SYNTHETIC_PRIVATE_TARGET');
            await writeFile(target, 'SYNTHETIC_EXISTING_SECRET', { mode: 0o600 });
            await symlink(target, logPath);
            await expect(execute(process.execPath, [wrapper, `--log=${logPath}`, '--', process.execPath,
                '-e', 'console.log("CHILD_MUST_NOT_START");'], { timeout: 5000 }))
                .rejects.toMatchObject({ code: 1, stderr: 'service_log_write_failed code=EACCES\n', stdout: '' });
            expect(await readFile(target, 'utf8')).toBe('SYNTHETIC_EXISTING_SECRET');
        });
    });

    it('最後未知錯誤不得被較早的已知錯誤取代', async () => {
        await fixture(async ({ invoke }) => {
            const result = await invoke('console.error("connect ECONNREFUSED"); console.error("fatal vendor unknown"); process.exitCode=1;');
            expect(result.events.at(-1)).toMatchObject({
                lastDiagnostic: { reason: 'unknown' }, lastDiagnosticSequence: 3,
                lastKnownDiagnostic: { reason: 'connection_refused' }, lastKnownDiagnosticSequence: 2,
            });
        });
    });

    it('spawn EACCES 與 signal 結束可判讀，不回顯命令或堆疊', async () => {
        await fixture(async ({ root, logPath, invoke }) => {
            const target = path.join(root, 'SYNTHETIC_NO_EXEC');
            await writeFile(target, 'not executable', { mode: 0o600 });
            await expect(execute(process.execPath, [wrapper, `--log=${logPath}`, '--', target], { timeout: 5000 }))
                .rejects.toMatchObject({ code: 1, stdout: '', stderr: '' });
            const content = await readFile(logPath, 'utf8');
            expect(content).not.toContain(target);
            expect(JSON.parse(content.trim().split('\n').at(-1))).toMatchObject({
                spawnCode: 'EACCES', lastDiagnostic: { reason: 'permission_denied' },
            });
            const result = await invoke('process.stderr.write("connect ECONNREFUSED\\n"); process.kill(process.pid,"SIGTERM");');
            expect(result.events.at(-1)).toMatchObject({ exitCode: 1, signal: 'SIGTERM', lineCount: 1 });
        });
    });

    it('不能由子程序 argv 冒充 wrapper 的 log 參數，固定錯誤不洩漏參數', async () => {
        await fixture(async ({ root }) => {
            const target = path.join(root, 'SYNTHETIC_ARG_SECRET');
            await expect(execute(process.execPath, [wrapper, '--', process.execPath, `--log=${target}`], { timeout: 5000 }))
                .rejects.toMatchObject({ code: 1, stdout: '', stderr: 'service_log_wrapper_failed code=UNKNOWN\n' });
            expect(await readdir(root)).toEqual([]);
        });
    });

    it('只複製單檔至隔離目錄即可運作，不依賴 repo 或本機秘密', async () => {
        await fixture(async ({ root, logPath }) => {
            const copy = path.join(root, 'standalone-wrapper.mjs');
            await copyFile(wrapper, copy);
            await expect(execute(process.execPath, [copy, `--log=${logPath}`, '--', process.execPath,
                '-e', 'console.error("login failed: connect ETIMEDOUT"); process.exitCode=4;'],
            { cwd: root, timeout: 5000, env: { PATH: '/usr/bin:/bin' } }))
                .rejects.toMatchObject({ code: 4, stdout: '', stderr: '' });
            const events = (await readFile(logPath, 'utf8')).trim().split('\n').map(JSON.parse);
            expect(events.at(-1)).toMatchObject({ exitCode: 4,
                lastDiagnostic: { reason: 'connection_timeout', stage: 'business_session' } });
        });
    });
});
