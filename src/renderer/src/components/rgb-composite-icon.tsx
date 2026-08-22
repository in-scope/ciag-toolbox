import type { SVGProps } from "react";

// CT-292: RGB Color Composite has no stock Lucide glyph, so this custom icon
// follows Lucide's own conventions (24x24 viewBox, currentColor stroke,
// stroke-width 2, round caps/joins, no fill) rather than reusing a shared icon.
export function RgbCompositeIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="8" r="7" />
      <circle cx="8" cy="15" r="7" />
      <circle cx="16" cy="15" r="7" />
    </svg>
  );
}
