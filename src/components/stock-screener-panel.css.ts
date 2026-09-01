import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const root = style({
    overflow: 'auto', minHeight: 0, minWidth: 0, flex: 1,
    padding: 10, fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 10,
});
export const controls = style({ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' });
export const condition = style({ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 });
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
export const rowAction = style({
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, textAlign: 'left',
    whiteSpace: 'normal', overflowWrap: 'anywhere', width: '100%', padding: 8,
    border: 0, borderRadius: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit',
});
globalStyle(`${row} details`, { margin: '0 8px 8px' });
globalStyle(`${row} details span`, { display: 'block', overflowWrap: 'anywhere' });
globalStyle(`${root} input[type="number"]`, { width: '5.5rem', maxWidth: '100%' });
globalStyle(`${root} label`, { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
    minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' });
globalStyle(`${root} input, ${root} select, ${root} button:not(.${rowAction})`, {
    font: 'inherit', color: vars.color.foreground, background: vars.color.muted,
    border: `1px solid ${vars.color.border}`, borderRadius: 4, padding: '5px 7px', maxWidth: '100%', boxSizing: 'border-box',
});
globalStyle(`${root} :focus-visible`, { outline: `2px solid ${vars.color.foreground}`, outlineOffset: 2 });
globalStyle(`${root} button:disabled`, { opacity: 0.5, cursor: 'not-allowed' });
globalStyle(`${root} a`, { color: 'inherit' });
