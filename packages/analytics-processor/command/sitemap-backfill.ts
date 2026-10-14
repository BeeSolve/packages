import { AthenaClient } from "@aws-sdk/client-athena";

import { Config } from "../src/config.ts";
import { toDynamoClient } from "../src/dynamo.ts";
import type { AppliedSource } from "../src/keys.ts";
import { appliedSources } from "../src/keys.ts";
import { fetchSitemapPaths, processSitemapMonth, SitemapUrlStats } from "../src/sitemap.ts";
import { runPool } from "./backfill.ts";

export interface SitemapBackfillArgs {
  readonly from: string;
  readonly to: string;
  readonly source: AppliedSource;
  readonly concurrency: number;
  readonly sitemapUrl?: string;
}

export interface SitemapBackfillConfig {
  readonly tableName: string;
  readonly reverseIndexName?: string;
  readonly athenaDatabase: string;
  readonly athenaTable: string;
  readonly athenaWorkgroup: string;
  readonly athenaOutputLocation?: string;
}

const defaultConcurrency = 2;
const monthPattern = /^\d{4}-\d{2}$/;

function isAppliedSource(value: string): value is AppliedSource {
  return (appliedSources as ReadonlyArray<string>).includes(value);
}

export function parseSitemapBackfillArgs(argv: Array<string>): SitemapBackfillArgs {
  let from: string | undefined;
  let to: string | undefined;
  let source = "v2";
  let concurrency = defaultConcurrency;
  let sitemapUrl: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--from") {
      from = argv[index + 1];
      index += 1;
    } else if (token === "--to") {
      to = argv[index + 1];
      index += 1;
    } else if (token === "--source") {
      source = argv[index + 1] ?? "";
      index += 1;
    } else if (token === "--concurrency") {
      concurrency = Number(argv[index + 1]);
      index += 1;
    } else if (token === "--sitemap-url") {
      sitemapUrl = argv[index + 1];
      index += 1;
    }
  }

  if (from == null || to == null) {
    throw new Error(
      "sitemap-backfill requires --from <YYYY-MM> and --to <YYYY-MM>, e.g. bun run sitemap-backfill -- --from 2025-06 --to 2026-05",
    );
  }

  if (!monthPattern.test(from) || !monthPattern.test(to)) {
    throw new Error(`sitemap-backfill --from/--to must be YYYY-MM, got from=${from} to=${to}`);
  }

  if (from > to) {
    throw new Error("sitemap-backfill --from must not be after --to");
  }

  if (!isAppliedSource(source)) {
    throw new Error(`sitemap-backfill --source must be v1 or v2, got ${source}`);
  }

  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(
      `sitemap-backfill --concurrency must be a positive number, got ${String(concurrency)}`,
    );
  }

  return { from, to, source, concurrency: Math.floor(concurrency), sitemapUrl };
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

export function configFromEnv({
  env,
  source,
}: {
  env: Record<string, string | undefined>;
  source: AppliedSource;
}): SitemapBackfillConfig {
  const tableName = env.TABLE_NAME;
  const athenaDatabase = env.ATHENA_DATABASE;
  const athenaWorkgroup = env.ATHENA_WORKGROUP;
  const athenaTable = source === "v2" ? env.ATHENA_V2_TABLE : env.ATHENA_V1_TABLE;

  if (tableName == null) throw new Error("sitemap-backfill requires TABLE_NAME");
  if (athenaDatabase == null) throw new Error("sitemap-backfill requires ATHENA_DATABASE");
  if (athenaWorkgroup == null) throw new Error("sitemap-backfill requires ATHENA_WORKGROUP");
  if (athenaTable == null) {
    throw new Error(
      source === "v2"
        ? "sitemap-backfill requires ATHENA_V2_TABLE"
        : "sitemap-backfill requires ATHENA_V1_TABLE",
    );
  }

  return {
    tableName,
    reverseIndexName: env.REVERSE_INDEX_NAME,
    athenaDatabase,
    athenaTable,
    athenaWorkgroup,
    athenaOutputLocation: env.ATHENA_OUTPUT_LOCATION,
  };
}

export async function runSitemapBackfill({
  args,
  config,
}: {
  args: SitemapBackfillArgs;
  config: SitemapBackfillConfig;
}): Promise<void> {
  const dynamo = toDynamoClient();
  const athenaClient = new AthenaClient();

  const configModel = new Config({ dynamo, tableName: config.tableName });
  const sitemapUrlStats = new SitemapUrlStats({
    dynamo,
    tableName: config.tableName,
    reverseIndexName: config.reverseIndexName,
  });

  const sitemapUrl = args.sitemapUrl ?? (await configModel.getSitemapConfig()).sitemapUrl;
  if (sitemapUrl == null) {
    throw new Error(
      "sitemap-backfill requires a sitemap URL: pass --sitemap-url or set config.sitemapUrl",
    );
  }

  const paths = await fetchSitemapPaths(sitemapUrl);

  const months = monthsBetween({ from: args.from, to: args.to });
  console.log(
    `sitemap-backfill: ${months.length} months, source ${args.source}, concurrency ${args.concurrency}`,
  );

  await runPool({
    items: months,
    concurrency: args.concurrency,
    worker: async (month) => {
      const result = await processSitemapMonth({
        monthKey: month,
        source: args.source,
        paths,
        models: { sitemapUrlStats },
        athena: {
          client: athenaClient,
          database: config.athenaDatabase,
          table: config.athenaTable,
          workgroup: config.athenaWorkgroup,
          outputLocation: config.athenaOutputLocation,
        },
      });
      console.log(`sitemap-backfill ${month} urls=${result.urls}`);
    },
  });
}

export async function main(): Promise<void> {
  const args = parseSitemapBackfillArgs(process.argv.slice(2));
  const config = configFromEnv({ env: process.env, source: args.source });
  await runSitemapBackfill({ args, config });
}

if (import.meta.main) {
  await main();
}
