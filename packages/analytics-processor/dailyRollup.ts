import { AthenaClient } from "@aws-sdk/client-athena";
import * as v from "valibot";

import { AppliedMarkers } from "./src/appliedMarkers.ts";
import { Breakdowns } from "./src/breakdowns.ts";
import { Config } from "./src/config.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { applyDailyRollup } from "./src/processHour.ts";
import { dayKey } from "./src/time.ts";
import { Totals } from "./src/totals.ts";
import { UrlDirectory } from "./src/urls.ts";
import { WatchStats } from "./src/watch.ts";

const envSchema = v.object({
  TABLE_NAME: v.string(),
  REVERSE_INDEX_NAME: v.string(),
  ATHENA_DATABASE: v.string(),
  ATHENA_V2_TABLE: v.string(),
  ATHENA_WORKGROUP: v.string(),
  ATHENA_OUTPUT_LOCATION: v.optional(v.string()),
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
const urls = new UrlDirectory({
  dynamo,
  tableName: env.TABLE_NAME,
  reverseIndexName: env.REVERSE_INDEX_NAME,
});
const watchStats = new WatchStats({
  dynamo,
  tableName: env.TABLE_NAME,
  reverseIndexName: env.REVERSE_INDEX_NAME,
});
const athenaClient = new AthenaClient();

export async function handler(): Promise<void> {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const target = dayKey(yesterday);

  const result = await applyDailyRollup({
    dayKey: target,
    models: { totals, breakdowns, markers, urls, watchStats, config },
    athena: {
      client: athenaClient,
      database: env.ATHENA_DATABASE,
      table: env.ATHENA_V2_TABLE,
      workgroup: env.ATHENA_WORKGROUP,
      outputLocation: env.ATHENA_OUTPUT_LOCATION,
    },
    dynamo,
  });

  console.log(`dailyRollup ${target} ${result.status}`);
}
