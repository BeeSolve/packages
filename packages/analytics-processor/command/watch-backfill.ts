import { AthenaClient } from "@aws-sdk/client-athena";

import { Config } from "../src/config.ts";
import { toDynamoClient } from "../src/dynamo.ts";
import { processWatchMonth, WatchStats } from "../src/watch.ts";
import { runPool } from "./backfill.ts";

export interface WatchBackfillArgs {
  readonly from: string;
  readonly to: string;
  readonly concurrency: number;
}

export interface WatchBackfillConfig {
  readonly tableName: string;
  readonly reverseIndexName?: string;
  readonly athenaDatabase: string;
  readonly athenaTable: string;
  readonly athenaWorkgroup: string;
  readonly athenaOutputLocation?: string;
}

const defaultConcurrency = 2;
const monthPattern = /^\d{4}-\d{2}$/;

export function parseWatchBackfillArgs(argv: Array<string>): WatchBackfillArgs {
  let from: string | undefined;
  let to: string | undefined;
  let concurrency = defaultConcurrency;

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
    }
  }

  if (from == null || to == null) {
    throw new Error(
      "watch-backfill requires --from <YYYY-MM> and --to <YYYY-MM>, e.g. bun run watch-backfill -- --from 2025-06 --to 2026-05",
    );
  }

  if (!monthPattern.test(from) || !monthPattern.test(to)) {
    throw new Error(`watch-backfill --from/--to must be YYYY-MM, got from=${from} to=${to}`);
  }

  if (from > to) {
    throw new Error("watch-backfill --from must not be after --to");
  }

  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(
      `watch-backfill --concurrency must be a positive number, got ${String(concurrency)}`,
    );
  }

  return { from, to, concurrency: Math.floor(concurrency) };
}

export function monthsBetween({ from, to }: { from: string; to: string }): Array<string> {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  if (fromYear == null || fromMonth == null || toYear == null || toMonth == null) {
    throw new Error(`monthsBetween requires YYYY-MM keys, got from=${from} to=${to}`);
  }

  const months: Array<string> = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export function configFromEnv(env: Record<string, string | undefined>): WatchBackfillConfig {
  const tableName = env.TABLE_NAME;
  const athenaDatabase = env.ATHENA_DATABASE;
  const athenaWorkgroup = env.ATHENA_WORKGROUP;
  const athenaTable = env.ATHENA_TABLE;
  const reverseIndexName = env.REVERSE_INDEX_NAME;

  if (tableName == null) throw new Error("watch-backfill requires TABLE_NAME");
  if (athenaDatabase == null) throw new Error("watch-backfill requires ATHENA_DATABASE");
  if (athenaWorkgroup == null) throw new Error("watch-backfill requires ATHENA_WORKGROUP");
  if (athenaTable == null) throw new Error("watch-backfill requires ATHENA_TABLE");
  if (reverseIndexName == null) throw new Error("watch-backfill requires REVERSE_INDEX_NAME");

  return {
    tableName,
    reverseIndexName,
    athenaDatabase,
    athenaTable,
    athenaWorkgroup,
    athenaOutputLocation: env.ATHENA_OUTPUT_LOCATION,
  };
}

export async function runWatchBackfill({
  args,
  config,
}: {
  args: WatchBackfillArgs;
  config: WatchBackfillConfig;
}): Promise<void> {
  const dynamo = toDynamoClient();
  const athenaClient = new AthenaClient();

  const configModel = new Config({
    dynamo,
    tableName: config.tableName,
    reverseIndexName: config.reverseIndexName,
  });
  const watchStats = new WatchStats({
    dynamo,
    tableName: config.tableName,
    reverseIndexName: config.reverseIndexName,
  });

  const entries = (await configModel.listWatch()).filter((entry) => entry.status === "active");
  if (entries.length === 0) {
    console.log("watch-backfill: no active watch entries, nothing to do");
    return;
  }

  const months = monthsBetween({ from: args.from, to: args.to });
  const jobs = entries.flatMap((entry) => months.map((month) => ({ entry, month })));
  console.log(
    `watch-backfill: ${entries.length} entries x ${months.length} months, concurrency ${args.concurrency}`,
  );

  await runPool({
    items: jobs,
    concurrency: args.concurrency,
    worker: async (job) => {
      const result = await processWatchMonth({
        monthKey: job.month,
        entry: { matcher: job.entry.matcher, mode: job.entry.mode },
        models: { watchStats },
        athena: {
          client: athenaClient,
          database: config.athenaDatabase,
          table: config.athenaTable,
          workgroup: config.athenaWorkgroup,
          outputLocation: config.athenaOutputLocation,
        },
      });
      console.log(`watch-backfill ${job.entry.matcher} ${job.month} buckets=${result.buckets}`);
    },
  });
}

export async function main(): Promise<void> {
  const args = parseWatchBackfillArgs(process.argv.slice(2));
  const config = configFromEnv(process.env);
  await runWatchBackfill({ args, config });
}

if (import.meta.main) {
  await main();
}
