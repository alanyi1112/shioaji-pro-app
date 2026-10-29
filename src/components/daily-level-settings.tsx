import { useEffect } from 'react';
import { DAILY_LEVEL_OUTPUTS, dailyLevelParams } from '../lib/daily-indicator-levels';
import type { IndicatorInstance, OutputStyle } from '../lib/indicator-defs';
import * as styles from './indicator-dialog.css';

export interface DailyLevelSettingsProps {
    inst: IndicatorInstance;
    onPatch: (patch: Partial<IndicatorInstance>) => void;
    onCommit: () => void;
    onCancel: () => void;
    onRemove: () => void;
    errorMessage?: string;
}
export function DailyLevelSettings(props: DailyLevelSettingsProps) {
    const { inst, onPatch, onCommit, onCancel, onRemove } = props;
    useEffect(() => {
        const listener = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
        window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
    }, [onCancel]);
    let valid = true; try { dailyLevelParams(inst); } catch { valid = false; }
    const patchStyle = (key: string, value: OutputStyle) => onPatch({ styles: { ...inst.styles, [key]: { ...inst.styles?.[key], ...value } } });
    return <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
        <div className={styles.settingsDialog} role='dialog' aria-label='日線關鍵價位設定'>
            <div className={styles.header}>日線關鍵價位</div>
            <div className={styles.settingsBody}>
                <p>跟隨1D最新值，包含今日未收盤日K。水平線只顯示於1m／5m／15m／60m。</p>
                <label className={styles.fieldRow}>日線布林期數<input aria-label='日線布林期數' type='number' min={2} max={200} step={1} value={inst.params.period ?? 20} onChange={e => onPatch({ params: { ...inst.params, period: Number(e.currentTarget.value) } })} /></label>
                <label className={styles.fieldRow}>標準差倍數<input aria-label='日線布林標準差倍數' type='number' min={0.5} max={5} step={0.5} value={inst.params.mult ?? 2} onChange={e => onPatch({ params: { ...inst.params, mult: Number(e.currentTarget.value) } })} /></label>
                <p>只顯示目前價格視窗內的日線價位，保持原K線大小與縱軸範圍；視窗外價位可在數值清單查看。</p>
                {DAILY_LEVEL_OUTPUTS.map(o => {
                    const s = inst.styles?.[o.key];
                    return <fieldset key={o.key} className={styles.styleSection}>
                        <legend><label><input type='checkbox' aria-label={`顯示${o.label}`} checked={s?.visible !== false} onChange={e => patchStyle(o.key, { visible: e.currentTarget.checked })} />{o.label}</label></legend>
                        <div className={styles.fieldRow}>
                            <input type='color' aria-label={`${o.label}顏色`} value={s?.color ?? o.color} onChange={e => patchStyle(o.key, { color: e.currentTarget.value })} />
                            <select aria-label={`${o.label}粗細`} value={s?.width ?? 1} onChange={e => patchStyle(o.key, { width: Number(e.currentTarget.value) as 1 | 2 | 3 | 4 })}>{[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}</select>
                            <select aria-label={`${o.label}線型`} value={s?.lineStyle ?? 'dashed'} onChange={e => patchStyle(o.key, { lineStyle: e.currentTarget.value as 'solid' | 'dashed' | 'dotted' })}><option value='solid'>實線</option><option value='dashed'>虛線</option><option value='dotted'>點線</option></select>
                        </div>
                    </fieldset>;
                })}
                {!valid && <p role='alert'>請輸入合法布林參數：2–200期，0.5–5倍（每次0.5）。</p>}
                {props.errorMessage && <p role='alert'>{props.errorMessage}</p>}
            </div>
            <div className={styles.settingsFooter}><button className={styles.dangerBtn} onClick={onRemove}>移除</button><div className={styles.footerActions}><button className={styles.cancelBtn} onClick={onCancel}>取消</button><button className={styles.okBtn} disabled={!valid} onClick={onCommit}>確定</button></div></div>
        </div>
    </div>;
}
