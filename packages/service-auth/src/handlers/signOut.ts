import * as v from "valibot";

import { addSetCookies, parseSid } from "../cookie.ts";
import { BadRequestError } from "../errors.ts";
import type { Events } from "../events.ts";
import { parseBody } from "../request.ts";
import type { Sessions } from "../session.ts";

interface Dependencies {
  readonly headers: Headers;
  readonly requestBody: () => Promise<unknown>;
  readonly sessions: Pick<Sessions, "delete">;
  readonly events: Pick<Events, "putEvents">;
  readonly retrySessionDelete?: (sid: string) => void;
}

const safeRedirectTo = v.pipe(
  v.string(),
  v.transform(decodeURIComponent),
  v.regex(/^\/(?!\/)/, "redirectTo must be a relative path"),
);

const schema = v.object({
  redirectTo: v.optional(safeRedirectTo),
});

export async function signOut({
  headers,
  sessions,
  requestBody,
  events,
  retrySessionDelete,
}: Dependencies): Promise<Response> {
  const { redirectTo } = parseBody({
    body: await requestBody(),
    schema,
  });

  const sid = parseSid(headers.get("cookie"));
  if (sid == null) throw new BadRequestError(`Missing cookie.`);

  await Promise.all([
    sessions.delete(sid).catch(() => retrySessionDelete?.(sid)),
    events.putEvents({
      type: "SessionInvalidated",
      detail: {
        sessionId: sid,
      },
    }),
  ]);

  if (headers.get("accept")?.includes("application/json")) {
    return new Response(JSON.stringify({ redirectTo: redirectTo ?? "/" }), {
      status: 200,
      headers: addSetCookies({
        headers: new Headers({
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
        }),
        cookies: [{ sid, maxAge: -1 }],
      }),
    });
  }

  return new Response(null, {
    status: 303,
    headers: addSetCookies({
      headers: new Headers({
        "Cache-Control": "no-store",
        Location: redirectTo ?? "/",
      }),
      cookies: [{ sid, maxAge: -1 }],
    }),
  });
}
