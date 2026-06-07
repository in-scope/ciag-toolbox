import { cn } from "@/lib/utils";

interface BandIndexBadgeProps {
  originalNumber: number;
  className?: string;
}

export function BandIndexBadge(props: BandIndexBadgeProps): JSX.Element {
  return (
    <span
      title={`Original band ${props.originalNumber}`}
      className={cn(BAND_INDEX_BADGE_CLASSES, props.className)}
    >
      #{props.originalNumber}
    </span>
  );
}

const BAND_INDEX_BADGE_CLASSES =
  "shrink-0 rounded-sm bg-muted px-1 py-0.5 font-mono text-[11px] leading-none tabular-nums text-muted-foreground";
