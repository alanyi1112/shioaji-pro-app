import { expect, it } from 'vitest';
import { liveDataStatus } from './multiview-live-status.mjs';

it('schema/global health success does not claim data completeness', () => {
  const result = liveDataStatus({ ok: true, persistence: { d1: true } });
  expect(result.multiview_after_hours).toBe('verification_required');
  expect(result.multiview_after_hours_market).toBe('unknown');
  expect(result.multiview_market_latest_coverage).toBe('unknown/unknown');
});
it('old complete history is partial when latest session is missing', () => {
  expect(liveDataStatus({ ok: true, dailyCandleContinuity: { counts: {
    enabledSymbols: 53, complete: 23, unknown: 30, latestSessionCoverage: 4,
  } } }).multiview_after_hours_market).toBe('partial');
});
it('full market evidence cannot certify the other datasets', () => {
  const result = liveDataStatus({ ok: true, dailyCandleContinuity: { counts: {
    enabledSymbols: 1, complete: 1, unknown: 0, latestSessionCoverage: 1,
  } } });
  expect(result.multiview_after_hours_market).toBe('verified');
  expect(result.multiview_after_hours).toBe('verification_required');
});
it('unavailable health and malformed date remain unknown', () => {
  expect(liveDataStatus(null).multiview_after_hours).toBe('unknown');
  expect(liveDataStatus({ dailyCandleContinuity: { expectedCompletedSession: 'bad\nvalue' } }).multiview_market_expected_session).toBe('unknown');
});
