import { parseSid } from "./cookie.ts";
import { Sessions } from "./session.ts";
import type { ValidSession } from "./validSession.ts";

export type { ValidSession };

type SetCookieParam = { sid: string; maxAge: number };

export type AuthorizeResult =
  | { type: "invalid"; error: string; setCookiesParams: Array<SetCookieParam> }
  | {
      type: "expired";
      expiredSession: { userId: string; sessionId: string; expiredAt: string };
      setCookiesParams: Array<SetCookieParam>;
    }
  | {
      type: "valid";
      validSession: ValidSession;
      setCookiesParams: Array<SetCookieParam>;
    };

export async function authorize(props: {
  sessions: Sessions;
  cookieHeader: string | null | undefined;
  headers?: Record<string, string>;
}): Promise<AuthorizeResult> {
  const { sessions, cookieHeader, headers } = props;

  if (cookieHeader == null) {
    return { type: "invalid", error: "Missing cookie header.", setCookiesParams: [] };
  }

  const sid = parseSid(cookieHeader);
  if (sid == null) {
    return { type: "invalid", error: "Invalid cookie.", setCookiesParams: [] };
  }

  const session = await sessions.getOne(sid).catch(() => null);
  if (session == null) {
    return {
      type: "invalid",
      error: "Session not found.",
      setCookiesParams: [{ sid, maxAge: -1 }],
    };
  }

  if (Date.now() > Date.parse(session.expiresAt)) {
    return {
      type: "expired",
      expiredSession: {
        userId: session.userId,
        sessionId: session.sessionId,
        expiredAt: session.expiresAt,
      },
      setCookiesParams: [{ sid, maxAge: -1 }],
    };
  }

  const data = headers ? Sessions.dataFromCloudFrontHeaders(headers) : {};
  const { newSession, maxAge } = await sessions.refresh({ session, data });

  const setCookiesParams: Array<SetCookieParam> =
    sid !== newSession.id
      ? [
          { sid, maxAge: -1 },
          { sid: newSession.id, maxAge },
        ]
      : [{ sid: newSession.id, maxAge }];

  const validSession: ValidSession =
    session.impersonatedBy != null
      ? {
          userId: newSession.userId,
          sessionId: session.id,
          expiresAt: newSession.expiresAt,
          impersonating: true as const,
          impersonatedBy: session.impersonatedBy,
        }
      : {
          userId: newSession.userId,
          sessionId: session.id,
          expiresAt: newSession.expiresAt,
          impersonating: false as const,
        };

  return {
    type: "valid",
    validSession,
    setCookiesParams,
  };
}
