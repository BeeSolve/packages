import { createSessionHandle } from "@beesolve/auth-service/sveltekit";
import { redirect } from "@sveltejs/kit";
import { sequence, type Handle } from "@sveltejs/kit/hooks";

const publicPaths = new Set(["/sign-in", "/sign-in/verify"]);

const authGuard: Handle = async ({ event, resolve }) => {
  const isPublic = publicPaths.has(event.url.pathname);

  if (event.locals.session.type !== "valid" && !isPublic) {
    redirect(303, "/sign-in");
  }

  return resolve(event);
};

export const handle = sequence(createSessionHandle(), authGuard);
