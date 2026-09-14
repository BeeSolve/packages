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
    impersonating: false,
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

export const devNoneSession: SessionContext = { type: "none" };

const isLambda = process.env.LAMBDA_TASK_ROOT != null;

interface SessionHandleOptions {
  /**
   * Session to use when not running in Lambda (local dev, preview).
   * @default devValidSession
   */
  fallbackSession?: SessionContext;
}

/**
 * Creates a SvelteKit handle hook that populates `event.locals.session`
 * from the Lambda authorizer context.
 *
 * Auto-detects HTTP API (v2) vs REST API (v1) at runtime.
 * When not running in Lambda (e.g. `vite dev`), uses the provided
 * fallback session or defaults to `devValidSession`.
 *
 * Returns `{ type: "none" }` when the request arrived on a route where
 * the authorizer did not run (e.g. public endpoints).
 */
export function createSessionHandle(options?: SessionHandleOptions): Handle {
  if (!isLambda) {
    return createFallbackHandle(options?.fallbackSession ?? devValidSession);
  }

  return async ({ event, resolve }) => {
    const session = await getSessionContext();
    event.locals.session = session;
    const response = await resolve(event);

    if (session.type !== "none" && session.setCookiesParams.length > 0) {
      addSetCookies({ headers: response.headers, cookies: session.setCookiesParams });
    }

    return response;
  };
}

interface InProcessSessionHandleOptions {
  /**
   * Session to use when not running in Lambda (local dev, preview).
   * @default devValidSession
   */
  fallbackSession?: SessionContext;
}

/**
 * Creates a SvelteKit handle hook that resolves sessions directly from
 * DynamoDB, without relying on the HTTP API Gateway Lambda authorizer.
 *
 * Recommended for SvelteKit SSR applications where a single Lambda
 * invocation per request is preferred. Requires `auth.grantSessionAccess(handler)`
 * on the CDK construct.
 */
export function createInProcessSessionHandle(options?: InProcessSessionHandleOptions): Handle {
  if (!isLambda) {
    return createFallbackHandle(options?.fallbackSession ?? devValidSession);
  }

  // Lazy-init via dynamic import to avoid importing sessionAuthorizer.ts at
  // module load time. That module parses env vars eagerly, which would crash
  // Lambda init when those vars aren't set (e.g. Pattern 2 using createSessionHandle).
  let authorize:
    | ((headers: Headers) => Promise<Exclude<SessionContext, { type: "none" }>>)
    | undefined;

  return async ({ event, resolve }) => {
    if (authorize == null) {
      const { SessionAuthorizer } = await import("./sessionAuthorizer.ts");
      const authorizer = new SessionAuthorizer();
      authorize = (headers) => authorizer.authorize(headers);
    }

    const session = await authorize(event.request.headers);
    event.locals.session = session;
    const response = await resolve(event);
    addSetCookies({ headers: response.headers, cookies: session.setCookiesParams });
    return response;
  };
}

function createFallbackHandle(fallback: SessionContext): Handle {
  return async ({ event, resolve }) => {
    event.locals.session = fallback;
    return resolve(event);
  };
}
