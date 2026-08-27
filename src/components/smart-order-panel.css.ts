import { globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const root = style({
    display: 'flex',
    minHeight: 0,
    flex: 1,
    flexDirection: 'column',
    overflow: 'hidden',
    color: vars.color.foreground,
    fontFamily: vars.font.display,
});

export const boundaryNotice = style({
    display: 'flex',
    alignItems: 'flex-start',
    gap: vars.space.sm,
    padding: '8px 10px',
    borderBottom: `1px solid ${vars.color.border}`,
    background: 'rgba(224, 164, 60, 0.08)',
    color: vars.color.amber,
    fontSize: '0.66rem',
    lineHeight: 1.45,
});

export const exposureBoundaryNotice = style({
    display: 'flex',
    flexWrap: 'wrap',
    gap: '2px 5px',
    padding: '8px 10px',
    borderBottom: `1px solid ${vars.color.border}`,
    background: 'rgba(239, 68, 68, 0.07)',
    color: vars.color.amber,
    fontSize: '0.62rem',
    lineHeight: 1.5,
});

export const statusDot = styleVariants({
    online: {
        flexShrink: 0,
        width: 7,
        height: 7,
        marginTop: 3,
        borderRadius: '50%',
        background: vars.color.down,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${vars.color.down} 18%, transparent)`,
    },
    offline: {
        flexShrink: 0,
        width: 7,
        height: 7,
        marginTop: 3,
        borderRadius: '50%',
        background: vars.color.mutedForeground,
    },
});

export const runtimeStrip = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 1,
    padding: '6px 8px',
    background: vars.color.border,
    borderBottom: `1px solid ${vars.color.border}`,
});

export const runtimeCell = style({
    minWidth: 0,
    padding: '5px 7px',
    background: vars.color.panel,
});

export const runtimeLabel = style({
    display: 'block',
    marginBottom: 2,
    color: vars.color.mutedForeground,
    fontSize: '0.56rem',
    letterSpacing: '0.04em',
});

export const runtimeValue = style({
    display: 'block',
    overflow: 'hidden',
    color: vars.color.foreground,
    fontFamily: vars.font.mono,
    fontSize: '0.62rem',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

export const limitNotice = style({
    display: 'grid',
    gap: 3,
    padding: '6px 9px',
    borderBottom: `1px solid ${vars.color.border}`,
    background: 'rgba(59, 130, 246, 0.055)',
    color: vars.color.mutedForeground,
    fontSize: '0.56rem',
    lineHeight: 1.45,
});

export const drainSummary = style({
    display: 'grid',
    gap: 5,
    padding: '7px 9px',
    borderBottom: `1px solid ${vars.color.border}`,
    background: 'rgba(239, 68, 68, 0.055)',
    color: vars.color.mutedForeground,
    fontSize: '0.58rem',
    lineHeight: 1.45,
});

export const drainSummaryHeader = style({
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    color: vars.color.foreground,
    fontWeight: 700,
});

export const drainItem = style({
    display: 'grid',
    gap: 1,
    paddingLeft: 7,
    borderLeft: '2px solid rgba(239, 68, 68, 0.55)',
});

export const drainRecordList = style({
    display: 'grid',
    gap: 4,
    maxHeight: 156,
    margin: 0,
    padding: 0,
    overflowY: 'auto',
    listStyle: 'none',
});

export const drainRecord = style({
    display: 'grid',
    gap: 1,
    padding: '4px 6px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    background: 'rgba(15, 23, 42, 0.28)',
});

export const tabs = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 4,
    padding: 8,
    borderBottom: `1px solid ${vars.color.border}`,
});

export const tab = styleVariants({
    idle: {
        minHeight: 32,
        border: `1px solid ${vars.color.border}`,
        borderRadius: vars.radius.sm,
        background: vars.color.muted,
        color: vars.color.mutedForeground,
        fontSize: '0.66rem',
        fontWeight: 600,
        cursor: 'pointer',
    },
    active: {
        minHeight: 32,
        border: '1px solid rgba(224, 164, 60, 0.65)',
        borderRadius: vars.radius.sm,
        background: 'rgba(224, 164, 60, 0.2)',
        color: vars.color.amber,
        fontSize: '0.66rem',
        fontWeight: 700,
        cursor: 'pointer',
    },
});

export const content = style({
    display: 'flex',
    minHeight: 0,
    flex: 1,
    flexDirection: 'column',
    overflow: 'auto',
    padding: 10,
});

export const empty = style({
    display: 'flex',
    minHeight: 210,
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 18,
    textAlign: 'center',
});

export const emptyTitle = style({
    margin: 0,
    fontSize: '0.86rem',
    lineHeight: 1.5,
});

export const emptyText = style({
    maxWidth: 280,
    margin: 0,
    color: vars.color.mutedForeground,
    fontSize: '0.65rem',
    lineHeight: 1.55,
});

export const primaryButton = style({
    width: 'min(100%, 240px)',
    minHeight: 38,
    border: '1px solid rgba(59, 130, 246, 0.85)',
    borderRadius: vars.radius.sm,
    background: 'rgba(37, 99, 235, 0.78)',
    color: '#fff',
    fontFamily: vars.font.display,
    fontSize: '0.74rem',
    fontWeight: 700,
    cursor: 'pointer',
    selectors: {
        '&:hover:not(:disabled)': { background: 'rgba(37, 99, 235, 0.95)' },
        '&:disabled': { cursor: 'not-allowed', opacity: 0.45 },
    },
});

export const secondaryButton = style({
    minHeight: 38,
    border: `1px solid ${vars.color.borderBright}`,
    borderRadius: vars.radius.sm,
    background: 'transparent',
    color: vars.color.mutedForeground,
    fontFamily: vars.font.display,
    fontSize: '0.7rem',
    fontWeight: 600,
    cursor: 'pointer',
});

export const dialogBackdrop = style({
    position: 'fixed',
    zIndex: 2400,
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    padding: 16,
    background: 'rgba(0, 0, 0, 0.72)',
    backdropFilter: 'blur(2px)',
});

export const selector = style({
    display: 'flex',
    width: 'min(520px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 32px)',
    flexDirection: 'column',
    gap: 10,
    overflow: 'auto',
    border: `1px solid ${vars.color.borderBright}`,
    borderRadius: vars.radius.md,
    padding: 18,
    background: vars.color.panelRaised,
    boxShadow: '0 24px 72px rgba(0, 0, 0, 0.55)',
});

export const selectorHeading = style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    margin: 0,
    fontSize: '0.84rem',
});

export const infoBadge = style({
    display: 'inline-grid',
    width: 17,
    height: 17,
    placeItems: 'center',
    border: `1px solid ${vars.color.borderBright}`,
    borderRadius: '50%',
    color: vars.color.mutedForeground,
    fontFamily: vars.font.mono,
    fontSize: '0.58rem',
});

export const selectorHelp = style({
    margin: 0,
    color: vars.color.mutedForeground,
    fontSize: '0.62rem',
    lineHeight: 1.5,
    textAlign: 'center',
});

export const kindGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
    padding: 12,
    border: '1px solid rgba(59, 130, 246, 0.65)',
    borderRadius: vars.radius.sm,
    '@media': {
        'screen and (max-width: 460px)': {
            gridTemplateColumns: '1fr',
        },
    },
});

export const kindOption = styleVariants({
    idle: {
        display: 'flex',
        minWidth: 0,
        alignItems: 'center',
        gap: 7,
        padding: '7px 5px',
        border: '1px solid transparent',
        borderRadius: vars.radius.sm,
        color: vars.color.foreground,
        fontSize: '0.68rem',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
    },
    selected: {
        display: 'flex',
        minWidth: 0,
        alignItems: 'center',
        gap: 7,
        padding: '7px 5px',
        border: '1px solid rgba(224, 164, 60, 0.45)',
        borderRadius: vars.radius.sm,
        background: 'rgba(224, 164, 60, 0.12)',
        color: vars.color.amber,
        fontSize: '0.68rem',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
    },
});

export const visuallyHidden = style({
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
});

export const kindGate = style({
    marginLeft: 'auto',
    color: vars.color.mutedForeground,
    fontSize: '0.56rem',
    fontWeight: 500,
});

export const radio = style({
    display: 'grid',
    width: 18,
    height: 18,
    flexShrink: 0,
    placeItems: 'center',
    border: `1px solid ${vars.color.borderBright}`,
    borderRadius: '50%',
    selectors: {
        [`${kindOption.selected} &`]: {
            borderColor: vars.color.amber,
            background: vars.color.amber,
            color: vars.color.background,
        },
    },
});

globalStyle(
    `${kindOption.idle} > input:focus-visible + ${radio}, ${kindOption.selected} > input:focus-visible + ${radio}`,
    {
        outline: '2px solid #93c5fd',
        outlineOffset: 2,
    },
);

export const actions = style({
    display: 'grid',
    gridTemplateColumns: 'minmax(90px, 0.8fr) minmax(120px, 1.4fr)',
    gap: 8,
    marginTop: 'auto',
});

export const cardList = style({
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
});

export const historyToolbar = style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
    color: vars.color.mutedForeground,
    fontSize: '0.58rem',
});

export const strategyCard = style({
    padding: 10,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    background: vars.color.panelRaised,
});

export const strategyCardHeader = style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 5,
    fontSize: '0.68rem',
    fontWeight: 700,
});

export const strategyMeta = style({
    color: vars.color.mutedForeground,
    fontFamily: vars.font.mono,
    fontSize: '0.58rem',
    lineHeight: 1.5,
});

export const activityTrace = style({
    display: 'grid',
    gap: 3,
    marginTop: 7,
    marginBottom: 7,
    paddingTop: 6,
    borderTop: `1px solid ${vars.color.border}`,
    fontSize: '0.56rem',
    lineHeight: 1.45,
});

export const activityTraceRow = style({
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    color: vars.color.mutedForeground,
});

globalStyle(`${activityTraceRow} > span:last-child`, {
    minWidth: 0,
    overflowWrap: 'anywhere',
    color: vars.color.foreground,
    fontFamily: vars.font.mono,
    textAlign: 'right',
});

export const activityTraceRisk = style({
    display: 'grid',
    gap: 2,
    padding: '3px 5px',
    borderLeft: '2px solid rgba(239, 68, 68, 0.75)',
    background: 'rgba(239, 68, 68, 0.06)',
    color: '#fca5a5',
    fontWeight: 700,
});

export const strategyActions = style({
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
    marginTop: 8,
});

export const compactButton = style({
    minHeight: 30,
    padding: '4px 9px',
    border: `1px solid ${vars.color.borderBright}`,
    borderRadius: vars.radius.sm,
    background: vars.color.muted,
    color: vars.color.foreground,
    fontFamily: vars.font.display,
    fontSize: '0.62rem',
    fontWeight: 600,
    cursor: 'pointer',
    selectors: {
        '&:hover:not(:disabled)': {
            borderColor: 'rgba(59, 130, 246, 0.75)',
            color: '#93c5fd',
        },
        '&:disabled': { cursor: 'not-allowed', opacity: 0.45 },
    },
});

export const compactDangerButton = style({
    minHeight: 30,
    padding: '4px 9px',
    border: '1px solid rgba(239, 68, 68, 0.48)',
    borderRadius: vars.radius.sm,
    background: 'rgba(239, 68, 68, 0.07)',
    color: '#f87171',
    fontFamily: vars.font.display,
    fontSize: '0.62rem',
    fontWeight: 600,
    cursor: 'pointer',
    selectors: {
        '&:hover:not(:disabled)': { background: 'rgba(239, 68, 68, 0.14)' },
        '&:disabled': { cursor: 'not-allowed', opacity: 0.45 },
    },
});

export const error = style({
    marginBottom: 8,
    padding: '7px 9px',
    border: '1px solid rgba(239, 68, 68, 0.45)',
    borderRadius: vars.radius.sm,
    background: 'rgba(239, 68, 68, 0.08)',
    color: '#f87171',
    fontSize: '0.62rem',
    lineHeight: 1.45,
});

export const stepper = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 6,
    margin: 0,
    padding: 0,
    listStyle: 'none',
});

const stepBase = {
    display: 'flex',
    minWidth: 0,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: vars.radius.sm,
    fontSize: '0.6rem',
    fontWeight: 700,
} as const;

export const step = styleVariants({
    pending: [
        stepBase,
        {
            border: `1px solid ${vars.color.border}`,
            background: vars.color.muted,
            color: vars.color.mutedForeground,
        },
    ],
    active: [
        stepBase,
        {
            border: '1px solid rgba(59, 130, 246, 0.78)',
            background: 'rgba(37, 99, 235, 0.16)',
            color: '#93c5fd',
        },
    ],
    complete: [
        stepBase,
        {
            border: '1px solid rgba(224, 164, 60, 0.5)',
            background: 'rgba(224, 164, 60, 0.1)',
            color: vars.color.amber,
        },
    ],
});

export const lockedNotice = style({
    padding: '8px 10px',
    border: '1px solid rgba(224, 164, 60, 0.5)',
    borderRadius: vars.radius.sm,
    background: 'rgba(224, 164, 60, 0.08)',
    color: vars.color.amber,
    fontSize: '0.62rem',
    lineHeight: 1.5,
});

export const formStack = style({
    display: 'flex',
    minHeight: 0,
    flexDirection: 'column',
    gap: 10,
});

export const formSection = style({
    display: 'grid',
    gap: 8,
    padding: 10,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    background: vars.color.panel,
});

globalStyle(`${formSection} > h4`, {
    margin: 0,
    fontSize: '0.68rem',
});

export const formGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
    '@media': {
        'screen and (max-width: 520px)': {
            gridTemplateColumns: '1fr',
        },
    },
});

export const field = style({
    display: 'grid',
    minWidth: 0,
    gap: 4,
    color: vars.color.mutedForeground,
    fontSize: '0.58rem',
});

globalStyle(`${field} > input, ${field} > select`, {
    width: '100%',
    minWidth: 0,
    minHeight: 33,
    boxSizing: 'border-box',
    border: `1px solid ${vars.color.borderBright}`,
    borderRadius: vars.radius.sm,
    padding: '5px 8px',
    background: vars.color.background,
    color: vars.color.foreground,
    fontFamily: vars.font.mono,
    fontSize: '0.62rem',
});

globalStyle(`${field} > input:read-only, ${field} > select:disabled`, {
    cursor: 'not-allowed',
    color: vars.color.mutedForeground,
    opacity: 0.82,
});

globalStyle(`${field} > input:focus-visible, ${field} > select:focus-visible`, {
    borderColor: 'rgba(59, 130, 246, 0.85)',
    outline: '2px solid rgba(59, 130, 246, 0.22)',
    outlineOffset: 1,
});

export const fieldHelp = style({
    margin: 0,
    color: vars.color.mutedForeground,
    fontSize: '0.57rem',
    lineHeight: 1.5,
});

export const confirmationWarning = style({
    padding: '9px 10px',
    border: '1px solid rgba(239, 68, 68, 0.5)',
    borderRadius: vars.radius.sm,
    background: 'rgba(239, 68, 68, 0.08)',
    color: '#fca5a5',
    fontSize: '0.62rem',
    fontWeight: 700,
    lineHeight: 1.5,
});

export const summaryList = style({
    display: 'grid',
    gap: 1,
    margin: 0,
    overflow: 'hidden',
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    background: vars.color.border,
});

globalStyle(`${summaryList} > div`, {
    display: 'grid',
    gridTemplateColumns: 'minmax(94px, 0.65fr) minmax(0, 1.35fr)',
    gap: 8,
    padding: '7px 8px',
    background: vars.color.panelRaised,
});

globalStyle(`${summaryList} dt`, {
    color: vars.color.mutedForeground,
    fontSize: '0.57rem',
});

globalStyle(`${summaryList} dd`, {
    minWidth: 0,
    margin: 0,
    overflowWrap: 'anywhere',
    color: vars.color.foreground,
    fontFamily: vars.font.mono,
    fontSize: '0.59rem',
});

export const stateDetail = styleVariants({
    normal: {
        marginBottom: 6,
        color: vars.color.mutedForeground,
        fontSize: '0.58rem',
        lineHeight: 1.5,
    },
    risk: {
        marginBottom: 6,
        padding: '5px 7px',
        borderLeft: '2px solid rgba(239, 68, 68, 0.7)',
        background: 'rgba(239, 68, 68, 0.06)',
        color: '#fca5a5',
        fontSize: '0.58rem',
        lineHeight: 1.5,
    },
});

globalStyle(
    `${primaryButton}:focus-visible, ${secondaryButton}:focus-visible, ${compactButton}:focus-visible, ${compactDangerButton}:focus-visible, ${root} [role="tab"]:focus-visible`,
    {
        outline: '2px solid #93c5fd',
        outlineOffset: 2,
    },
);
