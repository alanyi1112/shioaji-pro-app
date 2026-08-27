import { describe, expect, it, vi } from 'vitest';
import {
    classifySmartOrderLocalNotification,
    createMacOsSmartOrderNotificationSender,
    startSmartOrderLocalNotificationPump,
} from './local-notification.mjs';

function projection({
    cursorStatus = 'current',
    afterSequence = 0,
    nextSequence = afterSequence,
    highWaterSequence = nextSequence,
    events = [],
} = {}) {
    return {
        cursorStatus,
        fromSequence: afterSequence,
        nextSequence,
        highWaterSequence,
        events,
    };
}

describe('smart-order local notification adapter', () => {
    it('maps only fixed lifecycle reason codes and never includes identifiers', () => {
        expect(
            classifySmartOrderLocalNotification({
                reasonCode: 'CONDITION_EDGE_FALSE_TO_TRUE',
            }),
        ).toMatchObject({ category: 'triggered' });
        expect(
            classifySmartOrderLocalNotification({
                reasonCode: 'BROKER_ACK_DURABLE',
            }),
        ).toMatchObject({ category: 'broker_accepted' });
        expect(
            classifySmartOrderLocalNotification({
                reasonCode: 'BROKER_PART_FILL_CONFIRMED',
            }),
        ).toMatchObject({ category: 'part_filled' });
        expect(
            classifySmartOrderLocalNotification({
                reasonCode: 'BROKER_FULL_FILL_CONFIRMED',
            }),
        ).toMatchObject({ category: 'filled' });
        expect(
            classifySmartOrderLocalNotification({
                reasonCode: 'BROKER_OUTCOME_UNKNOWN',
            }),
        ).toMatchObject({ category: 'manual_intervention' });
        expect(
            classifySmartOrderLocalNotification({
                reasonCode:
                    'PROTECTION_RESERVATION_SHRUNK_EXTERNAL_POSITION_DRIFT',
            }),
        ).toMatchObject({
            category: 'protection_drift',
            title: '智慧下單保護數量已縮減',
        });
        expect(
            classifySmartOrderLocalNotification({
                reasonCode: 'STRATEGY_DRAFT_UPDATED',
            }),
        ).toBeNull();
        expect(
            JSON.stringify(
                classifySmartOrderLocalNotification({
                    reasonCode: 'BROKER_OUTCOME_UNKNOWN',
                    accountId: 'must-not-leak',
                }),
            ),
        ).not.toContain('must-not-leak');
    });

    it('passes fixed AppleScript and fixed messages as separate argv values', async () => {
        const calls = [];
        const sender = createMacOsSmartOrderNotificationSender({
            platform: 'darwin',
            execFileImpl(file, args, options, callback) {
                calls.push({ file, args, options });
                callback(null);
            },
        });
        const notification = classifySmartOrderLocalNotification({
            reasonCode: 'BROKER_PART_FILL_CONFIRMED',
        });
        await expect(sender(notification)).resolves.toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            file: '/usr/bin/osascript',
            args: [
                '-e',
                expect.stringContaining('display notification'),
                '--',
                notification.title,
                notification.body,
            ],
            options: { timeout: 5_000, windowsHide: true },
        });
    });

    it('starts at durable high-water and emits each new mapped event once', async () => {
        const replies = [
            projection({
                cursorStatus: 'initialized',
                nextSequence: 4,
                highWaterSequence: 4,
            }),
            projection({
                afterSequence: 4,
                nextSequence: 6,
                highWaterSequence: 6,
                events: [
                    { sequence: 5, reasonCode: 'STRATEGY_DRAFT_UPDATED' },
                    {
                        sequence: 6,
                        reasonCode: 'BROKER_PART_FILL_CONFIRMED',
                    },
                ],
            }),
            projection({
                afterSequence: 6,
                nextSequence: 6,
                highWaterSequence: 6,
            }),
        ];
        const readEvents = vi.fn(async () => replies.shift());
        const sendNotification = vi.fn(async () => true);
        const pump = await startSmartOrderLocalNotificationPump({
            readEvents,
            sendNotification,
            setIntervalImpl: () => ({ unref() {} }),
            clearIntervalImpl: vi.fn(),
        });
        expect(sendNotification).not.toHaveBeenCalled();
        await pump.pollNow();
        await pump.pollNow();
        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(sendNotification).toHaveBeenCalledWith(
            expect.objectContaining({ category: 'part_filled' }),
        );
        expect(pump.cursor).toBe(6);
        expect(readEvents.mock.calls).toEqual([
            [{ afterSequence: null, limit: 100 }],
            [{ afterSequence: 4, limit: 100 }],
            [{ afterSequence: 6, limit: 100 }],
        ]);
        await pump.close();
    });

    it('turns a cursor gap or read failure into one best-effort warning', async () => {
        const replies = [
            projection({
                cursorStatus: 'initialized',
                nextSequence: 2,
                highWaterSequence: 2,
            }),
            projection({
                cursorStatus: 'gap',
                afterSequence: 2,
                nextSequence: 8,
                highWaterSequence: 8,
            }),
            new Error('repository unavailable'),
            new Error('repository still unavailable'),
            projection({
                afterSequence: 8,
                nextSequence: 8,
                highWaterSequence: 8,
            }),
            new Error('repository unavailable again'),
        ];
        const readEvents = vi.fn(async () => {
            const next = replies.shift();
            if (next instanceof Error) throw next;
            return next;
        });
        const sendNotification = vi.fn(async () => true);
        const pump = await startSmartOrderLocalNotificationPump({
            readEvents,
            sendNotification,
            setIntervalImpl: () => ({ unref() {} }),
            clearIntervalImpl: vi.fn(),
        });
        await pump.pollNow();
        await pump.pollNow();
        await pump.pollNow();
        await pump.pollNow();
        await pump.pollNow();
        expect(
            sendNotification.mock.calls.map(([notice]) => notice.category),
        ).toEqual([
            'manual_intervention',
            'runtime_offline',
            'runtime_offline',
        ]);
        expect(pump.cursor).toBe(8);
        await pump.close();
    });

    it('never lets notification delivery failure change cursor progression', async () => {
        const replies = [
            projection({ cursorStatus: 'initialized' }),
            projection({
                nextSequence: 1,
                highWaterSequence: 1,
                events: [
                    { sequence: 1, reasonCode: 'BROKER_FAILED_CONFIRMED' },
                ],
            }),
        ];
        const pump = await startSmartOrderLocalNotificationPump({
            readEvents: async () => replies.shift(),
            sendNotification: async () => {
                throw new Error('notification permission denied');
            },
            setIntervalImpl: () => ({ unref() {} }),
            clearIntervalImpl: vi.fn(),
        });
        await expect(pump.pollNow()).resolves.toBeUndefined();
        expect(pump.cursor).toBe(1);
        expect(pump.authoritativeForBrokerState).toBe(false);
        await pump.close();
    });
});
