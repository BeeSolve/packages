import * as v from "valibot";

import { addSetCookies, parseSid } from "../cookie.ts";
import { BadRequestError } from "../errors.ts";
import type { Events } from "../events.ts";
import { parseBody } from "../request.ts";
import type { Sessions } from "../session.ts";

interface Dependencies {
  readonly headers: Headers;
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly requestBody: () => Promise<any>;
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

  return new Response(null, {
    status: 301,
    headers: addSetCookies({
      headers: new Headers({
        Location: redirectTo ?? "/",
        "Cache-Control": "no-store",
      }),
      cookies: [{ sid, maxAge: -1 }],
    }),
  });
}
