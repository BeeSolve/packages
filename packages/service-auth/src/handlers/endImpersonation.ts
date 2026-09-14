import * as v from "valibot";

import { addSetCookies, parseSid } from "../cookie.ts";
import { BadRequestError } from "../errors.ts";
import type { Events } from "../events.ts";
import { parseBody } from "../request.ts";
import { Sessions } from "../session.ts";

interface Dependencies {
  readonly headers: Headers;
  readonly requestBody: () => Promise<unknown>;
  readonly sessions: Pick<Sessions, "getOne" | "createOne" | "delete">;
  readonly events: Pick<Events, "putEvents">;
}

const safeRedirectTo = v.pipe(
  v.string(),
  v.transform(decodeURIComponent),
  v.regex(/^\/(?!\/)/, "redirectTo must be a relative path"),
);

const schema = v.object({
  redirectTo: v.optional(safeRedirectTo),
});

export async function endImpersonation({
  headers,
  sessions,
  requestBody,
  events,
}: Dependencies): Promise<Response> {
  const { redirectTo } = parseBody({
    body: await requestBody(),
    schema,
  });

  const sid = parseSid(headers.get("cookie"));
  if (sid == null) throw new BadRequestError(`Missing cookie.`);

  const session = await sessions.getOne(sid);
  if (session.impersonatedBy == null) throw new BadRequestError(`Not in an impersonation session.`);

  const newSession = await sessions.createOne({
    userId: session.impersonatedBy,
    data: Sessions.dataFromCloudFrontHeaders(Object.fromEntries(headers.entries())),
  });

  await sessions.delete(sid);

  await events.putEvents({
    type: "ImpersonationEnded",
    detail: {
      currentUserId: session.impersonatedBy,
      targetUserId: session.userId,
      endedAt: new Date().toISOString(),
    },
  });

  const cookies = [
    { sid, maxAge: -1 },
    { sid: newSession.id, maxAge: newSession.maxAge },
  ];

  if (headers.get("accept")?.includes("application/json")) {
    return new Response(JSON.stringify({ redirectTo: redirectTo ?? "/" }), {
      status: 200,
      headers: addSetCookies({
        headers: new Headers({
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
        }),
        cookies,
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
      cookies,
    }),
  });
}
