import {
  getAwsCustomAuthorizerContext,
  getAwsEvent,
  getAwsLambdaAuthorizerContext,
  hasAuthorizerContext,
  isAPIGatewayProxyEventV2,
} from "@beesolve/lambda-fetch-api";
import * as v from "valibot";

const setCookieParam = v.object({ sid: v.string(), maxAge: v.number() });

const validSessionSchema = v.object({
  userId: v.string(),
  sessionId: v.string(),
  expiresAt: v.string(),
});

const sessionContextSchema = v.variant("type", [
  v.object({ type: v.literal("none") }),
  v.object({
    type: v.literal("invalid"),
    error: v.string(),
    setCookiesParams: v.array(setCookieParam),
  }),
  v.object({
    type: v.literal("expired"),
    expiredSession: v.object({
      userId: v.string(),
      sessionId: v.string(),
      expiredAt: v.string(),
    }),
    setCookiesParams: v.array(setCookieParam),
  }),
  v.object({
    type: v.literal("valid"),
    validSession: validSessionSchema,
    setCookiesParams: v.array(setCookieParam),
  }),
]);

export type SessionContext = v.InferOutput<typeof sessionContextSchema>;
export type ValidSession = v.InferOutput<typeof validSessionSchema>;

export const sessionStringSchema = v.pipe(
  v.string(),
  v.transform((value) => JSON.parse(value) as unknown),
  sessionContextSchema,
);

const authorizerContextSchema = v.object({ session: sessionStringSchema });

/**
 * Retrieves the session context from the current Lambda authorizer payload.
 * Auto-detects whether the event is HTTP API (v2) or REST API (v1) and reads
 * the authorizer context from the appropriate location.
 *
 * Returns `{ type: "none" }` when no authorizer context is present (e.g.
 * public endpoints where the authorizer did not run).
 */
export async function getSessionContext(): Promise<SessionContext> {
  if (!hasAuthorizerContext()) {
    return { type: "none" as const };
  }

  const event = getAwsEvent();
  if (isAPIGatewayProxyEventV2(event)) {
    const ctx = await getAwsLambdaAuthorizerContext(authorizerContextSchema);
    return ctx.session;
  }
  const ctx = await getAwsCustomAuthorizerContext(authorizerContextSchema);
  return ctx.session;
}

/** Retrieves the session context from an HTTP API (v2) Lambda authorizer payload. */
export async function getSessionContextV2(): Promise<SessionContext> {
  const ctx = await getAwsLambdaAuthorizerContext(authorizerContextSchema);
  return ctx.session;
}

/** Retrieves the session context from a REST API (v1) custom authorizer payload. */
export async function getSessionContextV1(): Promise<SessionContext> {
  const ctx = await getAwsCustomAuthorizerContext(authorizerContextSchema);
  return ctx.session;
}
