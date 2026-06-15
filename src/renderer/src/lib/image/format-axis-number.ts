const SUPERSCRIPT_BY_CHARACTER: Readonly<Record<string, string>> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
};

const EXPONENTIAL_NUMBER_PATTERN = /^(-?\d+(?:\.\d+)?)e([+-]?\d+)$/i;

export function formatNumberStringWithSuperscriptExponent(formatted: string): string {
  const match = EXPONENTIAL_NUMBER_PATTERN.exec(formatted);
  if (!match) return formatted;
  return buildSuperscriptMagnitudeText(match[1] as string, Number(match[2]));
}

function buildSuperscriptMagnitudeText(mantissa: string, exponent: number): string {
  return `${mantissa}×10${convertExponentToSuperscriptDigits(exponent)}`;
}

function convertExponentToSuperscriptDigits(exponent: number): string {
  return exponent
    .toString()
    .split("")
    .map((character) => SUPERSCRIPT_BY_CHARACTER[character] ?? character)
    .join("");
}

export function formatHistogramPixelCountForAxis(count: number): string {
  if (!Number.isFinite(count)) return "-";
  if (count <= 0) return "0";
  return formatNumberStringWithSuperscriptExponent(formatPixelCountMagnitude(count));
}

function formatPixelCountMagnitude(count: number): string {
  if (count >= COMPACT_COUNT_THRESHOLD) return count.toExponential(1);
  return Math.round(count).toString();
}

const COMPACT_COUNT_THRESHOLD = 10000;
