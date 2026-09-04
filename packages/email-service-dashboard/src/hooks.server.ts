import { createSessionHandle, type SessionContext } from "@beesolve/auth-service/sveltekit";
import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import * as v from "valibot";

// Env is parsed eagerly at module load. `vite build` imports this file during
// SSR analysis, so the required `v.string()` vars must be present — the `build`
// script supplies placeholder values (see package.json).
const envSchema = v.object({
  DASHBOARD_TABLE_NAME: v.string(),
  DASHBOARD_REVERSE_INDEX: v.string(),
});
v.parse(envSchema, process.env);

const publicPaths = new Set(["/sign-in", "/sign-in/verify", "/setup"]);

const authGuard: Handle = async ({ event, resolve }) => {
  const isPublic = publicPaths.has(event.url.pathname);

  if (event.locals.session.type !== "valid" && !isPublic) {
    redirect(303, "/sign-in");
  }

  event.locals.user = null;

  return resolve(event);
};

// In local dev the auth service applies `fallbackSession` automatically (there
// is no Lambda authorizer). Point it at a real user's email via DEV_USER_EMAIL
// so downstream lookups resolve against the real table. Ignored in Lambda.
const devUserEmail = process.env.DEV_USER_EMAIL;
const fallbackSession =
  import.meta.env.DEV && devUserEmail != null
    ? ({
        type: "valid" as const,
        validSession: {
          userId: devUserEmail,
          sessionId: "dev-session",
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        },
        setCookiesParams: [],
      } satisfies SessionContext)
    : undefined;

export const handle = sequence(createSessionHandle({ fallbackSession }), authGuard);
