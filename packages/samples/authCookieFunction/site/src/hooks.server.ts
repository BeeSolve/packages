import { createSessionHandle } from "@beesolve/auth-service/sveltekit";
import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

const publicPaths = new Set(["/sign-in", "/sign-in/verify"]);

const authGuard: Handle = async ({ event, resolve }) => {
  const isPublic = publicPaths.has(event.url.pathname);

  // session.type can be:
  // - "valid": user is authenticated (authorizer resolved the session)
  // - "invalid": session cookie present but expired/invalid
  // - "expired": session was valid but has expired
  // - "none": authorizer did not run for this request (shouldn't happen with /{proxy+})
  if (event.locals.session.type !== "valid" && !isPublic) {
    redirect(303, "/sign-in");
  }

  return resolve(event);
};

export const handle = sequence(createSessionHandle(), authGuard);
