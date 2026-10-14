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

const envSchema = v.object({
  TABLE_NAME: v.string(),
  REVERSE_INDEX_NAME: v.string(),
  HOURLY_TTL_DAYS: v.string(),
  TOP_PATHS: v.string(),
  PROCESSING_LAG_HOURS: v.string(),
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
const config = new Config({ dynamo, tableName: env.TABLE_NAME });
const ipCache = new IpInfoCache({
  dynamo,
  tableName: env.TABLE_NAME,
  apiKey: env.IPINFO_API_KEY,
});
const athenaClient = new AthenaClient();

export async function handler(): Promise<void> {
  const lagHours = Number(env.PROCESSING_LAG_HOURS);
  const target = new Date();
  target.setUTCHours(target.getUTCHours() - lagHours);
  const targetHour = hourKey(target);

  const result = await processHour({
    hourKey: targetHour,
    models: { totals, breakdowns, markers, ipCache, config },
    athena: {
      client: athenaClient,
      database: env.ATHENA_DATABASE,
      table: env.ATHENA_V2_TABLE,
      workgroup: env.ATHENA_WORKGROUP,
      outputLocation: env.ATHENA_OUTPUT_LOCATION,
    },
    options: {
      topPaths: Number(env.TOP_PATHS),
      hourlyTtlDays: Number(env.HOURLY_TTL_DAYS),
      ipInfoApiKey: env.IPINFO_API_KEY,
    },
    dynamo,
  });

  console.log(`hourly ${targetHour} ${result.status}`);
}
