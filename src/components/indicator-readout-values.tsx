import type { IndicatorReadoutValue } from '../lib/indicator-defs';
import * as styles from './candle-chart.css';

export function IndicatorReadoutValues({
    values,
}: {
    values: readonly IndicatorReadoutValue[];
}) {
    return (
        <span
            className={styles.legendVals}
            data-indicator-readout-values='true'
        >
            {values.map((value) => {
                const label = value.prefix ?? value.label;
                const accessibleText = `${label} ${value.text}`;
                return (
                    <span
                        key={value.key}
                        className={styles.legendVal}
                        style={{ color: value.color }}
                        title={accessibleText}
                        aria-label={accessibleText}
                        data-indicator-readout-value={value.key}
                    >
                        {value.prefix && <span>{value.prefix} </span>}
                        {value.text}
                    </span>
                );
            })}
        </span>
    );
}
