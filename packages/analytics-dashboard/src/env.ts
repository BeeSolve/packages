import { defineEnvVars } from "@sveltejs/kit/env";
import * as v from "valibot";

export const variables = defineEnvVars({
  ANALYTICS_TABLE_NAME: { schema: v.string() },
  ANALYTICS_REVERSE_INDEX: { schema: v.string() },
  ANALYTICS_USERS_TABLE: { schema: v.string() },
  ANALYTICS_USERS_REVERSE_INDEX: { schema: v.string() },
  BEESOLVE_ANALYTICS_SDK_HANDLER_ARN: { schema: v.string() },
  IPINFO_API_KEY: { schema: v.optional(v.string()) },
});
