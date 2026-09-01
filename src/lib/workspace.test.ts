import { describe, expect, it } from 'vitest';
import {
    BLOCK_META,
    LAYOUT_PRESETS,
    loadProfiles,
    loadWorkspace,
    saveProfiles,
    saveWorkspace,
    upsertProfile,
    type Profile,
    type Workspace,
} from './workspace';

describe('market pulse workspace preset', () => {
    it('opens TSE and OTC contribution panels side by side', () => {
        const preset = LAYOUT_PRESETS.find(
            (candidate) => candidate.name === '市場脈動',
        );

        expect(preset?.workspace.blocks).toEqual([
            expect.objectContaining({
                type: 'pulse',
                pulseIndex: 'IX0001',
                pulseSections: ['flow'],
                pulseWeights: {
                    stocks: 28,
                    industries: 32,
                    flow: 40,
                },
            }),
            expect.objectContaining({
                type: 'pulse',
                pulseIndex: 'IX0043',
                pulseSections: ['flow'],
            }),
        ]);
        expect(preset?.workspace.layout).toEqual([
            expect.objectContaining({ x: 0, w: 12 }),
            expect.objectContaining({ x: 12, w: 12 }),
        ]);
        expect(BLOCK_META.pulse.singleton).toBe(false);
        expect(BLOCK_META.signals.singleton).toBe(true);
    });
});

describe('signal radar workspace preset', () => {
    it('links signals to chart, depth, and time and sales panels', () => {
        const preset = LAYOUT_PRESETS.find(
            (candidate) => candidate.name === '盤中雷達',
        );

        expect(preset?.workspace.blocks).toEqual([
            expect.objectContaining({ type: 'signals', pin: null }),
            expect.objectContaining({ type: 'chart', pin: null }),
            expect.objectContaining({ type: 'depth', pin: null }),
            expect.objectContaining({ type: 'tape', pin: null }),
        ]);
        expect(preset?.workspace.layout).toEqual([
            expect.objectContaining({ x: 0, w: 6, h: 24 }),
            expect.objectContaining({ x: 6, w: 13, h: 24 }),
            expect.objectContaining({ x: 19, y: 0, w: 5 }),
            expect.objectContaining({ x: 19, y: 10, w: 5 }),
        ]);
    });
});

describe('smart-order panel workspace contract', () => {
    it('matches the ticket footprint and remains a singleton', () => {
        expect(BLOCK_META.smartorder).toMatchObject({
            label: '智慧下單',
            pinnable: false,
            singleton: true,
            defaultSize: { w: 5, h: 11, minW: 4, minH: 10 },
        });
    });

    it('round-trips a resized smart-order panel through workspace persistence', () => {
        const stored = new Map<string, string>();
        const previousLocalStorage = globalThis.localStorage;
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: (key: string) => stored.get(key) ?? null,
                setItem: (key: string, value: string) => stored.set(key, value),
            },
        });
        const resized: Workspace = {
            blocks: [{ id: 'smartorder-persisted', type: 'smartorder', pin: null }],
            layout: [
                {
                    i: 'smartorder-persisted',
                    x: 3,
                    y: 7,
                    w: 9,
                    h: 18,
                    minW: 4,
                    minH: 10,
                },
            ],
        };

        try {
            saveWorkspace(resized);
            expect(loadWorkspace()).toEqual(resized);
        } finally {
            if (previousLocalStorage === undefined) {
                Reflect.deleteProperty(globalThis, 'localStorage');
            } else {
                Object.defineProperty(globalThis, 'localStorage', {
                    configurable: true,
                    value: previousLocalStorage,
                });
            }
        }
    });
});

describe('workspace storage compatibility', () => {
    it('選股為可保存的 singleton，不強制插入既有版面', () => {
        expect(BLOCK_META.screener).toMatchObject({label:'選股',singleton:true,pinnable:false});
        expect(LAYOUT_PRESETS.every(preset=>preset.workspace.blocks.every(block=>block.type!=='screener'))).toBe(true);
    });
    it('round-trips current and named layouts through the existing storage keys', () => {
        const stored = new Map<string, string>();
        const previousLocalStorage = globalThis.localStorage;
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: (key: string) => stored.get(key) ?? null,
                setItem: (key: string, value: string) => stored.set(key, value),
            },
        });
        const workspace = structuredClone(LAYOUT_PRESETS[0]!.workspace);
        const profiles: Profile[] = [
            { name: '我的版面', workspace: structuredClone(workspace) },
        ];

        try {
            saveWorkspace(workspace);
            saveProfiles(profiles);

            expect(stored.has('sj-pro-workspace-v2')).toBe(true);
            expect(stored.has('sj-pro-profiles-v1')).toBe(true);
            expect(loadWorkspace()).toEqual(workspace);
            expect(loadProfiles()).toEqual(profiles);
        } finally {
            if (previousLocalStorage === undefined) {
                Reflect.deleteProperty(globalThis, 'localStorage');
            } else {
                Object.defineProperty(globalThis, 'localStorage', {
                    configurable: true,
                    value: previousLocalStorage,
                });
            }
        }
    });

    it('updates one exact-name profile with an isolated workspace snapshot', () => {
        const original = structuredClone(LAYOUT_PRESETS[0]!.workspace);
        const replacement = structuredClone(LAYOUT_PRESETS[1]!.workspace);
        const next = upsertProfile(
            [
                { name: '既有版面', workspace: original },
                { name: '其他版面', workspace: original },
            ],
            '  既有版面  ',
            replacement,
        );

        expect(next.filter((profile) => profile.name === '既有版面')).toHaveLength(
            1,
        );
        expect(next.map((profile) => profile.name)).toEqual([
            '其他版面',
            '既有版面',
        ]);
        expect(next.at(-1)?.workspace).toEqual(replacement);
        expect(next.at(-1)?.workspace).not.toBe(replacement);
    });
});
