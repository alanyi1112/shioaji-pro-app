import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as styles from './candle-chart.css';
import {
    SupportResistanceMenu,
    SupportResistanceStyleDialog,
} from './support-resistance-menu';
import type { SupportResistanceFormulaId } from '../lib/support-resistance';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

describe('support/resistance menu browser interaction', () => {
    let root: Root | null = null;
    afterEach(async () => {
        if (root) await act(async () => root?.unmount());
        root = null;
        document.body.replaceChildren();
    });

    it('opens inside a narrow viewport, exposes three checkboxes, focuses controls and closes by Escape/outside click', async () => {
        const host = document.createElement('div');
        host.className = styles.toolbar;
        host.style.width = '320px';
        document.body.append(host);
        root = createRoot(host);
        const onToggle = vi.fn();
        const onConfigure = vi.fn();
        await act(async () => {
            root?.render(
                createElement(SupportResistanceMenu, {
                    enabled: new Set<SupportResistanceFormulaId>(['pivot-point']),
                    readOnly: false,
                    persistenceError: 'storage-unavailable',
                    onToggle,
                    onConfigure,
                }),
            );
        });
        const button = host.querySelector('button')!;
        await act(async () => button.click());
        const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
        const checks = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
        expect(checks).toHaveLength(3);
        expect(dialog.textContent).toContain('PivotPoint');
        expect(dialog.textContent).toContain('三關價');
        expect(dialog.textContent).toContain('CDP');
        expect(dialog.textContent).toContain('設定尚未保存');
        const settings = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="設定 "]')];
        expect(settings).toHaveLength(3);
        checks[1]!.focus();
        expect(document.activeElement).toBe(checks[1]);
        await act(async () => checks[1]!.click());
        expect(onToggle).toHaveBeenCalledWith('three-level-price', true);
        await act(async () => settings[2]!.click());
        expect(onConfigure).toHaveBeenCalledWith('cdp');
        expect(host.querySelector('[role="dialog"]')).toBeNull();
        await act(async () => button.click());
        const rect = dialog.getBoundingClientRect();
        expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
        expect(rect.left).toBeGreaterThanOrEqual(0);

        await act(async () =>
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        );
        expect(host.querySelector('[role="dialog"]')).toBeNull();
        await act(async () => button.click());
        await act(async () =>
            document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
        );
        expect(host.querySelector('[role="dialog"]')).toBeNull();
    });

    it('makes minute-timeframe controls read-only and explains 1D ownership', async () => {
        const host = document.createElement('div');
        host.className = styles.toolbar;
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root?.render(
                createElement(SupportResistanceMenu, {
                    enabled: new Set<SupportResistanceFormulaId>(['cdp']),
                    readOnly: true,
                    onToggle: vi.fn(),
                    onConfigure: vi.fn(),
                }),
            );
        });
        await act(async () => host.querySelector('button')!.click());
        expect(host.textContent).toContain('由 1D 管理');
        expect(
            [...host.querySelectorAll<HTMLInputElement>('input')].every(
                (input) => input.disabled,
            ),
        ).toBe(true);
        expect(
            [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="設定 "]')].every(
                (button) => !button.disabled,
            ),
        ).toBe(true);
    });

    it('matches the 指標 button visual states and applies, cancels or resets formula styles', async () => {
        const createToolbarPair = (state: 'normal' | 'active') => {
            const comparison = document.createElement('div');
            comparison.className = styles.toolbar;
            const indicator = document.createElement('button');
            const support = document.createElement('button');
            indicator.textContent = '指標';
            support.textContent = '壓撐';
            indicator.className = styles.indicatorBtn[state];
            support.className = styles.supportResistanceBtn[state];
            comparison.append(indicator, support);
            document.body.append(comparison);
            return [indicator, support] as const;
        };
        const [indicatorNormal, supportNormal] = createToolbarPair('normal');
        const [indicatorActive, supportActive] = createToolbarPair('active');
        const visualPairs: [HTMLButtonElement, HTMLButtonElement][] = [
            [indicatorNormal, supportNormal],
            [indicatorActive, supportActive],
        ];
        for (const [indicator, support] of visualPairs) {
            const expected = getComputedStyle(indicator);
            const actual = getComputedStyle(support);
            expect(actual.color).toBe(expected.color);
            expect(actual.backgroundColor).toBe(expected.backgroundColor);
            expect(actual.borderRadius).toBe(expected.borderRadius);
            expect(actual.font).toBe(expected.font);
            expect(actual.lineHeight).toBe(expected.lineHeight);
            expect(actual.paddingTop).toBe(expected.paddingTop);
            expect(actual.paddingRight).toBe(expected.paddingRight);
            expect(actual.paddingBottom).toBe(expected.paddingBottom);
            expect(actual.paddingLeft).toBe(expected.paddingLeft);
            expect(support.parentElement?.classList.contains(styles.toolbar)).toBe(true);
            expect(support.getBoundingClientRect().width).toBe(
                indicator.getBoundingClientRect().width,
            );
            expect(support.getBoundingClientRect().height).toBe(
                indicator.getBoundingClientRect().height,
            );
            expect(actual.borderColor).not.toBe('rgba(0, 0, 0, 0)');
            expect(actual.borderColor).not.toBe('transparent');
        }

        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const onCommit = vi.fn();
        const onCancel = vi.fn();
        await act(async () => {
            root?.render(createElement(
                StrictMode,
                null,
                createElement(SupportResistanceStyleDialog, {
                    formulaId: 'pivot-point',
                    current: null,
                    onCommit,
                    onCancel,
                }),
            ));
        });
        const color = host.querySelector<HTMLInputElement>('input[type="color"]')!;
        const width = host.querySelector<HTMLSelectElement>('select[aria-label="線條粗細"]')!;
        const lineStyle = host.querySelector<HTMLSelectElement>('select[aria-label="線條形式"]')!;
        await act(async () => {
            color.value = '#123456';
            color.dispatchEvent(new Event('input', { bubbles: true }));
            width.value = '3';
            width.dispatchEvent(new Event('change', { bubbles: true }));
            lineStyle.value = 'dotted';
            lineStyle.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === '套用')!.click());
        expect(onCommit).toHaveBeenCalledWith({ color: '#123456', width: 3, lineStyle: 'dotted' });
        await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === '恢復預設')!.click());
        expect(onCommit).toHaveBeenLastCalledWith(null);
        await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === '取消')!.click());
        expect(onCancel).toHaveBeenCalledTimes(1);
        await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
        expect(onCancel).toHaveBeenCalledTimes(2);
        await act(async () => host.querySelector<HTMLElement>('[role="presentation"]')!.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true }),
        ));
        expect(onCancel).toHaveBeenCalledTimes(3);
    });

    it.each<SupportResistanceFormulaId>([
        'pivot-point',
        'three-level-price',
        'cdp',
    ])('keeps the %s style editor stable in StrictMode while every control changes', async (formulaId) => {
        const host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        const onCommit = vi.fn();
        const onCancel = vi.fn();
        await act(async () => {
            root?.render(createElement(
                StrictMode,
                null,
                createElement(SupportResistanceStyleDialog, {
                    formulaId,
                    current: null,
                    onCommit,
                    onCancel,
                }),
            ));
        });

        const color = host.querySelector<HTMLInputElement>('input[aria-label="線條顏色"]')!;
        const width = host.querySelector<HTMLSelectElement>('select[aria-label="線條粗細"]')!;
        const lineStyle = host.querySelector<HTMLSelectElement>('select[aria-label="線條形式"]')!;
        const preview = host.querySelector<HTMLElement>('[aria-label="線條預覽"]')!;
        await act(async () => {
            color.value = '#123456';
            color.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => {
            width.value = '4';
            width.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => {
            lineStyle.value = 'dashed';
            lineStyle.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(host.textContent).toContain('#123456');
        expect(preview.style.getPropertyValue('--support-preview-color')).toBe('#123456');
        expect(preview.style.getPropertyValue('--support-preview-width')).toBe('4px');
        expect(preview.style.getPropertyValue('--support-preview-style')).toBe('dashed');
        await act(async () => [...host.querySelectorAll('button')].find(
            (button) => button.textContent === '套用',
        )!.click());
        expect(onCommit).toHaveBeenCalledWith({
            color: '#123456',
            width: 4,
            lineStyle: 'dashed',
        });
        expect(onCancel).not.toHaveBeenCalled();
    });
});
