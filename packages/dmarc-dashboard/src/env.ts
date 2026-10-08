import { defineEnvVars } from "@sveltejs/kit/env";
import * as v from "valibot";

export const variables = defineEnvVars({
  DMARC_TABLE_NAME: { schema: v.string() },
  DMARC_REVERSE_INDEX: { schema: v.string() },
  IPINFO_API_KEY: { schema: v.optional(v.string()) },
});
