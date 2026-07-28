import { randomUUID } from "crypto";

import { keptActive } from "@beesolve/lambda-keep-active/runtime";
import * as v from "valibot";

import { type AuthorizeResult, authorize } from "./src/authorize.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { Sessions } from "./src/session.ts";

const envSchema = v.object({
  SESSIONS_TABLE_NAME: v.string(),
  SESSIONS_USER_ID_INDEX_NAME: v.string(),
  SESSION_MAX_AGE: v.optional(
    v.pipe(v.string(), v.transform(Number)),
    "2592000", // 30 days
  ),
  SESSION_REFRESH_DRIFT: v.optional(
    v.pipe(v.string(), v.transform(Number)),
    "15000", // 15 seconds
  ),
});
const env = v.parse(envSchema, process.env);

const dynamo = toDynamoClient();
const sessions = new Sessions({
  dynamo,
  tableName: env.SESSIONS_TABLE_NAME,
  userIdIndexName: env.SESSIONS_USER_ID_INDEX_NAME,
  defaultMaxAge: env.SESSION_MAX_AGE,
  refreshDrift: env.SESSION_REFRESH_DRIFT,
});

interface AuthorizationEvent {
  readonly methodArn: string;
  readonly headers: {
    Cookie?: string | null;
    cookie?: string | null;
  } & Record<string, string>;
}

export const handler = keptActive(async (event: AuthorizationEvent) => {
  try {
    const { Cookie, cookie, ...headers } = event.headers;

    const result = await authorize({
      sessions,
      cookieHeader: Cookie ?? cookie,
      headers,
    });

    return toIamPolicy(event.methodArn, result);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error("Unknown error", error);
    }

    return toIamPolicy(event.methodArn, {
      type: "invalid",
      error: "Unexpected error.",
      setCookiesParams: [],
    });
  }
});

function toIamPolicy(methodArn: string, session: AuthorizeResult) {
  const parts = methodArn.split(":");
  const base = parts.slice(0, 5);

  const pathParts = parts.at(5)?.split("/") ?? [];
  const resource = [...base, [...pathParts.slice(0, 2), "*"].join("/")].join(":");

  return {
    principalId: randomUUID(),
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: "Allow",
          Resource: resource,
        },
      ],
    },
    context: {
      session: JSON.stringify(session),
    },
  };
}
