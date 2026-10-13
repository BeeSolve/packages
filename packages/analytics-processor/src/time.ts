import type { Grain } from "./keys.ts";

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function pad4(value: number): string {
  return value.toString().padStart(4, "0");
}

export function yearKey(date: Date): string {
  return pad4(date.getUTCFullYear());
}

export function monthKey(date: Date): string {
  return `${pad4(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}`;
}

export function dayKey(date: Date): string {
  return `${monthKey(date)}-${pad2(date.getUTCDate())}`;
}

export function hourKey(date: Date): string {
  return `${dayKey(date)}-${pad2(date.getUTCHours())}`;
}

/**
 * Parses a period key (any grain) back to the UTC Date at the start of that
 * bucket. `YYYY` → Jan 1 00:00, `YYYY-MM` → 1st 00:00, `YYYY-MM-DD` → 00:00,
 * `YYYY-MM-DD-HH` → that hour. Throws on a malformed key.
 */
export function parsePeriodKey(periodKey: string): Date {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(periodKey);
  if (match == null) {
    throw new Error(`Invalid period key: ${periodKey}`);
  }
  const [, year, month, day, hour] = match;
  return new Date(
    Date.UTC(
      Number(year),
      month == null ? 0 : Number(month) - 1,
      day == null ? 1 : Number(day),
      hour == null ? 0 : Number(hour),
    ),
  );
}

export function grainForPeriodKey(periodKey: string): Grain | "year" {
  const segments = periodKey.split("-").length;
  if (segments === 1) return "year";
  if (segments === 2) return "month";
  if (segments === 3) return "day";
  return "hour";
}

export function maxWindowFor(grain: Grain): number {
  if (grain === "hour") return 24;
  if (grain === "day") return 30;
  return 12;
}

function keyFor(grain: Grain, date: Date): string {
  if (grain === "hour") return hourKey(date);
  if (grain === "day") return dayKey(date);
  return monthKey(date);
}

export function shiftAnchor({
  grain,
  anchor,
  size,
  direction,
}: {
  grain: Grain;
  anchor: Date;
  size: number;
  direction: "next" | "prev";
}): Date {
  const delta = direction === "next" ? size : -size;
  const shifted = new Date(anchor.getTime());
  if (grain === "hour") {
    shifted.setUTCHours(shifted.getUTCHours() + delta);
  } else if (grain === "day") {
    shifted.setUTCDate(shifted.getUTCDate() + delta);
  } else {
    shifted.setUTCMonth(shifted.getUTCMonth() + delta);
  }
  return shifted;
}

export function windowKeys({ grain, anchor, size }: { grain: Grain; anchor: Date; size: number }): {
  startKey: string;
  endKey: string;
} {
  const endKey = keyFor(grain, anchor);
  const start = shiftAnchor({ grain, anchor, size: size - 1, direction: "prev" });
  const startKey = keyFor(grain, start);
  return { startKey, endKey };
}

export function hoursBetween({ from, to }: { from: Date; to: Date }): Array<string> {
  const keys: Array<string> = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), from.getUTCHours()),
  );
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), to.getUTCHours());
  while (cursor.getTime() <= end) {
    keys.push(hourKey(cursor));
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return keys;
}
