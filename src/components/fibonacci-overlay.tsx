import type { FibonacciSnapshot } from '../lib/fibonacci-annotations';
import {
    buildFibonacciOverlayModel,
    type FibonacciCoordinateApi,
} from '../lib/fibonacci-overlay';
import * as styles from './candle-chart.css';

export function FibonacciOverlay({
    snapshot,
    width,
    height,
    rightEdge,
    coordinates,
    formatPrice,
}: {
    snapshot: FibonacciSnapshot;
    width: number;
    height: number;
    rightEdge: number;
    coordinates: FibonacciCoordinateApi;
    formatPrice: (price: number) => string;
}) {
    const model = buildFibonacciOverlayModel(snapshot, {
        width,
        height,
        rightEdge,
        coordinates,
        formatPrice,
    });
    if (
        model.lines.length === 0 &&
        model.bands.length === 0 &&
        model.labels.length === 0 &&
        model.anchors.length === 0
    ) {
        return null;
    }
    return (
        <svg
            className={styles.fibonacciOverlay}
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            role='img'
            aria-label='費波那契回撤與拓展註記'
            data-fibonacci-overlay='true'
        >
            {model.bands.map((band) => (
                <rect
                    key={band.key}
                    x={band.x}
                    y={band.y}
                    width={band.width}
                    height={band.height}
                    fill={band.color}
                    fillOpacity={band.opacity}
                    data-fibonacci-band='true'
                />
            ))}
            {model.lines.map((line) => (
                <line
                    key={line.key}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke={line.color}
                    strokeOpacity={line.opacity}
                    strokeWidth={
                        line.kind === 'pending-price-halo'
                            ? 4
                            : line.kind === 'pending-price-guide'
                              ? 1.5
                              : 1
                    }
                    strokeDasharray={line.dash}
                    strokeLinecap={line.kind === 'wave-guide' ? 'round' : 'butt'}
                    vectorEffect='non-scaling-stroke'
                    data-fibonacci-line={line.kind}
                />
            ))}
            {model.anchors.map((anchor) => (
                <g
                    key={anchor.key}
                    opacity={anchor.opacity}
                    aria-label={`費波那契${anchor.preview ? '預覽' : ''}錨點 ${anchor.label}`}
                    data-fibonacci-anchor={anchor.preview ? 'preview' : 'fixed'}
                >
                    {anchor.preview ? (
                        <>
                            <path
                                d={`M ${anchor.x - 5} ${anchor.y} H ${anchor.x + 5} M ${anchor.x} ${anchor.y - 5} V ${anchor.y + 5}`}
                                fill='none'
                                stroke='rgba(15, 23, 42, 0.96)'
                                strokeWidth='1'
                                vectorEffect='non-scaling-stroke'
                            />
                            <path
                                d={`M ${anchor.x - 5} ${anchor.y} H ${anchor.x + 5} M ${anchor.x} ${anchor.y - 5} V ${anchor.y + 5}`}
                                fill='none'
                                stroke='#f8fafc'
                                strokeWidth='1'
                                vectorEffect='non-scaling-stroke'
                            />
                        </>
                    ) : (
                        <circle
                            cx={anchor.x}
                            cy={anchor.y}
                            r='4'
                            fill='none'
                            stroke='#e2e8f0'
                            strokeWidth='1.25'
                            vectorEffect='non-scaling-stroke'
                        />
                    )}
                </g>
            ))}
            {model.labels.map((label) =>
                label.pendingGuide ? (
                    <g key={label.key} data-fibonacci-price-guide='true'>
                        <rect
                            x={Math.max(4, label.x - Math.max(96, label.text.length * 7 + 18))}
                            y={label.y - 16}
                            width={Math.max(96, label.text.length * 7 + 18)}
                            height='22'
                            rx='3'
                            fill='rgba(15, 23, 42, 0.96)'
                            stroke={label.color}
                            strokeWidth='1'
                        />
                        <text
                            x={label.x}
                            y={label.y}
                            fill='#e0f2fe'
                            fontFamily='ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                            fontSize='11.5'
                            fontWeight='700'
                            textAnchor={label.anchor}
                        >
                            {label.text}
                        </text>
                    </g>
                ) : (
                    <text
                        key={label.key}
                        x={label.x}
                        y={label.y}
                        fill={label.color}
                        stroke='#0f172a'
                        strokeWidth='3'
                        paintOrder='stroke'
                        fontSize='11.5'
                        fontWeight='700'
                        textAnchor={label.anchor}
                        data-fibonacci-label='true'
                    >
                        {label.text}
                    </text>
                ),
            )}
        </svg>
    );
}
