// src/components/tick-tape.css.ts

import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const tape = style({
    fontFamily: vars.font.mono,
    fontSize: '0.7rem',
    fontVariantNumeric: 'tabular-nums',
    display: 'flex',
    flexDirection: 'column',
});

export const toolbar = style({
    display: 'flex',
    gap: '4px',
    padding: `4px ${vars.space.sm}`,
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0,
});

const tabBase = style({
    minHeight: '22px',
    padding: '2px 8px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    background: vars.color.inset,
    color: vars.color.mutedForeground,
    fontFamily: vars.font.body,
    fontSize: '0.68rem',
    cursor: 'pointer',
    ':hover': {
        color: vars.color.foreground,
        borderColor: vars.color.borderBright,
    },
});

export const tab = style([tabBase]);

export const tabActive = style([
    tabBase,
    {
        color: vars.color.accent,
        borderColor: vars.color.accent,
        background: vars.color.accentDim,
    },
]);

export const ruleBox = style({
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: `5px ${vars.space.sm}`,
    color: vars.color.mutedForeground,
    background: vars.color.inset,
    borderBottom: `1px solid ${vars.color.border}`,
    fontFamily: vars.font.body,
    fontSize: '0.64rem',
    lineHeight: 1.35,
});

export const warmup = style({
    color: vars.color.amber,
});

export const tapeRow = style({
    height: 24,
    boxSizing: 'border-box',
    alignItems: 'center',
    display: 'grid',
    gridTemplateColumns: '7.6rem 1fr 3.4rem',
    columnGap: vars.space.sm,
    padding: `2px ${vars.space.sm}`,
    borderBottom: `1px solid rgba(34, 43, 55, 0.45)`,
});

// Big-lot rows retain the subtle highlight while their volume follows the
// same up/down/flat colour as the trade price.
export const tapeRowBig = style([
    tapeRow,
    {
        background: 'rgba(224, 164, 60, 0.07)',
    },
]);

export const time = style({
    color: vars.color.mutedForeground,
});

export const vol = style({
    textAlign: 'right',
    color: vars.color.mutedForeground,
});

export const volBig = style({
    textAlign: 'right',
    fontWeight: 700,
});

export const body = style({ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' });
export const viewport = style({ flex: 1, minHeight: 0, overflow: 'auto', overflowAnchor: 'none' });
export const settings = style({
    display: 'flex', flexDirection: 'column', gap: 6, padding: 12, maxHeight: '75vh', overflow: 'auto', flexShrink: 0,
    fontSize: '0.72rem', color: vars.color.foreground, background: vars.color.inset,
});
export const settingField = style({ display: 'grid', gridTemplateColumns: 'minmax(110px, 1fr) minmax(70px, 1fr)', gap: 8, alignItems: 'center' });
export const settingInput = style({
    minWidth: 0, width: '100%', boxSizing: 'border-box', padding: '4px 6px',
    borderRadius: vars.radius.sm, border: `1px solid ${vars.color.border}`, background: vars.color.panel,
    color: vars.color.foreground, fontFamily: vars.font.mono, fontSize: '0.72rem',
    ':focus': { outline: `1px solid ${vars.color.accent}`, outlineOffset: 1 },
});

export const settingsDialog = style({
    padding: 0, width: 'min(380px, calc(100vw - 32px))', maxWidth: 'calc(100vw - 32px)',
    maxHeight: '85vh', overflow: 'auto', color: vars.color.foreground, background: vars.color.inset,
    border: `1px solid ${vars.color.borderBright}`, borderRadius: vars.radius.md,
    boxShadow: '0 12px 48px rgba(0, 0, 0, 0.5)', '::backdrop': { background: 'rgba(0, 0, 0, 0.4)' },
});

export const infoButton = style([tabBase, {
    marginLeft: 'auto', flexShrink: 0, width: 22, padding: 0, borderRadius: '50%',
    fontFamily: vars.font.mono, fontWeight: 700,
}]);
