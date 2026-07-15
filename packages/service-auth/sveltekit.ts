import type { Handle } from "@sveltejs/kit";

import { addSetCookies } from "./src/cookie.ts";
import type { SessionContext, ValidSession } from "./src/sessionContext.ts";
import { getSessionContext } from "./src/sessionContext.ts";

export type { SessionContext, ValidSession };
export {
  getSessionContext,
  getSessionContextV1,
  getSessionContextV2,
} from "./src/sessionContext.ts";

declare global {
  namespace App {
    interface Locals {
      session: SessionContext;
    }
  }
}

export const devValidSession: SessionContext = {
  type: "valid",
  validSession: {
    userId: "dev-user",
    sessionId: "dev-session",
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  },
  setCookiesParams: [],
};

export const devInvalidSession: SessionContext = {
  type: "invalid",
  error: "No session cookie present",
  setCookiesParams: [],
};

export const devExpiredSession: SessionContext = {
  type: "expired",
  expiredSession: {
    userId: "dev-user",
    sessionId: "dev-session-expired",
    expiredAt: new Date(Date.now() - 3600 * 1000).toISOString(),
  },
  setCookiesParams: [],
};

interface SessionHandleOptions {
  /**
   * Session to use when not running in Lambda (local dev, preview).
   * @default devValidSession
   */
  fallbackSession?: SessionContext;
}

const isLambda = process.env.LAMBDA_TASK_ROOT != null;

/**
 * Creates a SvelteKit handle hook that populates `event.locals.session`
 * from the Lambda authorizer context.
 *
 * Auto-detects HTTP API (v2) vs REST API (v1) at runtime.
 * When not running in Lambda (e.g. `vite dev`), uses the provided
 * fallback session or defaults to `devValidSession`.
 *
 * Forwards `setCookiesParams` from the authorizer response to the
 * outgoing response headers (session refresh, cookie clearing).
 */
export function createSessionHandle(options?: SessionHandleOptions): Handle {
  const fallback = options?.fallbackSession ?? devValidSession;

  return async ({ event, resolve }) => {
    const session = isLambda ? await getSessionContext() : fallback;
    event.locals.session = session;

    const response = await resolve(event);

    if (session.setCookiesParams.length > 0) {
      addSetCookies({ headers: response.headers, cookies: session.setCookiesParams });
    }

    return response;
  };
}
