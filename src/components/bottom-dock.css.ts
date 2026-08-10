// src/components/bottom-dock.css.ts

import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const dock = style({
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
});

export const tabBar = style({
    display: 'flex',
    gap: vars.space.xs,
    padding: `0 ${vars.space.sm}`,
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0,
});

const tabBase = style({
    fontFamily: vars.font.display,
    fontSize: '0.7rem',
    fontWeight: 500,
    padding: '7px 14px',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: vars.color.mutedForeground,
    transition: 'all 0.12s',
    ':hover': { color: vars.color.foreground },
});

export const tab = styleVariants({
    off: [tabBase],
    on: [
        tabBase,
        {
            color: vars.color.foreground,
            fontWeight: 600,
            borderBottomColor: vars.color.accent,
        },
    ],
});

export const tabSpacer = style({ flex: 1 });

export const accountSelect = style({
    alignSelf: 'center',
    fontFamily: vars.font.mono,
    fontSize: '0.66rem',
    color: vars.color.foreground,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '2px 4px',
    marginRight: '6px',
    outline: 'none',
    maxWidth: '11rem',
    ':focus': { borderColor: vars.color.accent },
});

export const clickableRow = style({
    cursor: 'pointer',
    ':hover': { background: vars.color.muted },
});

export const table = style({
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: vars.font.mono,
    fontSize: '0.72rem',
    fontVariantNumeric: 'tabular-nums',
});

export const th = style({
    position: 'sticky',
    top: 0,
    textAlign: 'right',
    padding: `4px ${vars.space.sm}`,
    fontFamily: vars.font.display,
    fontSize: '0.62rem',
    fontWeight: 500,
    letterSpacing: '0.04em',
    color: vars.color.mutedForeground,
    background: vars.color.panel,
    borderBottom: `1px solid ${vars.color.border}`,
    selectors: {
        '&:first-child': { textAlign: 'left' },
    },
});

export const td = style({
    textAlign: 'right',
    padding: `4px ${vars.space.sm}`,
    borderBottom: `1px solid rgba(34, 43, 55, 0.5)`,
    selectors: {
        '&:first-child': { textAlign: 'left' },
    },
});

export const quoteCell = styleVariants({
    up: { background: vars.color.up, color: '#fff' },
    down: { background: vars.color.down, color: '#fff' },
});

// quantity cells render mixed-unit stock amounts ("5張+10股") — CJK glyphs
// are line-break opportunities, so pin the whole quantity to one line
export const qtyCell = style({
    whiteSpace: 'nowrap',
});

const chipBase = style({
    display: 'inline-block',
    padding: '1px 8px',
    fontSize: '0.64rem',
    fontWeight: 500,
    borderRadius: '999px',
});

export const statusChip = styleVariants({
    ok: [
        chipBase,
        {
            color: vars.color.down,
            background: vars.color.downDim,
        },
    ],
    pending: [
        chipBase,
        {
            color: vars.color.amber,
            background: 'rgba(224, 164, 60, 0.12)',
        },
    ],
    bad: [
        chipBase,
        {
            color: vars.color.mutedForeground,
            background: vars.color.muted,
        },
    ],
});

export const cancelBtn = style({
    fontFamily: vars.font.display,
    fontSize: '0.64rem',
    fontWeight: 500,
    color: vars.color.up,
    background: 'transparent',
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '1px 8px',
    cursor: 'pointer',
    ':hover': {
        borderColor: vars.color.up,
        background: vars.color.upDim,
    },
});

export const qtyInline = style({
    width: '3.4rem',
    fontFamily: vars.font.mono,
    fontSize: '0.68rem',
    textAlign: 'right',
    color: vars.color.foreground,
    background: vars.color.inset,
    border: `1px solid ${vars.color.accent}`,
    borderRadius: vars.radius.sm,
    padding: '1px 4px',
    outline: 'none',
});

export const detailCell = style({
    fontSize: '0.62rem',
    color: vars.color.mutedForeground,
    whiteSpace: 'nowrap',
});

export const fillCell = style({
    display: 'inline-flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: '2.4rem',
});

export const fillTrack = style({
    display: 'block',
    height: '3px',
    borderRadius: '2px',
    background: vars.color.muted,
    overflow: 'hidden',
});

export const fillBar = style({
    display: 'block',
    height: '100%',
    background: vars.color.amber,
});

export const emptyState = style({
    padding: vars.space.lg,
    textAlign: 'center',
    color: vars.color.mutedForeground,
    fontFamily: vars.font.display,
    fontSize: '0.74rem',
});

export const accountGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: vars.space.sm,
    padding: vars.space.md,
});

export const statCard = style({
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: `${vars.space.sm} ${vars.space.md}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
});

export const statCardLabel = style({
    fontFamily: vars.font.display,
    fontSize: '0.62rem',
    fontWeight: 500,
    color: vars.color.mutedForeground,
});

export const statCardValue = style({
    fontFamily: vars.font.mono,
    fontSize: '1rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
});

export const pnlBar = style({
    height: '3px',
    marginTop: '3px',
    background: vars.color.muted,
    borderRadius: '2px',
    position: 'relative',
    overflow: 'hidden',
});

export const pnlFill = style({
    position: 'absolute',
    top: 0,
    bottom: 0,
    transition: 'width 0.3s',
});

// ---- asset distribution (帳務 tab) ----

export const distBlock = style({
    padding: `${vars.space.sm} ${vars.space.md}`,
    display: 'flex',
    flexDirection: 'column',
    gap: vars.space.xs,
});

export const distTitle = style({
    fontFamily: vars.font.display,
    fontSize: '0.62rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: vars.color.mutedForeground,
});

// donut on the left, aligned detail/holdings list on the right
export const distWrap = style({
    display: 'flex',
    alignItems: 'center',
    gap: vars.space.lg,
});

export const distDetail = style({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
});

export const distRow = style({
    display: 'grid',
    gridTemplateColumns: '10px 5.2rem 1fr 3.2rem',
    alignItems: 'center',
    columnGap: vars.space.sm,
    fontFamily: vars.font.mono,
    fontSize: '0.72rem',
    fontVariantNumeric: 'tabular-nums',
});

export const distLabel = style({
    fontFamily: vars.font.body,
    color: vars.color.foreground,
    fontWeight: 500,
});

export const distValue = style({
    textAlign: 'right',
    color: vars.color.foreground,
    fontWeight: 600,
});

export const distPct = style({
    textAlign: 'right',
    color: vars.color.mutedForeground,
    fontSize: '0.66rem',
});

export const distSwatch = style({
    width: '10px',
    height: '10px',
    borderRadius: '3px',
});

export const holdingHead = style({
    fontFamily: vars.font.display,
    fontSize: '0.6rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: vars.color.mutedForeground,
    marginTop: '6px',
    paddingTop: '6px',
    borderTop: `1px solid ${vars.color.border}`,
});

export const holdingRow = style({
    display: 'grid',
    gridTemplateColumns: '3.6rem 1fr auto 3.2rem',
    alignItems: 'center',
    columnGap: vars.space.sm,
    fontFamily: vars.font.mono,
    fontSize: '0.68rem',
    fontVariantNumeric: 'tabular-nums',
});

export const holdingCode = style({
    color: vars.color.foreground,
    fontWeight: 600,
});

export const holdingTrack = style({
    height: '6px',
    borderRadius: '3px',
    background: vars.color.muted,
    overflow: 'hidden',
});

export const holdingFill = style({
    height: '100%',
    borderRadius: '3px',
    background: vars.color.accent,
    opacity: 0.7,
});

export const holdingValue = style({
    color: vars.color.mutedForeground,
});
