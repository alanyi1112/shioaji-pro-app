import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
    SUPPORT_RESISTANCE_STYLE_DEFAULTS,
    type SupportResistanceFormulaStyle,
} from '../lib/support-resistance-indicator-state';
import type { SupportResistanceFormulaId } from '../lib/support-resistance';
import * as styles from './candle-chart.css';

const OPTIONS: readonly { id: SupportResistanceFormulaId; label: string }[] = [
    { id: 'pivot-point', label: 'PivotPoint' },
    { id: 'three-level-price', label: '三關價' },
    { id: 'cdp', label: 'CDP' },
];

export function SupportResistanceMenu({
    enabled,
    readOnly,
    disabledReason,
    persistenceError,
    onToggle,
    onConfigure,
}: {
    enabled: ReadonlySet<SupportResistanceFormulaId>;
    readOnly: boolean;
    disabledReason?: string;
    persistenceError?: string;
    onToggle: (formulaId: SupportResistanceFormulaId, enabled: boolean) => void;
    onConfigure: (formulaId: SupportResistanceFormulaId) => void;
}) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            if (
                event.target instanceof Node &&
                !buttonRef.current?.contains(event.target) &&
                !popoverRef.current?.contains(event.target)
            ) {
                setOpen(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <Fragment>
            <button
                ref={buttonRef}
                className={
                    styles.supportResistanceBtn[
                        enabled.size > 0 ? 'active' : 'normal'
                    ]
                }
                type='button'
                aria-haspopup='dialog'
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                壓撐
            </button>
            {open && (
                <div
                    ref={popoverRef}
                    className={styles.supportResistancePopover}
                    role='dialog'
                    aria-label='壓撐設定'
                >
                    {OPTIONS.map((option) => (
                        <div key={option.id} className={styles.supportResistanceRow}>
                            <label className={styles.supportResistanceRowLabel}>
                                <input
                                    type='checkbox'
                                    checked={enabled.has(option.id)}
                                    disabled={readOnly || Boolean(disabledReason)}
                                    onChange={(event) =>
                                        onToggle(option.id, event.target.checked)
                                    }
                                />
                                {option.label}
                            </label>
                            <button
                                className={styles.supportResistanceSettingsBtn}
                                type='button'
                                aria-label={`設定 ${option.label} 線條`}
                                title={`設定 ${option.label} 線條`}
                                disabled={Boolean(disabledReason)}
                                onClick={() => {
                                    setOpen(false);
                                    onConfigure(option.id);
                                }}
                            >
                                <svg
                                    width='14'
                                    height='14'
                                    viewBox='0 0 24 24'
                                    fill='none'
                                    stroke='currentColor'
                                    strokeWidth='2'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                    aria-hidden='true'
                                >
                                    <path d='M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' />
                                    <path d='M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.01V3h4v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z' />
                                </svg>
                            </button>
                        </div>
                    ))}
                    <div className={styles.supportResistanceHelp}>
                        {disabledReason ??
                            (readOnly
                                ? '由 1D 管理；此時間級別僅顯示同一組投影。'
                                : '三套公式共用 1D 的同一根 reference K 棒。')}
                    </div>
                    {persistenceError && (
                        <div
                            className={styles.supportResistanceHelp}
                            role='status'
                            title={persistenceError}
                        >
                            設定尚未保存
                        </div>
                    )}
                </div>
            )}
        </Fragment>
    );
}

const FORMULA_LABELS: Record<SupportResistanceFormulaId, string> = {
    'pivot-point': 'PivotPoint',
    'three-level-price': '三關價',
    cdp: 'CDP',
};

export function SupportResistanceStyleDialog({
    formulaId,
    current,
    onCommit,
    onCancel,
}: {
    formulaId: SupportResistanceFormulaId;
    current: SupportResistanceFormulaStyle | null;
    onCommit: (style: SupportResistanceFormulaStyle | null) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState<SupportResistanceFormulaStyle>(() => ({
        ...(current ?? SUPPORT_RESISTANCE_STYLE_DEFAULTS[formulaId]),
    }));
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCancel();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onCancel]);

    const previewStyle = {
        '--support-preview-color': draft.color,
        '--support-preview-width': `${draft.width}px`,
        '--support-preview-style':
            draft.lineStyle === 'solid' ? 'solid' : draft.lineStyle,
    } as CSSProperties;

    return (
        <div
            className={styles.supportResistanceStyleOverlay}
            role='presentation'
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) onCancel();
            }}
        >
            <div
                className={styles.supportResistanceStyleDialog}
                role='dialog'
                aria-modal='true'
                aria-label={`${FORMULA_LABELS[formulaId]} 線條設定`}
            >
                <div className={styles.supportResistanceStyleHeader}>
                    {FORMULA_LABELS[formulaId]} 線條設定
                </div>
                <label className={styles.supportResistanceStyleField}>
                    <span>線條顏色</span>
                    <span className={styles.supportResistanceColorControl}>
                        <input
                            className={styles.supportResistanceColorInput}
                            aria-label='線條顏色'
                            type='color'
                            value={draft.color}
                            onInput={(event) => {
                                const color = event.currentTarget.value;
                                if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
                                setDraft((value) => ({
                                    ...value,
                                    color,
                                }));
                            }}
                        />
                        <span className={styles.supportResistanceColorValue}>
                            {draft.color.toUpperCase()}
                        </span>
                    </span>
                </label>
                <label className={styles.supportResistanceStyleField}>
                    <span>線條粗細</span>
                    <select
                        className={styles.supportResistanceStyleSelect}
                        aria-label='線條粗細'
                        value={draft.width}
                        onChange={(event) => {
                            const width = Number(event.currentTarget.value);
                            if (![1, 2, 3, 4].includes(width)) return;
                            setDraft((value) => ({
                                ...value,
                                width: width as 1 | 2 | 3 | 4,
                            }));
                        }}
                    >
                        {[1, 2, 3, 4].map((width) => (
                            <option key={width} value={width}>{width}px</option>
                        ))}
                    </select>
                </label>
                <label className={styles.supportResistanceStyleField}>
                    <span>線條形式</span>
                    <select
                        className={styles.supportResistanceStyleSelect}
                        aria-label='線條形式'
                        value={draft.lineStyle}
                        onChange={(event) => {
                            const lineStyle = event.currentTarget.value;
                            if (
                                lineStyle !== 'solid' &&
                                lineStyle !== 'dashed' &&
                                lineStyle !== 'dotted'
                            ) {
                                return;
                            }
                            setDraft((value) => ({
                                ...value,
                                lineStyle,
                            }));
                        }}
                    >
                        <option value='solid'>實線</option>
                        <option value='dashed'>虛線</option>
                        <option value='dotted'>點線</option>
                    </select>
                </label>
                <div
                    className={styles.supportResistanceStylePreview}
                    style={previewStyle}
                    aria-label='線條預覽'
                />
                <div className={styles.supportResistanceStyleActions}>
                    <button
                        type='button'
                        className={styles.supportResistanceStyleAction.secondary}
                        onClick={() => onCommit(null)}
                    >
                        恢復預設
                    </button>
                    <button
                        type='button'
                        className={styles.supportResistanceStyleAction.secondary}
                        onClick={onCancel}
                    >
                        取消
                    </button>
                    <button
                        type='button'
                        className={styles.supportResistanceStyleAction.primary}
                        onClick={() => onCommit(draft)}
                    >
                        套用
                    </button>
                </div>
            </div>
        </div>
    );
}
