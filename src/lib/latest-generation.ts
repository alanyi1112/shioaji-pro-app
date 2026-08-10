export interface GenerationRef {
    current: number;
}

export function nextGeneration(ref: GenerationRef): number {
    ref.current += 1;
    return ref.current;
}

export function isLatestGeneration(
    ref: GenerationRef,
    generation: number,
): boolean {
    return ref.current === generation;
}
