import { createInProcessSessionHandle } from "@beesolve/auth-service/sveltekit";
import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

const publicPaths = new Set(["/sign-in", "/sign-in/verify", "/sign-out"]);

const authGuard: Handle = async ({ event, resolve }) => {
  const isPublic = publicPaths.has(event.url.pathname);

  if (event.locals.session.type !== "valid" && !isPublic) {
    redirect(303, "/sign-in");
  }

  return resolve(event);
};

export const handle = sequence(createInProcessSessionHandle(), authGuard);
