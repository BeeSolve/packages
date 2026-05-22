import { runWithAwsContext } from "@beesolve/lambda-fetch-api";
import type {
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  Context,
} from "aws-lambda";
import type { ValidSession } from "./src/requireSession.ts";

export type { ValidSession };

/**
 * Wraps a fetch handler to simulate the Lambda authorizer context in local dev.
 * Runs the handler inside `runWithAwsContext` with a fake API Gateway v2 event
 * containing the provided session, so `requireSessionV2` works without AWS.
 *
 * @example
 * ```ts
 * import { withDevSession } from "@beesolve/auth-service/dev";
 * import { serve } from "bun";
 *
 * const api = withDevSession(apiFetch, { userId: "user-123" });
 *
 * serve({
 *   routes: { "/api/*": (request) => api(request) },
 * });
 * ```
 */
export function withDevSession(
  handler: (request: Request) => Promise<Response>,
  session: Pick<ValidSession, "userId"> & Partial<ValidSession>,
): (request: Request) => Promise<Response> {
  const expiresAt = new Date();
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);

  const fakeEvent = {
    version: "2.0",
    routeKey: "ANY /",
    rawPath: "/",
    rawQueryString: "",
    headers: {},
    body: undefined,
    isBase64Encoded: false,
    requestContext: {
      authorizer: {
        lambda: {
          session: JSON.stringify({
            type: "valid",
            validSession: {
              sessionId: session.sessionId ?? "dev-session",
              userId: session.userId,
              expiresAt: session.expiresAt ?? expiresAt.toISOString(),
            },
            setCookiesParams: [{ sid: "dev-session", maxAge: 2_592_000 }],
          }),
        },
      },
      http: { method: "POST", path: "/", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "dev" },
      routeKey: "ANY /",
      requestId: "dev",
      accountId: "local",
      apiId: "local",
      domainName: "localhost",
      domainPrefix: "localhost",
      stage: "dev",
      time: "",
      timeEpoch: 0,
    },
  } satisfies APIGatewayProxyEventV2WithLambdaAuthorizer<{ session: string }>;

  const fakeContext: Context = {
    awsRequestId: "dev",
    functionName: "dev",
    functionVersion: "dev",
    invokedFunctionArn: "dev",
    memoryLimitInMB: "128",
    logGroupName: "dev",
    logStreamName: "dev",
    callbackWaitsForEmptyEventLoop: false,
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };

  return (request) =>
    runWithAwsContext(fakeEvent, fakeContext, () => handler(request));
}
