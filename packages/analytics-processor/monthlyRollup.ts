import * as v from "valibot";

import { AppliedMarkers } from "./src/appliedMarkers.ts";
import { Breakdowns } from "./src/breakdowns.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { applyMonthlyRollup } from "./src/processHour.ts";
import { monthKey } from "./src/time.ts";
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
  const lastMonth = new Date();
  lastMonth.setUTCDate(1);
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
  const target = monthKey(lastMonth);

  const result = await applyMonthlyRollup({
    monthKey: target,
    models: { totals, breakdowns, markers },
    dynamo,
  });

  console.log(`monthlyRollup ${target} ${result.status}`);
}
