import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_PRESETS } from '../lib/workspace';
import { AddBlockMenu } from './hud-header';
import { ProfilesMenu } from './workspace-layout-menu';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByText(host: HTMLElement, text: string) {
    return [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === text,
    );
}

describe('header layout menu browser interaction', () => {
    let root: Root | null = null;

    afterEach(async () => {
        if (root) await act(async () => root?.unmount());
        root = null;
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    async function renderMenu(
        profiles: string[],
        onSaveProfile = vi.fn(),
        overrides: Partial<{
            onLoadProfile: (name: string) => void;
            onDeleteProfile: (name: string) => void;
            onResetWorkspace: () => void;
            onLoadPreset: (name: string) => void;
        }> = {},
    ) {
        const host = document.createElement('div');
        host.style.position = 'absolute';
        host.style.inset = '0 0 auto auto';
        document.body.append(host);
        root = createRoot(host);
        const callbacks = {
            onLoadProfile: vi.fn(),
            onDeleteProfile: vi.fn(),
            onResetWorkspace: vi.fn(),
            onLoadPreset: vi.fn(),
            ...overrides,
        };
        await act(async () => {
            root?.render(
                createElement(ProfilesMenu, {
                    profiles,
                    onSaveProfile,
                    ...callbacks,
                }),
            );
        });
        await act(async () => buttonByText(host, '版面')?.click());
        return { host, onSaveProfile, ...callbacks };
    }

    it('keeps save and saved-layout controls before the full preset list', async () => {
        const { host } = await renderMenu(['我的版面']);
        const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
        const text = dialog.textContent ?? '';

        expect(text.indexOf('MultiView（開新分頁）')).toBeLessThan(
            text.indexOf('儲存目前版面'),
        );
        expect(text.indexOf('儲存目前版面')).toBeLessThan(
            text.indexOf('版面列表'),
        );
        expect(text.indexOf('版面列表')).toBeLessThan(
            text.indexOf('預設版面'),
        );
        expect(text.indexOf('預設版面')).toBeLessThan(
            text.indexOf('盤中選股'),
        );
        expect(text.indexOf('盤中選股')).toBeLessThan(
            text.indexOf('選股篩選'),
        );
        expect(text).toContain('最多 200 檔盤中監控＋連動 K 線（開新分頁）');
        expect(text).toContain('全市場收盤後條件篩選（開新分頁）');
        expect(text.indexOf('預設版面')).toBeLessThan(
            text.indexOf('重設為預設版面'),
        );
        for (const preset of LAYOUT_PRESETS) {
            expect(text).toContain(preset.name);
        }
    });

    it('opens the intraday stock-selection workspace in a new tab', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
        const onLoadPreset = vi.fn();
        const { host } = await renderMenu([], vi.fn(), { onLoadPreset });
        await act(async () =>
            host
                .querySelector<HTMLButtonElement>(
                    'button[title="在新分頁開啟盤中監控與連動 K 線，不變更目前版面"]',
                )
                ?.click(),
        );
        expect(open).toHaveBeenCalledWith(
            expect.stringContaining('layout=intraday-stock-selection'),
            '_blank',
            'noopener',
        );
        expect(onLoadPreset).not.toHaveBeenCalled();
        expect(host.querySelector('[role="dialog"]')).toBeNull();
    });

    it('does not mistake a noopener null return for a blocked intraday popup or change the current layout', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
        const onLoadPreset = vi.fn();
        const onResetWorkspace = vi.fn();
        const { host } = await renderMenu([], vi.fn(), { onLoadPreset, onResetWorkspace });
        await act(async () =>
            host
                .querySelector<HTMLButtonElement>(
                    'button[title="在新分頁開啟盤中監控與連動 K 線，不變更目前版面"]',
                )
                ?.click(),
        );
        expect(open).toHaveBeenCalledWith(
            expect.stringContaining('layout=intraday-stock-selection'),
            '_blank',
            'noopener',
        );
        expect(alert).not.toHaveBeenCalled();
        expect(onLoadPreset).not.toHaveBeenCalled();
        expect(onResetWorkspace).not.toHaveBeenCalled();
        expect(host.querySelector('[role="dialog"]')).toBeNull();
    });

    it('opens the layout-menu screener as a full trading workspace tab without applying a preset in place', async () => {
        const open = vi
            .spyOn(window, 'open')
            .mockReturnValue(null);
        const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
        const onLoadPreset = vi.fn();
        const onResetWorkspace = vi.fn();
        const { host } = await renderMenu([], vi.fn(), {
            onLoadPreset,
            onResetWorkspace,
        });
        await act(async () =>
            host
                .querySelector<HTMLButtonElement>(
                    'button[title="在新分頁開啟選股篩選，不變更目前版面"]',
                )
                ?.click(),
        );
        expect(open).toHaveBeenCalledWith(
            expect.stringContaining('layout=stock-screener'),
            '_blank',
            'noopener',
        );
        expect(alert).not.toHaveBeenCalled();
        expect(onLoadPreset).not.toHaveBeenCalled();
        expect(onResetWorkspace).not.toHaveBeenCalled();
        expect(host.querySelector('[role="dialog"]')).toBeNull();
    });

    it('keeps add-panel screener as the normal singleton workspace block action', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const onAddBlock = vi.fn();
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => root?.render(createElement(AddBlockMenu, {
            addableTypes: [
                { type: 'screener', label: '選股', disabled: false },
                { type: 'chart', label: 'K 線圖', disabled: false },
            ],
            onAddBlock,
        })));
        await act(async () => buttonByText(host, '＋ 新增面板')?.click());
        await act(async () => buttonByText(host, '選股')?.click());
        expect(onAddBlock).toHaveBeenCalledWith('screener');
        expect(open).not.toHaveBeenCalled();
        expect(host.querySelector('[role="dialog"]')).toBeNull();
    });

    it('bounds long content to the viewport and keeps the last action keyboard-reachable', async () => {
        const profiles = Array.from(
            { length: 24 },
            (_, index) => `具名版面 ${index + 1}`,
        );
        const { host } = await renderMenu(profiles);
        const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        const computed = getComputedStyle(dialog);
        expect(computed.overflowY).toBe('auto');
        expect(computed.overscrollBehaviorY).toBe('contain');
        expect(computed.scrollbarGutter).toContain('stable');
        expect(computed.maxHeight).not.toBe('none');
        expect(dialog.scrollHeight).toBeGreaterThan(dialog.clientHeight);
        expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(
            window.innerHeight,
        );

        const reset = buttonByText(host, '↺ 重設為預設版面')!;
        reset.focus();
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
        );
        expect(document.activeElement).toBe(reset);
        expect(dialog.scrollTop).toBeGreaterThan(0);
    });

    it('shares one submit path for blank, new and existing names by click or Enter', async () => {
        const onSaveProfile = vi.fn();
        const { host } = await renderMenu(['既有版面'], onSaveProfile);
        const input = host.querySelector<HTMLInputElement>(
            'input[placeholder="版面名稱"]',
        )!;
        const submit = () =>
            [...host.querySelectorAll<HTMLButtonElement>('button')].find(
                (button) =>
                    button.textContent === '另存' ||
                    button.textContent === '更新',
            )!;

        expect(submit().disabled).toBe(true);
        await act(async () => {
            setInputValue(input, '  新版面  ');
        });
        expect(submit().textContent).toBe('另存');
        expect(host.textContent).toContain('將另存為新具名版面「新版面」');
        await act(async () => submit().click());
        expect(onSaveProfile).toHaveBeenLastCalledWith('新版面');
        expect(input.value).toBe('');

        await act(async () => {
            setInputValue(input, '既有版面');
        });
        expect(submit().textContent).toBe('更新');
        expect(host.textContent).toContain('將更新並覆寫同名版面「既有版面」');
        await act(async () => {
            input.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    bubbles: true,
                }),
            );
        });
        expect(onSaveProfile).toHaveBeenLastCalledWith('既有版面');
        expect(onSaveProfile).toHaveBeenCalledTimes(2);
        expect(input.value).toBe('');
    });

    it('routes load, delete, preset and reset without creating a named layout', async () => {
        const onSaveProfile = vi.fn();
        const onLoadProfile = vi.fn();
        const onDeleteProfile = vi.fn();
        const onLoadPreset = vi.fn();
        const onResetWorkspace = vi.fn();
        const { host } = await renderMenu(['我的版面'], onSaveProfile, {
            onLoadProfile,
            onDeleteProfile,
            onLoadPreset,
            onResetWorkspace,
        });

        await act(async () =>
            host
                .querySelector<HTMLButtonElement>('button[title="刪除此版面"]')
                ?.click(),
        );
        expect(onDeleteProfile).toHaveBeenCalledWith('我的版面');
        expect(host.querySelector('[role="dialog"]')).not.toBeNull();

        await act(async () => buttonByText(host, '我的版面')?.click());
        expect(onLoadProfile).toHaveBeenCalledWith('我的版面');
        expect(host.querySelector('[role="dialog"]')).toBeNull();

        await act(async () => buttonByText(host, '版面')?.click());
        await act(async () =>
            host
                .querySelector<HTMLButtonElement>(
                    `button[title="${LAYOUT_PRESETS[0]!.desc}"]`,
                )
                ?.click(),
        );
        expect(onLoadPreset).toHaveBeenCalledWith(LAYOUT_PRESETS[0]!.name);
        expect(host.querySelector('[role="dialog"]')).toBeNull();

        await act(async () => buttonByText(host, '版面')?.click());
        await act(async () =>
            buttonByText(host, '↺ 重設為預設版面')?.click(),
        );
        expect(onResetWorkspace).toHaveBeenCalledTimes(1);
        expect(onSaveProfile).not.toHaveBeenCalled();
    });
});
