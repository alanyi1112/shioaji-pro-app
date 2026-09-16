import { describe, expect, it } from 'vitest';
import { inspectBoundedKbarCaptureStart, inspectBoundedKbarRehearsalStart } from './capture-bounded-kbar-shadow.mjs';

describe('bounded KBar capture start window', () => {
    it('只允許完整日 recorder 在 08:50–09:00:30 啟動', () => {
        expect(inspectBoundedKbarCaptureStart('2026-09-08', Date.parse('2026-09-08T08:49:59+08:00')))
            .toEqual({ allowed: false, reason: 'capture_start_too_early' });
        expect(inspectBoundedKbarCaptureStart('2026-09-08', Date.parse('2026-09-08T08:50:00+08:00')))
            .toMatchObject({ allowed: true, reason: 'none', normalCloseMinute: '13:30',
                delayedCloseMinute: '13:33', closeFinalizationTime: '13:34:30',
                closeEpochMs: Date.parse('2026-09-08T13:34:30+08:00') });
        expect(inspectBoundedKbarCaptureStart('2026-09-08', Date.parse('2026-09-08T09:00:31+08:00')))
            .toEqual({ allowed: false, reason: 'full_session_start_missed' });
    });

    it('允許盤中有界 partial rehearsal，但不得跨越收盤或縮短到無法 seal 分鐘', () => {
        expect(inspectBoundedKbarRehearsalStart('2026-09-08', Date.parse('2026-09-08T11:00:00+08:00'), 180_000))
            .toMatchObject({ allowed: true, reason: 'none' });
        expect(inspectBoundedKbarRehearsalStart('2026-09-08', Date.parse('2026-09-08T11:00:00+08:00'), 60_000))
            .toEqual({ allowed: false, reason: 'invalid_rehearsal_input' });
        expect(inspectBoundedKbarRehearsalStart('2026-09-08', Date.parse('2026-09-08T13:29:00+08:00'), 120_000))
            .toEqual({ allowed: false, reason: 'rehearsal_would_cross_close' });
    });
});
