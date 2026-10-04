import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const root = style({
    overflow: 'auto', minHeight: 0, minWidth: 0, flex: 1,
    padding: 10, fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 10,
});
export const controls = style({ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' });
export const draftToolbar = style({ display: 'flex', flexDirection: 'column', gap: 6 });
export const selectedConditions = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });
export const settingsDetails = style({ marginTop: 8, border: `1px solid ${vars.color.border}`, borderRadius: 4, padding: 8 });
export const submitRow = style({ display: 'flex', justifyContent: 'flex-end', marginTop: 8 });
export const resultToolbar = style({ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '6px 0' });
export const evidenceDetails = style({ marginTop: 6, borderTop: `1px solid ${vars.color.border}`, paddingTop: 6 });
export const methodDetails = style({ border: `1px solid ${vars.color.border}`, borderRadius: 4, padding: 8 });
export const criticalStatus = style({ color: vars.color.danger });
export const conditionGroups = style({ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 });
export const conditionGroup = style({ border: `1px solid ${vars.color.border}`, borderRadius: 4, overflow: 'hidden' });
export const groupToggle = style({
    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
    textAlign: 'left', border: 0, borderRadius: 0, padding: '6px 8px', boxSizing: 'border-box',
    font: 'inherit', color: vars.color.foreground, background: vars.color.muted, cursor: 'pointer',
});
export const conditionList = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
export const conditionItem = style({ minWidth: 0, borderTop: `1px solid ${vars.color.border}` });
export const conditionSummary = style({ display: 'flex', alignItems: 'stretch', minWidth: 0 });
export const conditionEnable = style({ flex: '0 0 auto', padding: '4px 6px' });
export const conditionState = style({ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 });
export const conditionToggle = style({
    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    textAlign: 'left', border: 0, borderRadius: 0, padding: '5px 6px', boxSizing: 'border-box',
    font: 'inherit', color: vars.color.foreground, background: 'transparent', cursor: 'pointer',
});
export const conditionTitle = style({ minWidth: 0, overflowWrap: 'anywhere' });
export const conditionValue = style({ color: vars.color.mutedForeground, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '0 1 auto' });
export const conditionCard = style({ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '0 0 8px',
    minWidth: 0, border: `1px solid ${vars.color.border}`, borderRadius: 4, padding: 8 });
export const note = style({ color: vars.color.mutedForeground, lineHeight: 1.5, margin: 0, overflowWrap: 'anywhere' });
export const status = style({ border: `1px solid ${vars.color.border}`, borderRadius: 4, padding: 8, lineHeight: 1.6, flexShrink: 0 });
export const results = style({ display: 'flex', flexDirection: 'column', gap: 4 });
export const row = style({
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4,
    whiteSpace: 'normal', overflowWrap: 'anywhere', width: '100%',
    border: `1px solid ${vars.color.border}`, borderRadius: 4, background: 'transparent',
    color: vars.color.foreground,
    ':hover': { background: vars.color.muted },
});
export const rowTop = style({
    display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0,
});
export const rowAction = style({
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, textAlign: 'left',
    whiteSpace: 'normal', overflowWrap: 'anywhere', flex: 1, minWidth: 0, padding: 8,
    border: 0, borderRadius: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit',
});
export const addButton = style({
    flex: '0 0 auto',
    margin: 8,
    transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
});
export const addStatus = style({ color: vars.color.mutedForeground, margin: '0 8px 6px', overflowWrap: 'anywhere' });
export const addError = style({ color: vars.color.danger, margin: '0 8px 6px', overflowWrap: 'anywhere' });
globalStyle(`${row} details`, { margin: '0 8px 8px' });
globalStyle(`${row} details span`, { display: 'block', overflowWrap: 'anywhere' });
globalStyle(`${row} details pre`, { margin: '6px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' });
globalStyle(`${results} > details pre, ${results} [role="status"] details pre`, {
    margin: '6px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', maxWidth: '100%',
});
globalStyle(`${root} input[type="number"]`, { width: '5.5rem', maxWidth: '100%' });
globalStyle(`${root} label`, { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
    minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' });
globalStyle(`${root} input, ${root} select, ${root} button:not(.${rowAction})`, {
    font: 'inherit', color: vars.color.foreground, background: vars.color.muted,
    border: `1px solid ${vars.color.border}`, borderRadius: 4, padding: '5px 7px', maxWidth: '100%', boxSizing: 'border-box',
});
globalStyle(`${root} ${groupToggle}`, { border: 0, borderRadius: 0, padding: '6px 8px' });
globalStyle(`${root} ${conditionToggle}`, { border: 0, borderRadius: 0, padding: '5px 6px', background: 'transparent' });
globalStyle(`${root} ${addButton}:not(:disabled):hover`, {
    color: vars.color.accent,
    borderColor: vars.color.accent,
    background: vars.color.accentDim,
});
globalStyle(`${root} :focus-visible`, { outline: `2px solid ${vars.color.foreground}`, outlineOffset: 2 });
globalStyle(`${root} button:disabled`, { opacity: 0.5, cursor: 'not-allowed' });
globalStyle(`${root} a`, { color: 'inherit' });
globalStyle(`${selectedConditions} > span`, { color: vars.color.mutedForeground, border: `1px solid ${vars.color.border}`, borderRadius: 999, padding: '2px 6px', maxWidth: '100%', overflowWrap: 'anywhere' });
globalStyle(`${settingsDetails} > summary`, { cursor: 'pointer', overflowWrap: 'anywhere' });
globalStyle(`${settingsDetails}[open] > summary`, { marginBottom: 8 });
globalStyle(`${evidenceDetails} > summary, ${methodDetails} > summary`, { cursor: 'pointer', overflowWrap: 'anywhere' });
globalStyle(`${evidenceDetails}[open] > summary, ${methodDetails}[open] > summary`, { marginBottom: 6 });
globalStyle(`${methodDetails} > p + p`, { marginTop: 6 });
