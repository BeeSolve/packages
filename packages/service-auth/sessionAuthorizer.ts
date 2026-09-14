import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { type AuthorizeResult, authorize, type ValidSession } from "./src/authorize.ts";
import { addSetCookies } from "./src/cookie.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { Sessions } from "./src/session.ts";

export type { AuthorizeResult, ValidSession };

const envSchema = v.object({
  BEESOLVE_AUTH_SESSIONS_TABLE_NAME: v.string(),
  BEESOLVE_AUTH_SESSIONS_USER_ID_INDEX_NAME: v.string(),
  BEESOLVE_AUTH_SESSION_MAX_AGE: v.pipe(v.string(), v.transform(Number)),
  BEESOLVE_AUTH_SESSION_REFRESH_DRIFT: v.pipe(v.string(), v.transform(Number)),
  BEESOLVE_AUTH_SESSION_REFRESH_INTERVAL: v.pipe(v.string(), v.transform(Number)),
});
const env = v.parse(envSchema, process.env);

export class SessionAuthorizer {
  private readonly sessions: Sessions;

  constructor(
    props: {
      readonly dynamo?: DynamoDBDocumentClient;
    } = {},
  ) {
    this.sessions = new Sessions({
      dynamo: props.dynamo ?? toDynamoClient(),
      tableName: env.BEESOLVE_AUTH_SESSIONS_TABLE_NAME,
      userIdIndexName: env.BEESOLVE_AUTH_SESSIONS_USER_ID_INDEX_NAME,
      defaultMaxAge: env.BEESOLVE_AUTH_SESSION_MAX_AGE,
      refreshDrift: env.BEESOLVE_AUTH_SESSION_REFRESH_DRIFT,
      refreshInterval: env.BEESOLVE_AUTH_SESSION_REFRESH_INTERVAL,
    });
  }

  /**
   * Verifies and rotates the session from the provided headers.
   * Parses the cookie, looks up the session in DynamoDB, and rotates if needed.
   */
  readonly authorize = async (headers: Headers): Promise<AuthorizeResult> => {
    return authorize({
      sessions: this.sessions,
      cookieHeader: headers.get("cookie"),
    });
  };
}

/**
 * Wraps a Fetch-style handler with in-process session verification + rotation.
 * Sets Set-Cookie headers on the response automatically.
 *
 * @example
 * ```ts
 * import { SessionAuthorizer, withSession } from "@beesolve/auth-service/sessionAuthorizer";
 *
 * const authorizer = new SessionAuthorizer();
 *
 * export const handler = fetchApiHandler(
 *   withSession(authorizer, async (request, session) => {
 *     return new Response(JSON.stringify({ userId: session.userId }));
 *   })
 * );
 * ```
 */
export function withSession(
  authorizer: SessionAuthorizer,
  handler: (request: Request, session: ValidSession) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const result = await authorizer.authorize(request.headers);

    if (result.type !== "valid") {
      const res = new Response(JSON.stringify({ message: "Unauthorized", type: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
      addSetCookies({ headers: res.headers, cookies: result.setCookiesParams });
      return res;
    }

    const response = await handler(request, result.validSession);
    addSetCookies({ headers: response.headers, cookies: result.setCookiesParams });
    return response;
  };
}
