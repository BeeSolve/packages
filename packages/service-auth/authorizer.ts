import { randomUUID } from "crypto";
import * as v from "valibot";
import { parseSid } from "./src/cookie.ts";
import { toDynamoClient } from "./src/dynamo.ts";
import { Sessions } from "./src/session.ts";
import { keptActive } from "@beesolve/lambda-keep-active/runtime";

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
  };
}

type SetCookieParam = { sid: string; maxAge: number };

type SessionContext =
  | { type: "invalid"; error: string; setCookiesParams: SetCookieParam[] }
  | {
      type: "expired";
      expiredSession: { userId: string; sessionId: string; expiredAt: Date };
      setCookiesParams: SetCookieParam[];
    }
  | {
      type: "valid";
      validSession: { userId: string; sessionId: string; expiresAt: Date };
      setCookiesParams: SetCookieParam[];
    };

export const handler = keptActive(async (event: AuthorizationEvent) => {
  try {
    const { Cookie, cookie, ...headers } = event.headers;

    const cookieHeader = Cookie ?? cookie;
    if (cookieHeader == null) {
      console.error("Missing cookie header.");
      return authorize({
        type: "invalid",
        error: "Missing cookie header.",
        setCookiesParams: [],
      });
    }

    const sid = parseSid(cookieHeader);
    if (sid == null) {
      console.error("Cannot parse SID from cookie.");
      return authorize({
        type: "invalid",
        error: "Invalid cookie.",
        setCookiesParams: [],
      });
    }

    const session = await sessions.getOne(sid).catch(() => null);
    if (session == null) {
      console.error("Session not found.");
      return authorize({
        type: "invalid",
        error: "Session not found.",
        setCookiesParams: [
          {
            sid,
            maxAge: -1,
          },
        ],
      });
    }

    if (Date.now() > session.expiresAt.getTime()) {
      console.error("Session expired.");
      return authorize({
        type: "expired",
        expiredSession: {
          userId: session.userId,
          sessionId: session.sessionId,
          expiredAt: session.expiresAt,
        },
        setCookiesParams: [
          {
            sid,
            maxAge: -1,
          },
        ],
      });
    }

    const { newSession, maxAge } = await sessions.refresh({
      session,
      data: Sessions.dataFromCloudFrontHeaders(headers),
    });

    return authorize({
      type: "valid",
      validSession: {
        userId: newSession.userId,
        sessionId: session.id,
        expiresAt: newSession.expiresAt,
      },
      setCookiesParams:
        sid !== newSession.id
          ? [
              {
                sid,
                maxAge: -1,
              },
              {
                sid: newSession.id,
                maxAge,
              },
            ]
          : [
              {
                sid: newSession.id,
                maxAge,
              },
            ],
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(`Unknown error ${error}`);
    }

    return authorize({
      type: "invalid",
      error: "Unexpected error.",
      setCookiesParams: [],
    });
  }

  function authorize(session: SessionContext) {
    const parts = event.methodArn.split(":");
    const base = parts.slice(0, 5);

    const pathParts = parts.at(5)?.split("/") ?? [];
    const resource = [...base, [...pathParts.slice(0, 2), "*"].join("/")].join(
      ":",
    );

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
});
