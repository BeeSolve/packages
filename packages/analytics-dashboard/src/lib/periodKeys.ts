import type { Dimension, Grain, Tier } from "@beesolve/analytics-processor";

/**
 * Client-safe mirror of the pure period-key constants and date helpers from
 * `@beesolve/analytics-processor`.
 *
 * Importing those runtime values from the package root drags its AWS SDK
 * dependencies (Athena, DynamoDB) into the browser bundle, where Vite
 * externalizes `node:crypto`; the first access to `node:crypto.createHash`
 * then throws during hydration and the page renders a 500. These values are
 * small, pure, and stable, so the client imports them from here instead. Server
 * code (`*.remote.ts`, `hooks.server.ts`) keeps importing from the processor.
 *
 * Type imports above are erased at build time and do not pull in runtime code.
 */

export const grains = ["hour", "day", "month"] as const satisfies ReadonlyArray<Grain>;

export const dimensions = [
  "status",
  "country",
  "device",
] as const satisfies ReadonlyArray<Dimension>;

export const tiers = ["all", "real", "watch"] as const satisfies ReadonlyArray<Tier>;

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function pad4(value: number): string {
  return value.toString().padStart(4, "0");
}

function monthKey(date: Date): string {
  return `${pad4(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}`;
}

function dayKey(date: Date): string {
  return `${monthKey(date)}-${pad2(date.getUTCDate())}`;
}

export function hourKey(date: Date): string {
  return `${dayKey(date)}-${pad2(date.getUTCHours())}`;
}

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
