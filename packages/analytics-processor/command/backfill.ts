import { AthenaClient } from "@aws-sdk/client-athena";
import { IpInfoCache } from "@beesolve/ip-info";

import { AppliedMarkers } from "../src/appliedMarkers.ts";
import { Breakdowns } from "../src/breakdowns.ts";
import { Config } from "../src/config.ts";
import { toDynamoClient } from "../src/dynamo.ts";
import type { ProcessHourResult } from "../src/processHour.ts";
import { applyDailyRollup, applyMonthlyRollup, processHour } from "../src/processHour.ts";
import { dayKey, hoursBetween, monthKey } from "../src/time.ts";
import { Totals } from "../src/totals.ts";
import { extractStackFlag, resolveEnv } from "./resolveStack.ts";

export interface BackfillArgs {
  readonly from: Date;
  readonly to: Date;
  readonly concurrency: number;
  readonly rollups: boolean;
}

export interface BackfillConfig {
  readonly tableName: string;
  readonly reverseIndexName?: string;
  readonly athenaDatabase: string;
  readonly athenaTable: string;
  readonly athenaWorkgroup: string;
  readonly athenaOutputLocation?: string;
  readonly ipInfoApiKey?: string;
  readonly topPaths: number;
  readonly hourlyTtlDays: number;
}

export interface BackfillCounts {
  readonly processed: number;
  readonly skipped: number;
  readonly failed: number;
}

const defaultConcurrency = 2;
const defaultTopPaths = 100;
const defaultHourlyTtlDays = 90;

export function parseBackfillArgs(argv: Array<string>): BackfillArgs {
  let from: string | undefined;
  let to: string | undefined;
  let concurrency = defaultConcurrency;
  let rollups = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--from") {
      from = argv[index + 1];
      index += 1;
    } else if (token === "--to") {
      to = argv[index + 1];
      index += 1;
    } else if (token === "--concurrency") {
      concurrency = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--rollups") {
      rollups = true;
    }
  }

  if (from == null || to == null) {
    throw new Error(
      "backfill requires --from <ISO> and --to <ISO>, e.g. bun run backfill -- --from 2026-01-01T00:00:00Z --to 2026-01-31T23:00:00Z",
    );
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new Error(`backfill --from/--to must be valid ISO timestamps, got from=${from} to=${to}`);
  }
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error("backfill --from must not be after --to");
  }
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(`backfill --concurrency must be a positive number, got ${String(concurrency)}`);
  }

  return { from: fromDate, to: toDate, concurrency: Math.floor(concurrency), rollups };
}

export async function runPool<Input, Output>({
  items,
  concurrency,
  worker,
}: {
  items: Array<Input>;
  concurrency: number;
  worker: (item: Input, index: number) => Promise<Output>;
}): Promise<Array<Output>> {
  const results: Array<Output> = Array.from({ length: items.length });
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

export function configFromEnv(env: Record<string, string | undefined>): BackfillConfig {
  const tableName = env.TABLE_NAME;
  const athenaDatabase = env.ATHENA_DATABASE;
  const athenaTable = env.ATHENA_TABLE;
  const athenaWorkgroup = env.ATHENA_WORKGROUP;

  if (tableName == null) throw new Error("backfill requires TABLE_NAME");
  if (athenaDatabase == null) throw new Error("backfill requires ATHENA_DATABASE");
  if (athenaTable == null) throw new Error("backfill requires ATHENA_TABLE");
  if (athenaWorkgroup == null) throw new Error("backfill requires ATHENA_WORKGROUP");

  return {
    tableName,
    reverseIndexName: env.REVERSE_INDEX_NAME,
    athenaDatabase,
    athenaTable,
    athenaWorkgroup,
    athenaOutputLocation: env.ATHENA_OUTPUT_LOCATION,
    ipInfoApiKey: env.IPINFO_API_KEY,
    topPaths: env.TOP_PATHS == null ? defaultTopPaths : Number(env.TOP_PATHS),
    hourlyTtlDays: env.HOURLY_TTL_DAYS == null ? defaultHourlyTtlDays : Number(env.HOURLY_TTL_DAYS),
  };
}

export async function runBackfill({
  args,
  config,
}: {
  args: BackfillArgs;
  config: BackfillConfig;
}): Promise<BackfillCounts> {
  const dynamo = toDynamoClient();
  const athenaClient = new AthenaClient();

  const totals = new Totals({ dynamo, tableName: config.tableName });
  const breakdowns = new Breakdowns({ dynamo, tableName: config.tableName });
  const markers = new AppliedMarkers({ dynamo, tableName: config.tableName });
  const configModel = new Config({ dynamo, tableName: config.tableName });
  const ipCache = new IpInfoCache({
    dynamo,
    tableName: config.tableName,
    apiKey: config.ipInfoApiKey,
  });

  const hourKeys = hoursBetween({ from: args.from, to: args.to });
  console.log(`backfill: ${hourKeys.length} hours, concurrency ${args.concurrency}`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  await runPool({
    items: hourKeys,
    concurrency: args.concurrency,
    worker: async (targetHour) => {
      try {
        const result = await processHour({
          hourKey: targetHour,
          models: { totals, breakdowns, markers, ipCache, config: configModel },
          athena: {
            client: athenaClient,
            database: config.athenaDatabase,
            table: config.athenaTable,
            workgroup: config.athenaWorkgroup,
            outputLocation: config.athenaOutputLocation,
          },
          options: {
            topPaths: config.topPaths,
            hourlyTtlDays: config.hourlyTtlDays,
            ipInfoApiKey: config.ipInfoApiKey,
          },
          dynamo,
        });

        if (result.status === "applied") {
          processed += 1;
        } else {
          skipped += 1;
        }
        console.log(`backfill hour ${targetHour} ${result.status}`);
      } catch (error) {
        failed += 1;
        console.error(`backfill hour ${targetHour} failed`, error);
      }
    },
  });

  console.log(`backfill hours done: processed=${processed} skipped=${skipped} failed=${failed}`);

  if (args.rollups) {
    await runRollups({ args, totals, breakdowns, markers, dynamo });
  }

  return { processed, skipped, failed };
}

async function runRollups({
  args,
  totals,
  breakdowns,
  markers,
  dynamo,
}: {
  args: BackfillArgs;
  totals: Totals;
  breakdowns: Breakdowns;
  markers: AppliedMarkers;
  dynamo: ReturnType<typeof toDynamoClient>;
}): Promise<void> {
  const days = distinctKeys({ from: args.from, to: args.to, keyFor: dayKey });
  const months = distinctKeys({ from: args.from, to: args.to, keyFor: monthKey });

  const logRollup = (label: string, key: string, result: ProcessHourResult): void => {
    console.log(`backfill ${label} ${key} ${result.status}`);
  };

  for (const day of days) {
    const result = await applyDailyRollup({
      dayKey: day,
      models: { totals, breakdowns, markers },
      dynamo,
    });
    logRollup("daily", day, result);
  }

  for (const month of months) {
    const result = await applyMonthlyRollup({
      monthKey: month,
      models: { totals, breakdowns, markers },
      dynamo,
    });
    logRollup("monthly", month, result);
  }
}

function distinctKeys({
  from,
  to,
  keyFor,
}: {
  from: Date;
  to: Date;
  keyFor: (date: Date) => string;
}): Array<string> {
  const seen = new Set<string>();
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), from.getUTCHours()),
  );
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), to.getUTCHours());
  while (cursor.getTime() <= end) {
    seen.add(keyFor(cursor));
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return Array.from(seen);
}

export async function main(): Promise<void> {
  const { stackName, rest } = extractStackFlag(process.argv.slice(2));
  const args = parseBackfillArgs(rest);
  const env = await resolveEnv({ stackName });
  const config = configFromEnv(env);
  await runBackfill({ args, config });
}

if (import.meta.main) {
  await main();
}
