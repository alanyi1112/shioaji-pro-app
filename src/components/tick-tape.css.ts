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
    overflowX: 'auto',
    '@container': {
        '(max-height: 240px)': { padding: `2px ${vars.space.sm}` },
    },
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
    flexShrink: 0,
    whiteSpace: 'nowrap',
    '@container': {
        '(max-height: 240px)': {
            minHeight: 18,
            padding: '1px 6px',
            fontSize: '0.62rem',
        },
    },
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

export const body = style({ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden', containerType: 'size' });
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

export const distributionBody = style({
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    fontFamily: vars.font.body,
});

export const distributionSummary = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 1,
    padding: 4,
    background: vars.color.border,
    borderBottom: `1px solid ${vars.color.border}`,
    '@container': {
        '(max-height: 240px)': { padding: 2 },
    },
});

export const distributionSummaryItem = style({
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '3px 5px',
    background: vars.color.inset,
    '@container': {
        '(max-height: 240px)': {
            flexDirection: 'row',
            justifyContent: 'center',
            padding: 2,
        },
    },
});

export const distributionSummaryValue = style({
    color: vars.color.amber,
    fontFamily: vars.font.mono,
    fontSize: 'clamp(0.9rem, 4vw, 1.1rem)',
    fontVariantNumeric: 'tabular-nums',
    '@container': {
        '(max-height: 240px)': { fontSize: '0.86rem' },
    },
});

export const distributionSummaryLabel = style({
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: vars.color.mutedForeground,
    fontSize: '0.6rem',
    '@container': {
        '(max-height: 240px)': { fontSize: '0.55rem' },
    },
});

export const distributionStatus = style({
    display: 'flex',
    flexWrap: 'nowrap',
    gap: '0 10px',
    minHeight: 24,
    boxSizing: 'border-box',
    overflow: 'hidden',
    padding: `3px ${vars.space.sm}`,
    color: vars.color.mutedForeground,
    background: vars.color.inset,
    borderBottom: `1px solid ${vars.color.border}`,
    fontSize: '0.63rem',
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
    '@container': {
        '(max-height: 240px)': { display: 'none' },
    },
});

export const distributionCoverageHeadline = style({
    color: vars.color.amber,
    fontWeight: 700,
});

export const distributionActions = style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 22,
    boxSizing: 'border-box',
    padding: `2px ${vars.space.sm}`,
    color: vars.color.mutedForeground,
    borderBottom: `1px solid ${vars.color.border}`,
    fontSize: '0.64rem',
});

export const distributionActionSummary = style({
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

export const distributionCompactCoverage = style({
    display: 'none',
    flexShrink: 0,
    color: vars.color.amber,
    fontWeight: 700,
    '@container': {
        '(max-height: 240px)': { display: 'inline-flex' },
    },
});

const distributionGrid = {
    display: 'grid',
    gridTemplateColumns: 'minmax(50px, 0.9fr) minmax(48px, 1.2fr) minmax(40px, 0.72fr) minmax(38px, 0.68fr) minmax(40px, 0.72fr)',
    alignItems: 'center',
    columnGap: 4,
    minWidth: 0,
} as const;

export const distributionTableHeader = style({
    ...distributionGrid,
    position: 'sticky',
    top: 0,
    zIndex: 1,
    flexShrink: 0,
    minHeight: 24,
    boxSizing: 'border-box',
    padding: '3px 6px',
    color: vars.color.mutedForeground,
    background: vars.color.panelRaised,
    borderBottom: `1px solid ${vars.color.border}`,
    fontSize: '0.6rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
});

export const distributionHeaderNumber = style({ textAlign: 'right' });

export const distributionViewport = style({
    flex: 1,
    minHeight: 0,
    overflowX: 'hidden',
    overflowY: 'auto',
    overflowAnchor: 'none',
});

export const distributionRows = style({
    position: 'relative',
    width: '100%',
    minWidth: 0,
});

export const distributionRow = style({
    ...distributionGrid,
    position: 'absolute',
    left: 0,
    right: 0,
    height: 28,
    boxSizing: 'border-box',
    padding: '2px 6px',
    borderBottom: `1px solid rgba(34, 43, 55, 0.55)`,
    fontFamily: vars.font.mono,
    fontSize: '0.68rem',
    fontVariantNumeric: 'tabular-nums',
});

export const distributionPrice = style({
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 4,
    color: vars.color.foreground,
    fontWeight: 700,
});

export const markerGroup = style({
    display: 'inline-flex',
    minWidth: 0,
    gap: 2,
});

export const marker = style({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 16,
    padding: '0 3px',
    boxSizing: 'border-box',
    borderRadius: 3,
    color: vars.color.amber,
    background: vars.color.accentDim,
    fontFamily: vars.font.body,
    fontSize: '0.6rem',
    fontWeight: 700,
});

export const distributionBarTrack = style({
    display: 'block',
    height: 14,
    overflow: 'hidden',
    border: `1px solid ${vars.color.border}`,
    borderRadius: 2,
    background: vars.color.muted,
});

export const distributionBarFill = style({
    display: 'flex',
    height: '100%',
    minWidth: 1,
    overflow: 'hidden',
});

export const buyBar = style({ display: 'block', height: '100%', background: vars.color.up });
export const sellBar = style({ display: 'block', height: '100%', background: vars.color.down });
export const unknownBar = style({ display: 'block', height: '100%', background: vars.color.flat });

export const distributionNumber = style({
    overflow: 'hidden',
    textAlign: 'right',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: vars.color.foreground,
});

export const distributionEmpty = style({
    padding: 16,
    color: vars.color.mutedForeground,
    textAlign: 'center',
    fontSize: '0.7rem',
});

export const moneyBody = style({
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    fontFamily: vars.font.body,
});

export const moneyExplanation = style({
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    flexShrink: 0,
    padding: `4px ${vars.space.sm}`,
    color: vars.color.mutedForeground,
    background: vars.color.inset,
    borderBottom: `1px solid ${vars.color.border}`,
    fontSize: '0.61rem',
    lineHeight: 1.25,
    '@container': {
        '(max-height: 360px)': { display: 'none' },
    },
});

export const moneyUnknownDetails = style({
    flexShrink: 0,
    maxHeight: 120,
    overflow: 'auto',
    padding: `3px ${vars.space.sm}`,
    color: vars.color.mutedForeground,
    background: vars.color.inset,
    borderBottom: `1px solid ${vars.color.border}`,
    fontSize: '0.61rem',
    lineHeight: 1.35,
});
export const moneyUnknownList = style({
    margin: '4px 0 0',
    paddingLeft: 17,
    overflowWrap: 'anywhere',
    fontVariantNumeric: 'tabular-nums',
});

export const moneyChartBlock = style({
    flexShrink: 0,
    minWidth: 0,
    padding: '3px 4px 2px',
    borderBottom: `1px solid ${vars.color.border}`,
    '@container': {
        '(max-height: 360px)': { paddingTop: 0 },
    },
});

export const moneyChart = style({
    display: 'block',
    width: '100%',
    height: 150,
    overflow: 'visible',
    '@container': {
        '(max-height: 360px)': { height: 96 },
    },
});

export const moneyGridLine = style({
    stroke: vars.color.border,
    strokeWidth: 0.8,
    vectorEffect: 'non-scaling-stroke',
});

export const moneyZeroAxis = style({
    stroke: vars.color.borderBright,
    strokeWidth: 1.2,
    vectorEffect: 'non-scaling-stroke',
});

export const moneyAxisLabel = style({
    fill: vars.color.mutedForeground,
    fontFamily: vars.font.mono,
    fontSize: 8,
    fontVariantNumeric: 'tabular-nums',
});

const moneyLine = style({
    fill: 'none',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    vectorEffect: 'non-scaling-stroke',
});
export const moneyOverallLine = style([moneyLine, { stroke: '#d946ef' }]);
export const moneyLargeLine = style([moneyLine, { stroke: vars.color.accent }]);
export const moneyNonLargeLine = style([moneyLine, { stroke: vars.color.amber }]);

export const moneyLegend = style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minWidth: 0,
    color: vars.color.mutedForeground,
    fontSize: '0.62rem',
    whiteSpace: 'nowrap',
});
export const moneyLegendItem = style({ display: 'inline-flex', alignItems: 'center', gap: 4 });

const moneySwatch = style({ display: 'inline-block', width: 9, height: 3, borderRadius: 2 });
export const moneyOverallSwatch = style([moneySwatch, { background: '#d946ef' }]);
export const moneyLargeSwatch = style([moneySwatch, { background: vars.color.accent }]);
export const moneyNonLargeSwatch = style([moneySwatch, { background: vars.color.amber }]);
export const moneyUnit = style({
    '@container': { '(max-width: 300px)': { display: 'none !important' } },
});

export const moneyActions = style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    flexShrink: 0,
    minHeight: 24,
    padding: `2px ${vars.space.sm}`,
    boxSizing: 'border-box',
    overflow: 'hidden',
    color: vars.color.mutedForeground,
    borderBottom: `1px solid ${vars.color.border}`,
    fontSize: '0.61rem',
    whiteSpace: 'nowrap',
});
export const moneyActionText = style({ overflow: 'hidden', textOverflow: 'ellipsis' });

const moneyGrid = {
    display: 'grid',
    gridTemplateColumns: 'minmax(38px, 0.62fr) repeat(3, minmax(48px, 1fr))',
    alignItems: 'center',
    columnGap: 4,
    minWidth: 0,
} as const;

export const moneyViewport = style({
    flex: 1,
    minHeight: 0,
    overflowX: 'hidden',
    overflowY: 'auto',
    overflowAnchor: 'none',
});
export const moneyTableHeader = style({
    ...moneyGrid,
    position: 'sticky',
    top: 0,
    zIndex: 1,
    height: 24,
    padding: '3px 6px',
    boxSizing: 'border-box',
    color: vars.color.mutedForeground,
    background: vars.color.panelRaised,
    borderBottom: `1px solid ${vars.color.border}`,
    fontSize: '0.58rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
});
export const moneyHeaderNumber = style({ textAlign: 'right' });
export const moneyRows = style({ position: 'relative', width: '100%', minWidth: 0 });
export const moneyTableRow = style({
    ...moneyGrid,
    position: 'absolute',
    left: 0,
    right: 0,
    height: 28,
    padding: '2px 6px',
    boxSizing: 'border-box',
    borderBottom: `1px solid rgba(34, 43, 55, 0.55)`,
    color: vars.color.foreground,
    fontFamily: vars.font.mono,
    fontSize: '0.67rem',
    fontVariantNumeric: 'tabular-nums',
});
export const moneyNumber = style({
    minWidth: 0,
    overflow: 'hidden',
    textAlign: 'right',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});
export const moneyPositive = style({ color: vars.color.up });
export const moneyNegative = style({ color: vars.color.down });
export const moneyZero = style({ color: vars.color.flat });
