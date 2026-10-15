export interface ChartGridTick {
    fraction: number;
    label?: string;
    major?: boolean;
    origin?: boolean;
}
interface ChartGridProps {
    width: number;
    height: number;
    columns: ChartGridTick[];
    rows: ChartGridTick[];
    className?: string;
    showColumnLabels?: boolean;
    showRowLabels?: boolean;
}
export declare function ChartGrid({ width, height, columns, rows, className, showColumnLabels, showRowLabels, }: ChartGridProps): import("react").JSX.Element;
export declare function chartScaleTicks(start: number, end: number, size: number, orientation: 'horizontal' | 'vertical'): ChartGridTick[];
export declare function chartGridColumns(width: number): ChartGridTick[];
export declare function chartGridRows(height: number): ChartGridTick[];
export declare function formatChartValue(value: number): string;
export {};
