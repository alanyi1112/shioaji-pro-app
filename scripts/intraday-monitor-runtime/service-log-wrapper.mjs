import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants, realpathSync } from 'node:fs';
import { chmod, lstat, mkdir, open, rename } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const LOG_SCHEMA = 'realtimestock-redacted-service-log/2';
export const MAX_ANALYSIS_BYTES = 16 * 1024;
const ROTATE_BYTES = 5 * 1024 * 1024;
const CODE_REASONS = {
    EAI_AGAIN: 'dns_resolution_failed', ENOTFOUND: 'dns_resolution_failed',
    ECONNREFUSED: 'connection_refused', ETIMEDOUT: 'connection_timeout',
    ECONNRESET: 'connection_reset', ENETUNREACH: 'network_unreachable',
    EHOSTUNREACH: 'network_unreachable', EADDRINUSE: 'address_in_use',
    EACCES: 'permission_denied', EPERM: 'permission_denied', ENOENT: 'missing_file',
    CERT_HAS_EXPIRED: 'tls_verification_failed',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'tls_verification_failed',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls_verification_failed',
    ERR_TLS_CERT_ALTNAME_INVALID: 'tls_verification_failed',
    ERR_SSL_CERTIFICATE_VERIFY_FAILED: 'tls_verification_failed',
};
const SAFE_CODES = new Set(Object.keys(CODE_REASONS));
const SUMMARIES = {
    dns_resolution_failed: 'DNS 名稱解析失敗', connection_refused: '連線遭拒',
    connection_timeout: '連線或請求逾時', connection_reset: '連線遭重設',
    network_unreachable: '網路或主機無法到達', address_in_use: '監聽位址已被使用',
    permission_denied: '作業系統拒絕權限', missing_file: '必要檔案或執行檔不存在',
    tls_verification_failed: 'TLS 憑證驗證失敗', authentication_rejected: '認證遭拒',
    business_session_failed: '行情登入或 session 初始化失敗；原因未識別', http_forbidden: 'HTTP 請求遭禁止；原因未識別',
    session_not_established: '行情業務 session 尚未建立', rate_limited: '請求受到限流',
    http_server_error: 'HTTP 伺服器回報錯誤；端點未識別', http_error: 'HTTP 請求失敗',
    runtime_contract_rejected: '本機 runtime 前置契約未通過',
    configuration_missing: '必要本機設定不存在', unknown: '未識別錯誤；原文省略',
};
const REASON_PATTERNS = [
    ['session_not_established', /\bSessionNotEstablished\b|session (?:is )?not established/i],
    ['dns_resolution_failed', /name (?:or service not known|resolution)|failed to resolve|dns (?:error|failure)/i],
    ['connection_refused', /connection refused|\bConnectionRefused\b/i],
    ['connection_timeout', /\b(?:ConnectTimeout|ReadTimeout|TimeoutError|TimedOut)\b|timed out|connection timeout/i],
    ['connection_reset', /connection reset/i],
    ['network_unreachable', /(?:network|host) (?:is )?unreachable|no route to host/i],
    ['tls_verification_failed', /certificate (?:verify|verification) failed|invalid peer certificate|certificate has expired|self.signed certificate/i],
    ['address_in_use', /address already in use|\bAddrInUse\b/i],
    ['permission_denied', /permission denied|operation not permitted|\b(?:PermissionError|PermissionDenied)\b/i],
    ['missing_file', /no such file or directory|\bFileNotFoundError\b/i],
    ['authentication_rejected', /(?:invalid|expired|revoked) (?:api[ _-]?key|credentials?|access token)|(?:authentication|login|authorization) (?:rejected|denied|unauthorized)/i],
    ['runtime_contract_rejected', /persisted Node runtime path|智慧下單 Runtime (?:需要|僅支援)|REALTIME_STOCK_APP_SUPPORT 必須/i],
    ['configuration_missing', /找不到專案 \.env|missing (?:required )?(?:configuration|environment variable)/i],
    ['business_session_failed', /(?:authentication|login|session) failed|failed to (?:login|log in|establish session)/i],
];

// Only fixed projections leave this function. No substring from input is logged.
function diagnosticInput(input, depth = 0) {
    const text = String(input).slice(0, MAX_ANALYSIS_BYTES)
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    if (depth < 4 && /^\s*\{/.test(text)) {
        try {
            const record = JSON.parse(text);
            const allowed = new Set(['message', 'msg', 'error', 'cause', 'code', 'errorcode',
                'reason', 'detail', 'description', 'name', 'kind', 'type', 'status', 'statuscode']);
            return Object.entries(record).filter(([key]) => allowed.has(key.toLowerCase().replace(/[_-]/g, '')))
                .slice(0, 16).map(([key, value]) => {
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        return diagnosticInput(JSON.stringify(value), depth + 1);
                    }
                    if (typeof value !== 'string' && typeof value !== 'number') return '';
                    const safe = diagnosticInput(String(value), depth + 1);
                    return /^(?:status|statuscode)$/i.test(key.replace(/[_-]/g, ''))
                        ? `HTTP status ${safe}` : safe;
                }).join(' ');
        } catch { /* Non-JSON text is projected, never copied. */ }
    }
    return text
        .replace(/-----BEGIN[\s\S]*/g, ' ')
        .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>]+/gi, ' ')
        .replace(/\b(?:authorization|proxy.authorization|cookie|set.cookie|api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|account(?:[_-]?(?:id|no|number))?|username|user[_-]?id|person[_-]?id|身分證|帳號|密碼|金鑰)["']?\s*[:=][\s\S]*/gi, ' ')
        .replace(/\b(?:Bearer|Basic)\s+\S+/gi, ' ')
        .replace(/"[^"\n]*"|'[^'\n]*'/g, ' ');
}

export function projectDiagnostic(input) {
    const value = diagnosticInput(input);
    const code = value.match(/\b(?:E[A-Z_]{3,48}|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\b/g)
        ?.find((candidate) => SAFE_CODES.has(candidate)) ?? null;
    const match = value.match(/\b(?:HTTP(?:\/[123](?:\.[01])?)?(?: status)?|status(?:_code| code)?)\s*[:=]?\s*([45]\d{2})\b/i);
    const status = match && [400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504].includes(Number(match[1]))
        ? Number(match[1]) : null;
    let reason = code ? CODE_REASONS[code] : REASON_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0];
    // An HTTP status is stronger evidence than a generic "login failed" line.
    if ((!reason || reason === 'business_session_failed') && status) reason = status === 429 ? 'rate_limited'
        : status === 401 ? 'authentication_rejected' : status === 403 ? 'http_forbidden'
            : status >= 500 ? 'http_server_error' : 'http_error';
    reason ??= 'unknown';
    const stage = ['runtime_contract_rejected', 'configuration_missing'].includes(reason) ? 'runtime_preflight'
        : reason === 'session_not_established' || /\blogin\b|\bauth(?:entication|orization)?\b|session/i.test(value) ? 'business_session'
            : reason === 'address_in_use' || /\bbind\b|\blisten(?:er|ing)?\b/i.test(value) ? 'listener_bind'
                : /\b(?:connect|dns|tls|ssl)\b/i.test(value) || code && /^(?:EAI|ENOTFOUND|ECONN|ETIMEDOUT|ENET|EHOST|CERT|DEPTH|UNABLE|ERR_TLS|ERR_SSL)/.test(code)
                    ? 'connection' : 'unknown';
    return { reason, code, httpStatus: status, stage, summary: SUMMARIES[reason], evidence: 'pattern_match' };
}

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
    const directory = await lstat(path.dirname(logPath));
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw Object.assign(new Error(), { code: 'EACCES' });
    await chmod(path.dirname(logPath), 0o700);
    try {
        const file = await lstat(logPath);
        if (!file.isFile() || file.isSymbolicLink()) throw Object.assign(new Error(), { code: 'EACCES' });
        await chmod(logPath, 0o600);
        if (file.size >= ROTATE_BYTES) {
            for (let index = 4; index >= 1; index -= 1) {
                try { await rename(`${logPath}.${index}`, `${logPath}.${index + 1}`); }
                catch (error) { if (error.code !== 'ENOENT') throw error; }
            }
            await rename(logPath, `${logPath}.1`);
        }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const handle = await open(logPath, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
        await handle.chmod(0o600);
        await handle.writeFile(`${JSON.stringify(event)}\n`);
    } finally { await handle.close(); }
}

// Each pipe awaits its write: at most two writes wait on the shared queue.
// Hash the whole line, keeping only the bounded prefix for analysis.
export async function consumeLines(readable, emit) {
    let hash = createHash('sha256');
    let prefix = Buffer.alloc(0);
    let bytes = 0;
    async function flush(unterminated) {
        if (bytes === 0) return;
        await emit({ line: prefix.toString('utf8'), messageHash: `sha256:${hash.digest('hex')}`,
            messageBytes: bytes, analysisTruncated: bytes > MAX_ANALYSIS_BYTES, unterminated });
        hash = createHash('sha256'); prefix = Buffer.alloc(0); bytes = 0;
    }
    for await (const chunk of readable) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        let offset = 0;
        while (offset < buffer.length) {
            const end = buffer.indexOf(10, offset);
            const part = buffer.subarray(offset, end < 0 ? buffer.length : end);
            hash.update(part); bytes += part.length;
            if (prefix.length < MAX_ANALYSIS_BYTES) {
                prefix = Buffer.concat([prefix, part.subarray(0, MAX_ANALYSIS_BYTES - prefix.length)]);
            }
            if (end < 0) break;
            await flush(false);
            offset = end + 1;
        }
    }
    await flush(true);
}

export async function main(argv = process.argv.slice(2)) {
    const separator = argv.indexOf('--');
    const logPath = argv.slice(0, separator).find((value) => value.startsWith('--log='))?.slice(6);
    if (!path.isAbsolute(logPath ?? '') || separator < 0 || !argv[separator + 1]) throw new TypeError();
    const command = argv[separator + 1];
    const args = argv.slice(separator + 2);
    const attemptId = randomUUID();
    const startedAt = performance.now();
    let childPid = null;
    let sequence = 0;
    let writes = Promise.resolve();
    let loggingFailed = false;
    const record = (fields) => {
        const event = { schemaVersion: LOG_SCHEMA, attemptId, childPid, sequence: sequence++,
            at: new Date().toISOString(), elapsedMs: Math.floor(performance.now() - startedAt),
            rawMessageSaved: false, ...fields };
        writes = writes.then(() => append(logPath, event)).catch((error) => {
            if (!loggingFailed) {
                const code = SAFE_CODES.has(error.code) ? error.code : 'UNKNOWN';
                process.stderr.write(`service_log_write_failed code=${code}\n`);
            }
            loggingFailed = true;
        });
        return writes;
    };
    // Check a private writable log before spawn. Never perform a recovery action.
    await record({ event: 'wrapper_start' });
    if (loggingFailed) { process.exitCode = 1; return; }
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    childPid = child.pid ?? null;
    let spawnCode = null;
    const closed = new Promise((resolve) => {
        child.once('error', (error) => { spawnCode = SAFE_CODES.has(error.code) ? error.code : 'UNKNOWN'; });
        child.once('close', (code, signal) => resolve({ code: code ?? 1, signal }));
    });
    const onTerm = () => child.kill('SIGTERM');
    const onInt = () => child.kill('SIGINT');
    process.once('SIGTERM', onTerm);
    process.once('SIGINT', onInt);
    let lastDiagnostic = projectDiagnostic('');
    let lastKnownDiagnostic = null;
    let lastDiagnosticSequence = null;
    let lastKnownDiagnosticSequence = null;
    let lineCount = 0;
    let truncatedLineCount = 0;
    const consume = (stream) => consumeLines(child[stream], async ({ line, ...metadata }) => {
        const event = classify(line, stream);
        const diagnostic = projectDiagnostic(line);
        lineCount++;
        if (metadata.analysisTruncated) truncatedLineCount++;
        const isDiagnostic = diagnostic.reason !== 'unknown' || event === 'error' || /error|failed|exception|panic/i.test(line);
        if (isDiagnostic) { lastDiagnostic = diagnostic; lastDiagnosticSequence = sequence; }
        if (diagnostic.reason !== 'unknown') {
            lastKnownDiagnostic = diagnostic; lastKnownDiagnosticSequence = sequence;
        }
        await record({ event, stream, ...metadata, ...(isDiagnostic ? { diagnostic } : {}) });
    });
    try {
        await record({ event: 'process_start', pid: childPid,
            command: ['shioaji', 'realtimestock-runtime', 'node', 'zsh'].includes(path.basename(command))
                ? path.basename(command) : 'other', argumentCount: args.length });
        const [result] = await Promise.all([closed, consume('stdout'), consume('stderr')]);
        if (spawnCode) {
            lastDiagnostic = projectDiagnostic(spawnCode);
            lastKnownDiagnostic = lastDiagnostic.reason === 'unknown' ? null : lastDiagnostic;
            lastDiagnosticSequence = sequence;
            lastKnownDiagnosticSequence = lastKnownDiagnostic ? sequence : null;
        }
        const exitCode = spawnCode || result.code < 0 ? 1 : result.code;
        await record({ event: 'process_exit', exitCode, signal: result.signal,
            errorClass: spawnCode ? 'spawn_error' : null, spawnCode,
            lineCount, truncatedLineCount, lastDiagnostic, lastDiagnosticSequence,
            lastKnownDiagnostic, lastKnownDiagnosticSequence });
        process.exitCode = exitCode || (loggingFailed ? 1 : 0);
    } finally {
        process.removeListener('SIGTERM', onTerm);
        process.removeListener('SIGINT', onInt);
    }
}

// macOS /var and /private/var may name the same entry; compare real paths.
let isMain = false;
try { isMain = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
catch { /* Importing the pure helpers does not run the CLI. */ }
if (isMain) {
    main().catch((error) => {
        const code = SAFE_CODES.has(error.code) ? error.code : 'UNKNOWN';
        process.stderr.write(`service_log_wrapper_failed code=${code}\n`);
        process.exitCode = 1;
    });
}
