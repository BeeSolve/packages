import { AuthClient } from "@beesolve/auth-service/sdk";
import { asLambdaAuthorizedHttpV2Handler } from "@beesolve/lambda-fetch-api";
import * as v from "valibot";

import { createContext } from "./context.ts";

const auth = new AuthClient();

const impersonateRequestSchema = v.object({
  targetUserId: v.pipe(v.string(), v.nonEmpty()),
});

const impersonators = (process.env.SAMPLES_IMPERSONATORS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

/**
 * Toy authorization check for the demo. Real applications MUST enforce a proper
 * permission model here — never allow arbitrary signed-in users to impersonate.
 * When `SAMPLES_IMPERSONATORS` is unset, any signed-in user is allowed so the
 * sample works out of the box.
 */
function canImpersonate(userId: string): boolean {
  if (impersonators.length === 0) return true;
  return impersonators.includes(userId);
}

async function fetch(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/me" && request.method === "GET") {
    const { session } = await createContext();
    if (session == null) return Response.json({ error: "unauthenticated" }, { status: 401 });

    return Response.json({
      userId: session.userId,
      impersonating: session.impersonating,
      impersonatedBy: session.impersonatedBy,
    });
  }

  if (url.pathname === "/api/impersonate" && request.method === "POST") {
    const parsed = v.safeParse(impersonateRequestSchema, await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });

    const { session } = await createContext();
    if (session == null) return Response.json({ error: "unauthenticated" }, { status: 401 });

    if (session.impersonating) {
      return Response.json({ error: "already impersonating" }, { status: 400 });
    }

    if (!canImpersonate(session.userId)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    await auth.invoke({
      type: "impersonate",
      request: {
        targetUserId: parsed.output.targetUserId,
        cookieHeader: request.headers.get("cookie") ?? "",
      },
    });

    return Response.json({ ok: true });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}

export const handler = asLambdaAuthorizedHttpV2Handler(fetch);
