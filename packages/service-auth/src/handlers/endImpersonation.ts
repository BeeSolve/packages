import * as v from "valibot";

import { parseSid } from "../cookie.ts";
import { BadRequestError } from "../errors.ts";
import type { Events } from "../events.ts";
import { parseBody } from "../request.ts";
import type { Sessions } from "../session.ts";

interface Dependencies {
  readonly headers: Headers;
  readonly requestBody: () => Promise<unknown>;
  readonly sessions: Pick<Sessions, "getOne" | "stopImpersonating">;
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
  if (session.impersonatedId == null) throw new BadRequestError(`Not in an impersonation session.`);

  await sessions.stopImpersonating(sid);

  await events.putEvents({
    type: "ImpersonationEnded",
    detail: {
      currentUserId: session.userId,
      targetUserId: session.impersonatedId,
      endedAt: new Date().toISOString(),
    },
  });

  if (headers.get("accept")?.includes("application/json")) {
    return new Response(JSON.stringify({ redirectTo: redirectTo ?? "/" }), {
      status: 200,
      headers: new Headers({
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      }),
    });
  }

  return new Response(null, {
    status: 303,
    headers: new Headers({
      "Cache-Control": "no-store",
      Location: redirectTo ?? "/",
    }),
  });
}
