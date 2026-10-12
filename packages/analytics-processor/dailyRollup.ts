import * as v from "valibot";

import { AppliedMarkers } from "./src/appliedMarkers.ts";
import { Breakdowns } from "./src/breakdowns.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { applyDailyRollup } from "./src/processHour.ts";
import { dayKey } from "./src/time.ts";
import { Totals } from "./src/totals.ts";

const envSchema = v.object({
  TABLE_NAME: v.string(),
  REVERSE_INDEX_NAME: v.string(),
});

const env = v.parse(envSchema, process.env);

const dynamo = toDynamoClient();
const totals = new Totals({ dynamo, tableName: env.TABLE_NAME });
const breakdowns = new Breakdowns({ dynamo, tableName: env.TABLE_NAME });
const markers = new AppliedMarkers({ dynamo, tableName: env.TABLE_NAME });

export async function handler(): Promise<void> {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const target = dayKey(yesterday);

  const result = await applyDailyRollup({
    dayKey: target,
    models: { totals, breakdowns, markers },
    dynamo,
  });

  console.log(`dailyRollup ${target} ${result.status}`);
}
