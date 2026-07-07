import { parseSid } from "@beesolve/auth-service";
import { redirect, type Handle } from "@sveltejs/kit";

const publicPaths = new Set(["/sign-in", "/sign-in/verify", "/sign-out"]);

export const handle: Handle = async ({ event, resolve }) => {
  const sessionId = parseSid(event.request.headers.get("cookie"));

  event.locals.sessionId = sessionId;

  const isPublic = publicPaths.has(event.url.pathname);

  if (!sessionId && !isPublic) {
    redirect(303, "/sign-in");
  }

  return resolve(event);
};
