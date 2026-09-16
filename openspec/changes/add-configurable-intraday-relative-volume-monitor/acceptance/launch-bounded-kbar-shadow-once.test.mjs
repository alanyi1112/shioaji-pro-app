import { describe, expect, it } from 'vitest';

import { buildOneShotKbarCaptureLaunchAgent } from './launch-bounded-kbar-shadow-once.mjs';

describe('one-shot KBar capture LaunchAgent', () => {
    it('明確停用 KeepAlive 並完整保留固定 cohort 與 output 參數', () => {
        const plist = buildOneShotKbarCaptureLaunchAgent({
            label: 'com.alanyi.realtimestock.intraday-kbar-shadow-20260910',
            nodePath: '/opt/homebrew/bin/node',
            captureScript: '/repo/acceptance/capture-bounded-kbar-shadow.mjs',
            cohortPath: '/repo/acceptance/pilot-cohort-receipts.json',
            tradeDate: '2026-09-10',
            outputPath: '/repo/acceptance/kbar-shadow-2026-09-10.json',
            logPath: '/tmp/realtimestock-kbar-shadow-2026-09-10.log',
        });
        expect(plist).toContain('<key>KeepAlive</key>\n    <false/>');
        expect(plist).toContain('<key>RunAtLoad</key>\n    <true/>');
        expect(plist).toContain('<string>--mode=full-session</string>');
        expect(plist).toContain('<string>--trade-date=2026-09-10</string>');
        expect(plist).toContain('<string>--output=/repo/acceptance/kbar-shadow-2026-09-10.json</string>');
        expect(plist).not.toContain('<key>KeepAlive</key>\n    <true/>');
    });

    it('拒絕寬廣或不合法的 label／路徑', () => {
        expect(() => buildOneShotKbarCaptureLaunchAgent({
            label: 'invalid', nodePath: '/node', captureScript: '/capture', cohortPath: '/cohort',
            tradeDate: '2026-09-10', outputPath: '/output', logPath: '/tmp/log',
        })).toThrow('one-shot capture launch options are invalid');
        expect(() => buildOneShotKbarCaptureLaunchAgent({
            label: 'com.alanyi.realtimestock.intraday-kbar-shadow-20260910',
            nodePath: 'node', captureScript: '/capture', cohortPath: '/cohort',
            tradeDate: '2026-09-10', outputPath: '/output', logPath: '/tmp/log',
        })).toThrow('one-shot capture launch options are invalid');
    });
});
