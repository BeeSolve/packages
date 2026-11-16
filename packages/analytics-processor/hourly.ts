import { AthenaClient } from "@aws-sdk/client-athena";
import { IpInfoCache } from "@beesolve/ip-info";
import * as v from "valibot";

import { AppliedMarkers } from "./src/appliedMarkers.ts";
import { Breakdowns } from "./src/breakdowns.ts";
import { Config } from "./src/config.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { processHour } from "./src/processHour.ts";
import { hourKey } from "./src/time.ts";
import { Totals } from "./src/totals.ts";
import { processWatchHourBatch, WatchStats } from "./src/watch.ts";

const envSchema = v.object({
  TABLE_NAME: v.string(),
  REVERSE_INDEX_NAME: v.string(),
  HOURLY_TTL_DAYS: v.string(),
  TOP_PATHS: v.string(),
  PROCESSING_LAG_HOURS: v.string(),
  HOURLY_INTERVAL_HOURS: v.optional(v.string(), "1"),
  ATHENA_DATABASE: v.string(),
  ATHENA_V2_TABLE: v.string(),
  ATHENA_WORKGROUP: v.string(),
  ATHENA_OUTPUT_LOCATION: v.optional(v.string()),
  IPINFO_API_KEY: v.optional(v.string()),
});

const env = v.parse(envSchema, process.env);

const dynamo = toDynamoClient();
const totals = new Totals({ dynamo, tableName: env.TABLE_NAME });
const breakdowns = new Breakdowns({ dynamo, tableName: env.TABLE_NAME });
const markers = new AppliedMarkers({ dynamo, tableName: env.TABLE_NAME });
const config = new Config({
  dynamo,
  tableName: env.TABLE_NAME,
  reverseIndexName: env.REVERSE_INDEX_NAME,
});
const watchStats = new WatchStats({
  dynamo,
  tableName: env.TABLE_NAME,
  reverseIndexName: env.REVERSE_INDEX_NAME,
});
const ipCache = new IpInfoCache({
  dynamo,
  tableName: env.TABLE_NAME,
  apiKey: env.IPINFO_API_KEY,
});
const athenaClient = new AthenaClient();

export async function handler(): Promise<void> {
  const lagHours = Number(env.PROCESSING_LAG_HOURS);
  const intervalHours = Number(env.HOURLY_INTERVAL_HOURS);

  const athena = {
    client: athenaClient,
    database: env.ATHENA_DATABASE,
    table: env.ATHENA_V2_TABLE,
    workgroup: env.ATHENA_WORKGROUP,
    outputLocation: env.ATHENA_OUTPUT_LOCATION,
  };

  // Each run covers the `intervalHours` hours ending at now - lag, oldest first.
  // Applied-markers make already-processed hours a cheap skip, so overlapping or
  // retried runs never double count.
  for (let hoursBack = intervalHours - 1; hoursBack >= 0; hoursBack -= 1) {
    const target = new Date();
    target.setUTCHours(target.getUTCHours() - lagHours - hoursBack);
    const targetHour = hourKey(target);

    const result = await processHour({
      hourKey: targetHour,
      models: { totals, breakdowns, markers, ipCache, config },
      athena,
      options: {
        topPaths: Number(env.TOP_PATHS),
        hourlyTtlDays: Number(env.HOURLY_TTL_DAYS),
        ipInfoApiKey: env.IPINFO_API_KEY,
        tiers: ["all", "real", "watch"],
      },
      dynamo,
    });

    console.log(`hourly ${targetHour} ${result.status}`);

    await processWatchEntries({ targetHour, athena });
  }
}

async function processWatchEntries({
  targetHour,
  athena,
}: {
  readonly targetHour: string;
  readonly athena: {
    readonly client: AthenaClient;
    readonly database: string;
    readonly table: string;
    readonly workgroup: string;
    readonly outputLocation?: string;
  };
}): Promise<void> {
  const entries = await config.listWatch();
  const active = entries.filter((entry) => entry.status === "active");

  if (active.length === 0) return;

  try {
    const results = await processWatchHourBatch({
      hourKey: targetHour,
      entries: active.map((entry) => ({ matcher: entry.matcher, mode: entry.mode })),
      models: { watchStats, markers },
      athena,
      dynamo,
    });
    for (const result of results) {
      if (result.status === "failed") {
        console.error(`watch ${result.matcher} ${targetHour} failed`, result.error);
        continue;
      }
      console.log(
        `watch ${result.matcher} ${targetHour} ${result.status} buckets=${result.buckets}`,
      );
    }
  } catch (error) {
    console.error(`watch batch ${targetHour} failed`, error);
  }
}
