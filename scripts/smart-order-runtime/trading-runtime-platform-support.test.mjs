import { describe, expect, it, vi } from 'vitest';
import {
    SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY,
    assertSmartOrderTradingRuntimePlatformFacts,
    readSmartOrderTradingRuntimePlatformSupport,
} from './trading-runtime-platform-support.mjs';

const nativeArm64 = Object.freeze({
    operatingSystem: 'darwin',
    processArch: 'arm64',
    unameMachine: 'arm64',
    sysctlOptionalArm64: 1,
    hypervisorPresent: 0,
});

describe('smart-order trading Runtime platform support', () => {
    it('accepts only a native physical Apple Silicon arm64 macOS process', () => {
        expect(assertSmartOrderTradingRuntimePlatformFacts(nativeArm64)).toEqual({
            supportPolicy: SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY,
            operatingSystem: 'darwin',
            processArch: 'arm64',
            hardwareArch: 'arm64',
            unameMachine: 'arm64',
            sysctlOptionalArm64: 1,
            hypervisorPresent: 0,
            nativeArchitecture: true,
        });
    });

    it.each([
        ['native Intel x64', { processArch: 'x64', unameMachine: 'x86_64', sysctlOptionalArm64: 0 }],
        ['Rosetta', { processArch: 'x64', unameMachine: 'x86_64' }],
        ['Apple Silicon VM', { hypervisorPresent: 1 }],
        ['Windows', { operatingSystem: 'win32', unameMachine: 'unsupported' }],
        ['Linux', { operatingSystem: 'linux', unameMachine: 'unsupported' }],
    ])('rejects %s before Runtime authority can start', (_label, overrides) => {
        expect(() =>
            assertSmartOrderTradingRuntimePlatformFacts({
                ...nativeArm64,
                ...overrides,
            }),
        ).toThrow('requires native physical Apple Silicon arm64 macOS');
    });

    it('reads the native facts from fixed macOS binaries', async () => {
        const execFileImpl = vi.fn(async (file) => ({
            stdout: file === '/usr/bin/uname' ? 'arm64\n' : '1\n0\n',
        }));
        await expect(
            readSmartOrderTradingRuntimePlatformSupport({
                operatingSystem: 'darwin',
                processArch: 'arm64',
                execFileImpl,
            }),
        ).resolves.toMatchObject({
            supportPolicy: SMART_ORDER_TRADING_RUNTIME_PLATFORM_POLICY,
            hardwareArch: 'arm64',
        });
        expect(execFileImpl).toHaveBeenCalledTimes(2);
    });

    it('rejects non-macOS without invoking any host command', async () => {
        const execFileImpl = vi.fn();
        await expect(
            readSmartOrderTradingRuntimePlatformSupport({
                operatingSystem: 'linux',
                processArch: 'x64',
                execFileImpl,
            }),
        ).rejects.toThrow('requires native physical Apple Silicon arm64 macOS');
        expect(execFileImpl).not.toHaveBeenCalled();
    });
});
