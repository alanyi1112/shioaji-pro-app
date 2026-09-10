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
    display: 'grid',
    gridTemplateColumns: '7.6rem 1fr 3.4rem',
    columnGap: vars.space.sm,
    padding: `2px ${vars.space.sm}`,
    borderBottom: `1px solid rgba(34, 43, 55, 0.45)`,
});

// big-lot rows pop with a subtle amber wash + bold volume
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

export const volBig = style([
    vol,
    {
        color: vars.color.amber,
        fontWeight: 700,
    },
]);
