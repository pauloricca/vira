/** Optimize quantized instructions only. Never reassociate arithmetic or move stateful work. */
export declare function optimizeFm1Ops(source: number[][], values: number[], mutableValues: Set<number>, maximumValues: number): number[][];
