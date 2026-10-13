import type { Grain } from "@beesolve/analytics-processor";
import { parsePeriodKey } from "@beesolve/analytics-processor";

export type View = Grain | "year";

/**
 * Human-readable label for a stored period key, converted from the UTC bucket
 * to the viewer's local timezone. An hour key `YYYY-MM-DD-HH` is shown as the
 * local clock range it spans (convention A: `-14` is the 14:00 hour, so it
 * reads "14:00 – 15:00"); a day/month/year reads as a calendar label.
 */
export function formatPeriodLabel({
  view,
  periodKey,
}: {
  readonly view: View;
  readonly periodKey: string;
}): string {
  const start = parsePeriodKey(periodKey);

  if (view === "hour") {
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
      start,
    );
    return `${day}, ${formatClock(start)} – ${formatClock(end)}`;
  }

  if (view === "day") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(start);
  }

  if (view === "month") {
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(start);
  }

  return new Intl.DateTimeFormat(undefined, { year: "numeric" }).format(start);
}

/** Compact label for dense axes (bar chart ticks). */
export function formatPeriodTick({
  view,
  periodKey,
}: {
  readonly view: View;
  readonly periodKey: string;
}): string {
  const start = parsePeriodKey(periodKey);

  if (view === "hour") return formatClock(start);
  if (view === "day")
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(start);
  if (view === "month") return new Intl.DateTimeFormat(undefined, { month: "short" }).format(start);
  return new Intl.DateTimeFormat(undefined, { year: "numeric" }).format(start);
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}
