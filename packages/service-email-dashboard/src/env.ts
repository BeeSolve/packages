import { defineEnvVars } from "@sveltejs/kit/env";
import * as v from "valibot";

export const variables = defineEnvVars({
  DASHBOARD_TABLE_NAME: { schema: v.string() },
  DASHBOARD_REVERSE_INDEX: { schema: v.string() },
  DASHBOARD_REQUESTS_BUCKET: { schema: v.string() },
});
