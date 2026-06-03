import { randomUUID } from "node:crypto";

import { EventBridge } from "@aws-sdk/client-eventbridge";
import { ActionTokensClient } from "@beesolve/action-tokens/sdk";
import { asHttpV2Handler } from "@beesolve/lambda-fetch-api";
import { keptActive } from "@beesolve/lambda-keep-active/runtime";
import * as v from "valibot";

import { Accounts } from "./src/account.ts";
import { parseDataTokenCookie } from "./src/cookie.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from "./src/errors.ts";
import { Events } from "./src/events.ts";
import { signInComplete } from "./src/handlers/signInComplete.ts";
import { signInRequest } from "./src/handlers/signInRequest.ts";
import { signOut } from "./src/handlers/signOut.ts";
import { Sessions } from "./src/session.ts";
import { tasks } from "./tasks.ts";

const envSchema = v.object({
  STAGE: v.string(),
  SESSIONS_TABLE_NAME: v.string(),
  SESSIONS_USER_ID_INDEX_NAME: v.string(),
  ACCOUNTS_TABLE_NAME: v.string(),
  ACCOUNTS_REVERSE_INDEX_NAME: v.string(),
  EVENT_BUS_ARN: v.string(),
  BASE_URI: v.string(),
  ALLOW_SIGN_UP: v.pipe(
    v.string(),
    v.transform((value) => value === "true"),
  ),
  EVENT_SOURCE: v.optional(v.string()),
  DATA_TOKEN: v.optional(
    v.pipe(
      v.string(),
      v.transform((value) => value === "true"),
    ),
    "false",
  ),
  SESSION_MAX_AGE: v.optional(
    v.pipe(v.string(), v.transform(Number)),
    "2592000", // 30 days
  ),
  OTP_EXPIRY: v.optional(
    v.pipe(v.string(), v.transform(Number)),
    "600", // 10 minutes
  ),
});
const env = v.parse(envSchema, process.env);

const dynamo = toDynamoClient();
const sessions = new Sessions({
  dynamo,
  tableName: env.SESSIONS_TABLE_NAME,
  userIdIndexName: env.SESSIONS_USER_ID_INDEX_NAME,
  defaultMaxAge: env.SESSION_MAX_AGE,
});
const accounts = new Accounts({
  dynamo,
  tableName: env.ACCOUNTS_TABLE_NAME,
  reverseIndexName: env.ACCOUNTS_REVERSE_INDEX_NAME,
});
const actionTokens = new ActionTokensClient();
const events = new Events({
  client: new EventBridge(),
  eventBusArn: env.EVENT_BUS_ARN,
  eventSource: env.EVENT_SOURCE,
});

const cookiesToStrip = new Set(["__Host-SID", "__Host-DataToken"]);
const stagePrefixPattern = new RegExp(`^/${env.STAGE}`);

const errorResponseMap = new Map<Function, { readonly status: number; readonly type: string }>([
  [NotFoundError, { status: 404, type: "notFound" }],
  [ForbiddenError, { status: 403, type: "forbidden" }],
  [UnauthorizedError, { status: 401, type: "unauthorized" }],
  [BadRequestError, { status: 400, type: "badRequest" }],
]);

const fetch = async (request: Request): Promise<Response> => {
  const awsRequestId = request.headers.get("x-amzn-requestid") ?? `gen-${randomUUID()}`;

  console.time(awsRequestId);
  try {
    if (request.method.toLowerCase() !== "post") {
      throw new BadRequestError("Invalid HTTP method.");
    }
    if (request.headers.get("content-type") !== "application/json") {
      throw new BadRequestError("Content-type must be application/json");
    }
    if (request.body == null) {
      throw new BadRequestError("Body must be object.");
    }

    const path = new URL(request.url).pathname.replace(stagePrefixPattern, "");

    const requestBody = () => request.json();

    if (path === "/auth/signInRequest") {
      const cookieHeader = request.headers.get("cookie") ?? "";
      const cookies = Object.fromEntries(
        cookieHeader
          .split(";")
          .map((c) => c.trim().split("="))
          .filter(([key]) => key && !cookiesToStrip.has(key.trim()))
          .map(([key, ...rest]) => [key?.trim(), rest.join("=")]),
      );
      const acceptLanguage = request.headers.get("accept-language");
      const requestOrigin = request.headers.get("origin");

      return await signInRequest({
        actionTokens,
        events,
        accounts,
        baseUri: env.BASE_URI,
        requestBody,
        cookies,
        acceptLanguage,
        requestOrigin,
        otpExpirySeconds: env.OTP_EXPIRY,
      });
    }

    if (path === "/auth/signInComplete") {
      const dataToken = env.DATA_TOKEN
        ? parseDataTokenCookie(request.headers.get("cookie"))
        : undefined;

      return await signInComplete({
        actionTokens,
        accounts,
        sessions,
        events,
        headers: request.headers,
        requestBody,
        allowSignUp: env.ALLOW_SIGN_UP,
        dataToken: dataToken ?? undefined,
      });
    }

    if (path === "/auth/signOut") {
      return await signOut({
        sessions,
        events,
        requestBody,
        headers: request.headers,
        retrySessionDelete: (sid) => tasks.deleteSession(sid),
      });
    }

    throw new NotFoundError(`Path not found. ${path}`);
  } catch (error) {
    if (error instanceof Error) {
      const meta = errorResponseMap.get(error.constructor);
      if (meta != null) {
        return new Response(JSON.stringify({ message: error.message, type: meta.type }), {
          status: meta.status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    console.error(error);

    return new Response(JSON.stringify({ message: "Unexpected error.", type: "unexpected" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    console.timeEnd(awsRequestId);
  }
};

type LambdaHandler = (event: unknown, context: unknown) => Promise<unknown> | undefined;

export const handler = keptActive(asHttpV2Handler(fetch)) as unknown as LambdaHandler;

export default {
  fetch,
};
