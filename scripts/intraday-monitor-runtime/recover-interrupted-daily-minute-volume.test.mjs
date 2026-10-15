import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyInterruptedCollection } from './recover-interrupted-daily-minute-volume.mjs';
import { conservativeInterruptedUsage } from './interruption-conservative-admission.mjs';
const valid = () => ({ sourceTradeDate: '2026-10-14', bootAt: '2026-10-14T07:28:09Z',
    ownerAlive: false, now: new Date('2026-10-14T09:00:00Z'), cooldownMs: 900000,
    claim: { schemaVersion: 'intraday-minute-volume-collection/2', sourceDate: '2026-10-14',
        targetDate: '2026-10-15', attempt: 2, ownerPid: 46363, claimedAt: '2026-10-14T06:52:15Z',
        simulation: true, brokerWriteAuthority: false, notificationAuthority: false,
        requestedSymbols: Array.from({ length: 160 }, (_, i) => `${1000 + i}.TW`),
        calendarVersion: 'official', connectionGeneration: 'simulation:old' },
    prior: { schemaVersion: 'intraday-minute-volume-collection/2', sourceDate: '2026-10-14',
        targetDate: '2026-10-15', attempt: 1, outcome: 'partial', conflictCount: 0,
        calendarVersion: 'official', connectionGeneration: 'simulation:old', completedAt: '2026-10-14T06:37:15Z' } });
test('verified dead owner after host reboot is eligible without rewriting original receipt', () => {
    const input = valid(), original = JSON.stringify(input.claim);
    verifyInterruptedCollection(input); assert.equal(JSON.stringify(input.claim), original);
});
for (const [name, mutate] of [
    ['live owner', v => { v.ownerAlive = true; }],
    ['boot before claim', v => { v.bootAt = '2026-10-14T06:00:00Z'; }],
    ['future boot', v => { v.bootAt = '2026-10-15T00:00:00Z'; }],
    ['active cooldown', v => { v.now = new Date('2026-10-14T06:40:00Z'); }],
    ['wrong target', v => { v.claim.targetDate = '2026-10-16'; }],
    ['different calendar', v => { v.claim.calendarVersion = 'unverified'; }],
    ['duplicate cohort', v => { v.claim.requestedSymbols[1] = v.claim.requestedSymbols[0]; }],
    ['invalid claim time', v => { v.claim.claimedAt = 'invalid'; }],
    ['write authority', v => { v.claim.brokerWriteAuthority = true; }],
]) test(`rejects ${name}`, () => { const input = valid(); mutate(input);
    assert.throws(() => verifyInterruptedCollection(input), /parent_unverified/); });
test('same epoch carry adds old high-water usage instead of claiming a reset', () => {
    const raw = { usedBytes: 20, remainingBytes: 480, limitBytes: 500 };
    assert.deepEqual(conservativeInterruptedUsage(raw, 100), { usedBytes: 120, remainingBytes: 380, limitBytes: 500 });
    assert.equal(raw.usedBytes, 20);
});
test('conservative carry refuses exhaustion or invalid provider arithmetic', () => {
    assert.throws(() => conservativeInterruptedUsage({ usedBytes: 20, remainingBytes: 480, limitBytes: 500 }, 490));
    assert.throws(() => conservativeInterruptedUsage({ usedBytes: 20, remainingBytes: 490, limitBytes: 500 }, 0));
});
