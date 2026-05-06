import {
  buildSpectrumLinePathFromValues,
  buildSpectrumStandardDeviationBandPath,
  computeSpectrumPlotValueRange,
  computeSpectrumPlotXRange,
  DEFAULT_SPECTRUM_PLOT_PADDING,
  projectXPositionToPixelX,
  projectYValueToPixelY,
  type SpectrumPlotDimensions,
  type SpectrumPlotValueRange,
  type SpectrumPlotXRange,
} from "@/lib/image/spectrum-plot-geometry";

const SPECTRUM_PLOT_WIDTH_PX = 268;
const SPECTRUM_PLOT_HEIGHT_PX = 160;

export interface SpectrumLinePlotInput {
  readonly id: string;
  readonly colorClass: string;
  readonly values: ReadonlyArray<number>;
  readonly bandStandardDeviations?: ReadonlyArray<number>;
}

export interface SpectrumPlotProps {
  readonly bandPositions: ReadonlyArray<number>;
  readonly tickPositions: ReadonlyArray<number>;
  readonly tickLabels: ReadonlyArray<string>;
  readonly xAxisLabel: string;
  readonly yAxisLabel: string;
  readonly lines: ReadonlyArray<SpectrumLinePlotInput>;
}

export function SpectrumPlot(props: SpectrumPlotProps): JSX.Element {
  const dimensions = buildSpectrumPlotDimensions();
  const xRange = computeSpectrumPlotXRange(props.bandPositions);
  const valueRange = computeSpectrumPlotValueRange(extractAllValueListsFromLines(props.lines));
  return (
    <figure className="flex flex-col gap-1">
      <SpectrumPlotSvg
        dimensions={dimensions}
        xRange={xRange}
        valueRange={valueRange}
        bandPositions={props.bandPositions}
        tickPositions={props.tickPositions}
        tickLabels={props.tickLabels}
        lines={props.lines}
      />
      <SpectrumPlotAxisLabels xAxisLabel={props.xAxisLabel} yAxisLabel={props.yAxisLabel} />
    </figure>
  );
}

function buildSpectrumPlotDimensions(): SpectrumPlotDimensions {
  return {
    width: SPECTRUM_PLOT_WIDTH_PX,
    height: SPECTRUM_PLOT_HEIGHT_PX,
    padding: DEFAULT_SPECTRUM_PLOT_PADDING,
  };
}

function extractAllValueListsFromLines(
  lines: ReadonlyArray<SpectrumLinePlotInput>,
): ReadonlyArray<ReadonlyArray<number>> {
  const lists: number[][] = [];
  for (const line of lines) {
    lists.push([...line.values]);
    if (line.bandStandardDeviations) {
      lists.push(buildRibbonValueList(line.values, line.bandStandardDeviations, 1));
      lists.push(buildRibbonValueList(line.values, line.bandStandardDeviations, -1));
    }
  }
  return lists;
}

function buildRibbonValueList(
  values: ReadonlyArray<number>,
  stddevs: ReadonlyArray<number>,
  multiplier: 1 | -1,
): number[] {
  const list: number[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const stddev = stddevs[index] ?? 0;
    if (value === undefined || !Number.isFinite(value)) continue;
    list.push(value + multiplier * stddev);
  }
  return list;
}

interface SpectrumPlotSvgProps {
  readonly dimensions: SpectrumPlotDimensions;
  readonly xRange: SpectrumPlotXRange;
  readonly valueRange: SpectrumPlotValueRange;
  readonly bandPositions: ReadonlyArray<number>;
  readonly tickPositions: ReadonlyArray<number>;
  readonly tickLabels: ReadonlyArray<string>;
  readonly lines: ReadonlyArray<SpectrumLinePlotInput>;
}

function SpectrumPlotSvg(props: SpectrumPlotSvgProps): JSX.Element {
  const viewBox = `0 0 ${props.dimensions.width} ${props.dimensions.height}`;
  return (
    <svg
      role="img"
      aria-label="Spectra plot"
      viewBox={viewBox}
      className="h-[160px] w-full text-foreground"
    >
      <SpectrumPlotAxes
        dimensions={props.dimensions}
        valueRange={props.valueRange}
        xRange={props.xRange}
        tickPositions={props.tickPositions}
        tickLabels={props.tickLabels}
      />
      {props.lines.map((line) => (
        <SpectrumPlotLineGroup
          key={line.id}
          line={line}
          bandPositions={props.bandPositions}
          xRange={props.xRange}
          valueRange={props.valueRange}
          dimensions={props.dimensions}
        />
      ))}
    </svg>
  );
}

interface SpectrumPlotAxesProps {
  readonly dimensions: SpectrumPlotDimensions;
  readonly xRange: SpectrumPlotXRange;
  readonly valueRange: SpectrumPlotValueRange;
  readonly tickPositions: ReadonlyArray<number>;
  readonly tickLabels: ReadonlyArray<string>;
}

function SpectrumPlotAxes(props: SpectrumPlotAxesProps): JSX.Element {
  const innerLeft = props.dimensions.padding.left;
  const innerRight = props.dimensions.width - props.dimensions.padding.right;
  const innerTop = props.dimensions.padding.top;
  const innerBottom = props.dimensions.height - props.dimensions.padding.bottom;
  return (
    <g>
      <line
        x1={innerLeft}
        x2={innerRight}
        y1={innerBottom}
        y2={innerBottom}
        className="stroke-border"
        strokeWidth={1}
      />
      <line
        x1={innerLeft}
        x2={innerLeft}
        y1={innerTop}
        y2={innerBottom}
        className="stroke-border"
        strokeWidth={1}
      />
      <SpectrumPlotXTicks
        dimensions={props.dimensions}
        xRange={props.xRange}
        tickPositions={props.tickPositions}
        tickLabels={props.tickLabels}
        innerBottom={innerBottom}
      />
      <SpectrumPlotYTicks
        dimensions={props.dimensions}
        valueRange={props.valueRange}
        innerLeft={innerLeft}
      />
    </g>
  );
}

interface SpectrumPlotXTicksProps {
  readonly dimensions: SpectrumPlotDimensions;
  readonly xRange: SpectrumPlotXRange;
  readonly tickPositions: ReadonlyArray<number>;
  readonly tickLabels: ReadonlyArray<string>;
  readonly innerBottom: number;
}

function SpectrumPlotXTicks(props: SpectrumPlotXTicksProps): JSX.Element {
  return (
    <g className="text-[10px] text-muted-foreground">
      {props.tickPositions.map((tick, index) => (
        <SpectrumPlotXTick
          key={index}
          tick={tick}
          label={props.tickLabels[index] ?? ""}
          dimensions={props.dimensions}
          xRange={props.xRange}
          innerBottom={props.innerBottom}
        />
      ))}
    </g>
  );
}

interface SpectrumPlotXTickProps {
  readonly tick: number;
  readonly label: string;
  readonly dimensions: SpectrumPlotDimensions;
  readonly xRange: SpectrumPlotXRange;
  readonly innerBottom: number;
}

function SpectrumPlotXTick(props: SpectrumPlotXTickProps): JSX.Element {
  const x = projectXPositionToPixelX(props.tick, props.xRange, props.dimensions);
  return (
    <g>
      <line
        x1={x}
        x2={x}
        y1={props.innerBottom}
        y2={props.innerBottom + 3}
        className="stroke-border"
        strokeWidth={1}
      />
      <text
        x={x}
        y={props.innerBottom + 14}
        textAnchor="middle"
        fill="currentColor"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {props.label}
      </text>
    </g>
  );
}

interface SpectrumPlotYTicksProps {
  readonly dimensions: SpectrumPlotDimensions;
  readonly valueRange: SpectrumPlotValueRange;
  readonly innerLeft: number;
}

function SpectrumPlotYTicks(props: SpectrumPlotYTicksProps): JSX.Element {
  const ticks = [props.valueRange.minValue, props.valueRange.maxValue];
  return (
    <g className="text-[10px] text-muted-foreground">
      {ticks.map((tick, index) => (
        <SpectrumPlotYTick
          key={index}
          tick={tick}
          dimensions={props.dimensions}
          valueRange={props.valueRange}
          innerLeft={props.innerLeft}
        />
      ))}
    </g>
  );
}

interface SpectrumPlotYTickProps {
  readonly tick: number;
  readonly dimensions: SpectrumPlotDimensions;
  readonly valueRange: SpectrumPlotValueRange;
  readonly innerLeft: number;
}

function SpectrumPlotYTick(props: SpectrumPlotYTickProps): JSX.Element {
  const y = projectYValueToPixelY(props.tick, props.valueRange, props.dimensions);
  return (
    <g>
      <line
        x1={props.innerLeft - 3}
        x2={props.innerLeft}
        y1={y}
        y2={y}
        className="stroke-border"
        strokeWidth={1}
      />
      <text
        x={props.innerLeft - 5}
        y={y + 3}
        textAnchor="end"
        fill="currentColor"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {formatYAxisTickLabel(props.tick)}
      </text>
    </g>
  );
}

function formatYAxisTickLabel(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toPrecision(3);
  if (Number.isInteger(value)) return value.toString();
  return value.toPrecision(3);
}

interface SpectrumPlotLineGroupProps {
  readonly line: SpectrumLinePlotInput;
  readonly bandPositions: ReadonlyArray<number>;
  readonly xRange: SpectrumPlotXRange;
  readonly valueRange: SpectrumPlotValueRange;
  readonly dimensions: SpectrumPlotDimensions;
}

function SpectrumPlotLineGroup(props: SpectrumPlotLineGroupProps): JSX.Element {
  const linePath = buildSpectrumLinePathFromValues(
    props.bandPositions,
    props.line.values,
    props.xRange,
    props.valueRange,
    props.dimensions,
  );
  const ribbonPath = buildOptionalRibbonPath(props);
  return (
    <g>
      {ribbonPath && (
        <path d={ribbonPath} className={`fill-current opacity-20 ${props.line.colorClass}`} />
      )}
      <path
        d={linePath}
        fill="none"
        strokeWidth={1.5}
        className={`stroke-current ${props.line.colorClass}`}
      />
    </g>
  );
}

function buildOptionalRibbonPath(props: SpectrumPlotLineGroupProps): string | null {
  if (!props.line.bandStandardDeviations) return null;
  return buildSpectrumStandardDeviationBandPath(
    props.bandPositions,
    props.line.values,
    props.line.bandStandardDeviations,
    props.xRange,
    props.valueRange,
    props.dimensions,
  );
}

interface SpectrumPlotAxisLabelsProps {
  readonly xAxisLabel: string;
  readonly yAxisLabel: string;
}

function SpectrumPlotAxisLabels(props: SpectrumPlotAxisLabelsProps): JSX.Element {
  return (
    <figcaption className="flex items-center justify-between text-[10px] text-muted-foreground">
      <span>{props.yAxisLabel}</span>
      <span>{props.xAxisLabel}</span>
    </figcaption>
  );
}
