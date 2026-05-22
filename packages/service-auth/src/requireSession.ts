import {
  getAwsLambdaAuthorizerContext,
  getAwsCustomAuthorizerContext,
} from "@beesolve/lambda-fetch-api";
import * as v from "valibot";

const setCookieParam = v.object({ sid: v.string(), maxAge: v.number() });

const validSessionSchema = v.object({
  userId: v.string(),
  sessionId: v.string(),
  expiresAt: v.string(),
});

const sessionContextSchema = v.variant("type", [
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

const sessionStringSchema = v.pipe(
  v.string(),
  v.transform((value) => JSON.parse(value) as unknown),
  sessionContextSchema,
);

function parseSession(raw: unknown): ValidSession | null {
  const result = v.safeParse(sessionStringSchema, raw);
  if (!result.success || result.output.type !== "valid") return null;
  return result.output.validSession;
}

function unauthorized() {
  return new Response(
    JSON.stringify({ message: "Unauthorized", type: "unauthorized" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

/** For HTTP API (v2) routes behind the service-auth authorizer. */
export function requireSessionV2(
  handler: (request: Request, session: ValidSession) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const ctx = getAwsLambdaAuthorizerContext() as
      | { session?: string }
      | undefined;
    const session = parseSession(ctx?.session);
    if (session == null) return unauthorized();
    return handler(request, session);
  };
}

/** For REST API (v1) routes behind the service-auth authorizer. */
export function requireSessionV1(
  handler: (request: Request, session: ValidSession) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const ctx = getAwsCustomAuthorizerContext() as
      | { session?: string }
      | undefined;
    const session = parseSession(ctx?.session);
    if (session == null) return unauthorized();
    return handler(request, session);
  };
}
