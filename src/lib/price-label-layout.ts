/** Bounded columns keep nearby labels inside the pane without moving their actual price lines. */
export function layoutPriceLabels(ys: readonly number[], height: number, gap = 12, padding = 6) {
    const capacity = Math.max(1, Math.floor((height - padding * 2) / gap) + 1);
    const columns = Math.max(1, Math.ceil(ys.length / capacity));
    const result: { y: number; column: number; columns: number }[] = [];
    for (let begin = 0; begin < ys.length; begin += capacity) {
        const chunk = ys.slice(begin, begin + capacity);
        const positions = chunk.map(y => Math.max(padding, Math.min(height - padding, y)));
        for (let i = 1; i < positions.length; i++) positions[i] = Math.max(positions[i]!, positions[i - 1]! + gap);
        const overflow = Math.max(0, (positions.at(-1) ?? 0) - (height - padding));
        for (const y of positions) result.push({ y: Math.max(padding, y - overflow), column: Math.floor(begin / capacity), columns });
    }
    return result;
}
