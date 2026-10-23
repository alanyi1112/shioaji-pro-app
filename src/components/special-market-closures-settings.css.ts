import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const dialog = style({
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    zIndex: 200, width: 'min(720px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 32px)', display: 'flex', overflow: 'hidden',
    border: `1px solid ${vars.color.borderBright}`, borderRadius: 12,
    background: vars.color.panel, boxShadow: '0 20px 64px rgba(0, 0, 0, 0.4)',
    '@supports': { '(height: 100dvh)': { maxHeight: 'calc(100dvh - 32px)' } },
});
export const root = style({
    display: 'flex', flexDirection: 'column', flex: '1 1 auto',
    minWidth: 0, minHeight: 0, maxHeight: 'inherit',
    fontFamily: vars.font.body, fontSize: '0.875rem', lineHeight: 1.55,
    whiteSpace: 'normal', overflowWrap: 'anywhere', color: vars.color.foreground,
    background: vars.color.panel, borderRadius: 10,
});
export const header = style({
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 16, padding: '20px 24px 16px', flexShrink: 0,
    '@media': { '(max-width: 520px)': { padding: '16px 16px 12px' } },
});
export const heading = style({ margin: 0, fontSize: '1.125rem', lineHeight: 1.4, fontWeight: 650 });
export const description = style({ margin: '4px 0 0', fontSize: '0.8125rem', color: vars.color.mutedForeground });
export const closeButton = style({
    display: 'grid', placeItems: 'center', flexShrink: 0, width: 32, height: 32,
    padding: 0, border: `1px solid ${vars.color.border}`, borderRadius: 6,
    color: vars.color.mutedForeground, background: 'transparent', cursor: 'pointer',
    ':hover': { background: vars.color.muted, color: vars.color.foreground },
    ':focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 2 },
});
export const tabs = style({
    display: 'flex', gap: 20, padding: '0 24px', borderBottom: `1px solid ${vars.color.border}`, flexShrink: 0,
    '@media': { '(max-width: 520px)': { padding: '0 16px', gap: 16 } },
});
export const tab = style({
    padding: '9px 0 10px', fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4,
    border: 'none', borderBottom: '2px solid transparent', background: 'transparent',
    color: vars.color.mutedForeground, cursor: 'pointer',
    selectors: { '&[aria-selected="true"]': { color: vars.color.accent, borderBottomColor: vars.color.accent } },
    ':focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: -2 },
});
export const body = style({
    minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden',
    overscrollBehavior: 'contain', scrollbarGutter: 'stable', padding: '20px 24px',
    '@media': { '(max-width: 520px)': { padding: '16px' } },
});
export const stack = style({ display: 'grid', gap: 16, minWidth: 0 });
export const note = style({
    margin: 0, fontSize: '0.8125rem', lineHeight: 1.6, color: vars.color.mutedForeground,
});
export const notice = style({
    margin: 0, padding: '10px 12px', borderRadius: 6,
    border: `1px solid ${vars.color.border}`, background: vars.color.panelRaised,
    fontSize: '0.8125rem', lineHeight: 1.6, color: vars.color.mutedForeground,
});
export const toolbar = style({
    display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8,
});
export const section = style({
    display: 'grid', minWidth: 0, gap: 12, margin: 0, padding: 0, border: 0,
});
export const sectionTitle = style({ margin: 0, fontSize: '0.9375rem', lineHeight: 1.4, fontWeight: 600 });
export const grid = style({
    display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 16px', minWidth: 0,
    '@media': { '(max-width: 520px)': { gridTemplateColumns: 'minmax(0, 1fr)' } },
});
export const field = style({ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, fontSize: '0.8125rem', fontWeight: 500 });
export const input = style({
    display: 'block', width: '100%', minWidth: 0, maxWidth: '100%', minHeight: 36,
    padding: '7px 10px', borderRadius: 6, border: `1px solid ${vars.color.borderBright}`,
    background: vars.color.inset, color: vars.color.foreground,
    fontFamily: vars.font.body, fontSize: '0.875rem', lineHeight: 1.4,
    ':focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 1 },
    ':disabled': { opacity: 0.55 },
});
export const confirmation = style({
    display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.8125rem', cursor: 'pointer',
});
globalStyle(`${confirmation} input`, { flexShrink: 0, width: 16, height: 16, margin: '3px 0 0', accentColor: vars.color.accent });
export const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 });
export const button = style({
    minHeight: 36, maxWidth: '100%', padding: '7px 12px', borderRadius: 6,
    border: `1px solid ${vars.color.borderBright}`, background: vars.color.panelRaised,
    color: vars.color.foreground, fontSize: '0.8125rem', lineHeight: 1.4, fontWeight: 500,
    whiteSpace: 'normal', cursor: 'pointer',
    ':hover': { background: vars.color.muted },
    ':disabled': { opacity: 0.5, cursor: 'not-allowed' },
    ':focus-visible': { outline: `2px solid ${vars.color.accent}`, outlineOffset: 2 },
});
export const primaryButton = style([button, {
    background: vars.color.accent, borderColor: vars.color.accent, color: '#fff', fontWeight: 600,
    ':hover': { background: vars.color.accent, filter: 'brightness(1.1)' },
}]);
export const disclosure = style({
    borderTop: `1px solid ${vars.color.border}`, paddingTop: 12,
    fontSize: '0.8125rem', color: vars.color.mutedForeground,
});
globalStyle(`${disclosure} summary`, { cursor: 'pointer', width: 'fit-content', maxWidth: '100%', color: vars.color.foreground });
globalStyle(`${disclosure} summary:focus-visible`, { outline: `2px solid ${vars.color.accent}`, outlineOffset: 3 });
globalStyle(`${disclosure} ul`, { paddingLeft: 20, margin: '10px 0 0', display: 'grid', gap: 6 });
export const entryList = style({ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 });
export const entry = style({
    display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
    padding: 12, border: `1px solid ${vars.color.border}`, borderRadius: 6,
});
export const entryContent = style({ flex: '1 1 200px', minWidth: 0 });
export const entryDate = style({ fontWeight: 600, fontVariantNumeric: 'tabular-nums' });
export const entryReason = style({ margin: '4px 0 0', fontSize: '0.8125rem' });
export const empty = style({ padding: '12px 0', margin: 0, fontSize: '0.8125rem', color: vars.color.mutedForeground });
export const result = style({
    display: 'grid', gap: 8, padding: 12, borderRadius: 6,
    background: vars.color.panelRaised, border: `1px solid ${vars.color.borderBright}`,
    fontSize: '0.8125rem', minWidth: 0,
});
export const resultDetails = style({ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '6px 12px', margin: '10px 0 0' });
globalStyle(`${resultDetails} dd`, { margin: 0, minWidth: 0, overflowWrap: 'anywhere' });
export const footer = style({
    flexShrink: 0, padding: '10px 24px', borderTop: `1px solid ${vars.color.border}`,
    fontSize: '0.8125rem', lineHeight: 1.5, color: vars.color.mutedForeground,
    '@media': { '(max-width: 520px)': { padding: '10px 16px' } },
});
