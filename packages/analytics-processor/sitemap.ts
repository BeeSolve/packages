import { AthenaClient } from "@aws-sdk/client-athena";
import * as v from "valibot";

import { AppliedMarkers } from "./src/appliedMarkers.ts";
import { Config } from "./src/config.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { fetchSitemapPaths, processSitemapHour, SitemapUrlStats } from "./src/sitemap.ts";
import { hourKey } from "./src/time.ts";

const envSchema = v.object({
  TABLE_NAME: v.string(),
  REVERSE_INDEX_NAME: v.string(),
  HOURLY_TTL_DAYS: v.string(),
  PROCESSING_LAG_HOURS: v.string(),
  ATHENA_DATABASE: v.string(),
  ATHENA_V2_TABLE: v.string(),
  ATHENA_WORKGROUP: v.string(),
  ATHENA_OUTPUT_LOCATION: v.optional(v.string()),
});

const env = v.parse(envSchema, process.env);

const dynamo = toDynamoClient();
const config = new Config({ dynamo, tableName: env.TABLE_NAME });
const sitemapUrlStats = new SitemapUrlStats({
  dynamo,
  tableName: env.TABLE_NAME,
  reverseIndexName: env.REVERSE_INDEX_NAME,
});
const markers = new AppliedMarkers({ dynamo, tableName: env.TABLE_NAME });
const athenaClient = new AthenaClient();

export async function handler(): Promise<void> {
  const { sitemapUrl } = await config.getSitemapConfig();
  if (sitemapUrl == null) {
    console.log("sitemap: no sitemapUrl configured, skipping");
    return;
  }

  const paths = await fetchSitemapPaths(sitemapUrl);
  if (paths.length === 0) {
    console.log("sitemap: empty path set, skipping");
    return;
  }

  const lagHours = Number(env.PROCESSING_LAG_HOURS);
  const target = new Date();
  target.setUTCHours(target.getUTCHours() - lagHours);
  const targetHour = hourKey(target);

  const result = await processSitemapHour({
    hourKey: targetHour,
    source: "v2",
    paths,
    models: { sitemapUrlStats, markers },
    athena: {
      client: athenaClient,
      database: env.ATHENA_DATABASE,
      table: env.ATHENA_V2_TABLE,
      workgroup: env.ATHENA_WORKGROUP,
      outputLocation: env.ATHENA_OUTPUT_LOCATION,
    },
    options: { markerTtlDays: Number(env.HOURLY_TTL_DAYS) },
    dynamo,
  });

  console.log(`sitemap ${targetHour} ${result.status} urls=${result.urls}`);
}
