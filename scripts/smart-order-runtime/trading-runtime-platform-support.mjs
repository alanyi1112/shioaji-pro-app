import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFile = promisify(execFileCallback);

export const SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY =
    'smart-order-trading-runtime-platform/native-apple-silicon-arm64/2026-08-22.1';

export function assertSmartOrderTradingRuntimePlatformFacts({
    operatingSystem,
    processArch,
    unameMachine,
    sysctlOptionalArm64,
    hypervisorPresent,
}) {
    if (
        operatingSystem !== 'darwin' ||
        processArch !== 'arm64' ||
        unameMachine !== 'arm64' ||
        sysctlOptionalArm64 !== 1 ||
        hypervisorPresent !== 0
    ) {
        throw new Error(
            'smart-order trading Runtime requires native physical Apple Silicon arm64 macOS; x64, Rosetta, VM, Windows, and Linux are unsupported',
        );
    }
    return Object.freeze({
        supportPolicy: SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY,
        operatingSystem: 'darwin',
        processArch: 'arm64',
        hardwareArch: 'arm64',
        unameMachine: 'arm64',
        sysctlOptionalArm64: 1,
        hypervisorPresent: 0,
        nativeArchitecture: true,
    });
}

export async function readSmartOrderTradingRuntimePlatformSupport({
    operatingSystem = process.platform,
    processArch = process.arch,
    execFileImpl = execFile,
} = {}) {
    if (operatingSystem !== 'darwin') {
        return assertSmartOrderTradingRuntimePlatformFacts({
            operatingSystem,
            processArch,
            unameMachine: 'unsupported',
            sysctlOptionalArm64: -1,
            hypervisorPresent: -1,
        });
    }
    if (typeof execFileImpl !== 'function') {
        throw new TypeError('platform execFile implementation is required');
    }
    const [{ stdout: unameOutput }, { stdout: sysctlOutput }] =
        await Promise.all([
            execFileImpl('/usr/bin/uname', ['-m'], {
                encoding: 'utf8',
                timeout: 2_000,
            }),
            execFileImpl(
                '/usr/sbin/sysctl',
                ['-n', 'hw.optional.arm64', 'kern.hv_vmm_present'],
                {
                    encoding: 'utf8',
                    timeout: 2_000,
                },
            ),
        ]);
    const [sysctlOptionalArm64, hypervisorPresent] = String(sysctlOutput)
        .trim()
        .split(/\s+/)
        .map(Number);
    return assertSmartOrderTradingRuntimePlatformFacts({
        operatingSystem,
        processArch,
        unameMachine: String(unameOutput).trim(),
        sysctlOptionalArm64,
        hypervisorPresent,
    });
}

async function main() {
    const support = await readSmartOrderTradingRuntimePlatformSupport();
    process.stdout.write(`${JSON.stringify(support)}\n`);
}

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
    main().catch((error) => {
        process.stderr.write(`smart_order_platform=unsupported:${error?.name ?? 'Error'}\n`);
        process.exitCode = 1;
    });
}
