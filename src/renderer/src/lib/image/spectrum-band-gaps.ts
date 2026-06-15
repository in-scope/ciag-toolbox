export interface BandRun {
  readonly startIndex: number;
  readonly endIndexExclusive: number;
}

export function listContiguousBandRuns(
  bandOriginalNumbers: ReadonlyArray<number>,
): ReadonlyArray<BandRun> {
  const runs: BandRun[] = [];
  let runStartIndex = 0;
  for (let index = 1; index < bandOriginalNumbers.length; index += 1) {
    if (isContiguousWithPreviousBand(bandOriginalNumbers, index)) continue;
    runs.push({ startIndex: runStartIndex, endIndexExclusive: index });
    runStartIndex = index;
  }
  appendFinalBandRunWhenNonEmpty(runs, runStartIndex, bandOriginalNumbers.length);
  return runs;
}

function isContiguousWithPreviousBand(
  bandOriginalNumbers: ReadonlyArray<number>,
  index: number,
): boolean {
  const previous = bandOriginalNumbers[index - 1];
  const current = bandOriginalNumbers[index];
  if (previous === undefined || current === undefined) return false;
  return current - previous === 1;
}

function appendFinalBandRunWhenNonEmpty(
  runs: BandRun[],
  runStartIndex: number,
  length: number,
): void {
  if (length === 0) return;
  runs.push({ startIndex: runStartIndex, endIndexExclusive: length });
}
