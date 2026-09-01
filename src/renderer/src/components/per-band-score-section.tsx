import { SpectrumPlot } from "@/components/spectrum-plot";
import {
  buildPerBandScorePlotInput,
  selectTopScoringBandRows,
  type PerBandScoreFormatter,
  type PerBandScoreRow,
} from "@/lib/analysis/per-band-score-presentation";
import type { RasterImage } from "@/lib/image/raster-image";
import type { SpectrumPlotValueRange } from "@/lib/image/spectrum-plot-geometry";

// CT-319: the shared presentation for an analysis that scores every band on its
// own. NPC uses it, and CT-320's CNR uses it with its own name, formatter and y
// range, so the two asides read the same way.

export interface PerBandScoreSectionProps {
  readonly scoreName: string;
  readonly raster: RasterImage | null;
  readonly scores: ReadonlyArray<number> | null;
  readonly formatScore: PerBandScoreFormatter;
  readonly notComputedText: string;
  readonly fixedValueRange?: SpectrumPlotValueRange;
}

export function PerBandScoreSection(props: PerBandScoreSectionProps): JSX.Element {
  return (
    <section aria-label={`${props.scoreName} scores`} className="flex flex-col gap-3">
      <PerBandScoreSectionContent {...props} />
    </section>
  );
}

function PerBandScoreSectionContent(props: PerBandScoreSectionProps): JSX.Element {
  const { raster, scores } = props;
  if (raster === null || scores === null) {
    return <p className="text-xs text-muted-foreground">{props.notComputedText}</p>;
  }
  return (
    <>
      <PerBandScorePlot {...props} raster={raster} scores={scores} />
      <TopScoringBandsList
        scoreName={props.scoreName}
        formatScore={props.formatScore}
        rows={selectTopScoringBandRows(raster, scores)}
      />
    </>
  );
}

interface PerBandScorePlotProps extends PerBandScoreSectionProps {
  readonly raster: RasterImage;
  readonly scores: ReadonlyArray<number>;
}

function PerBandScorePlot(props: PerBandScorePlotProps): JSX.Element {
  const plot = buildPerBandScorePlotInput(props.raster, props.scores, props.scoreName);
  return (
    <SpectrumPlot
      bandPositions={plot.bandPositions}
      bandRuns={plot.bandRuns}
      tickPositions={plot.tickPositions}
      tickLabels={plot.tickLabels}
      xAxisLabel={plot.xAxisLabel}
      yAxisLabel={props.scoreName}
      lines={plot.lines}
      ariaLabel={`${props.scoreName} per band plot`}
      fixedValueRange={props.fixedValueRange}
      hoverLabelOverrides={{
        bandLabels: plot.hoverBandLabels,
        formatValue: props.formatScore,
      }}
    />
  );
}

interface TopScoringBandsListProps {
  readonly scoreName: string;
  readonly formatScore: PerBandScoreFormatter;
  readonly rows: ReadonlyArray<PerBandScoreRow>;
}

function TopScoringBandsList(props: TopScoringBandsListProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{TOP_BANDS_HEADING}</span>
      <ul className="flex flex-col gap-1">
        {props.rows.map((row, rowIndex) => (
          <TopScoringBandRow key={row.bandIndex} {...props} row={row} rowNumber={rowIndex + 1} />
        ))}
      </ul>
    </div>
  );
}

const TOP_BANDS_HEADING = "Top bands";

interface TopScoringBandRowProps extends TopScoringBandsListProps {
  readonly row: PerBandScoreRow;
  readonly rowNumber: number;
}

function TopScoringBandRow(props: TopScoringBandRowProps): JSX.Element {
  return (
    <li>
      <output
        aria-label={`${props.scoreName} top band ${props.rowNumber}`}
        className="flex items-baseline justify-between gap-2 text-xs"
      >
        <span className="truncate text-foreground">{props.row.bandIdentityText}</span>
        <span className="font-mono text-foreground">{props.formatScore(props.row.score)}</span>
      </output>
    </li>
  );
}
