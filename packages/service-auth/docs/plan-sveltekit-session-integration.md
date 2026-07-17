# Plan: SvelteKit Session Integration Patterns

## Context

The `@beesolve/auth-service` package needs to support SvelteKit SSR applications deployed via `kit-on-lambda`. The existing Lambda authorizer pattern (used by SPA projects) doesn't work cleanly for SSR because:

- HTTP API Gateway returns 401 before reaching the Lambda when `identitySource` is set and the cookie header is missing
- SSR apps need the server to handle unauthenticated requests (to issue redirects)
- SPAs handle 401 client-side; SSR cannot

This plan introduces two new integration patterns for SSR alongside the existing SPA pattern, documents all three, and adds ADRs explaining the architectural decisions.

---

## New Session State: `"none"`

Add a new state to `SessionContext` representing "no session resolution was performed":

```typescript
type SessionContext =
  | { type: "none" }
  | { type: "invalid"; error: string; setCookiesParams: SetCookieParam[] }
  | { type: "expired"; expiredSession: ...; setCookiesParams: SetCookieParam[] }
  | { type: "valid"; validSession: ...; setCookiesParams: SetCookieParam[] }
```

This is used when:

- Pattern 2: public routes where the authorizer didn't run
- Pattern 3: fallback for local dev when `isLambda` is false (replaces current `devValidSession` default behavior — user can still pass a fallback)

**Files:**

- `src/sessionContext.ts` — add `"none"` variant to the valibot schema
- `src/authorize.ts` — export `AuthorizeResult` with `"none"` added
- `sveltekit.ts` — update `SessionContext` type, update `createSessionHandle` to return `{ type: "none" }` when authorizer context is missing

---

## Change 1: `authorizerCache: "disabled"` option

In `cdk.ts`, update `resolveAuthorizerCacheTtl` and the authorizer creation to support a new `"disabled"` option:

- `"disabled"` → sets `resultsCacheTtl: Duration.seconds(0)` AND removes `identitySource`
- All other values keep `identitySource: ["$request.header.Cookie"]` as-is

**Implementation:**

- The `AuthGateway` constructor needs to conditionally pass `identitySource` based on the cache setting
- Refactor: extract authorizer creation into a helper that accepts the resolved config

**File:** `cdk.ts`

---

## Change 2: `createInProcessSessionHandle()`

New function in `sveltekit.ts` that resolves sessions directly from DynamoDB inside the SvelteKit handle hook.

```typescript
interface InProcessSessionHandleOptions {
  /**
   * Session to use when not running in Lambda (local dev, preview).
   * @default devValidSession
   */
  fallbackSession?: SessionContext;
}

export function createInProcessSessionHandle(options?: InProcessSessionHandleOptions): Handle {
  // Instantiate SessionAuthorizer (reads env vars, connects to DynamoDB)
  // On each request:
  //   1. Read cookie from event.request.headers
  //   2. Call authorizer.authorize(headers)
  //   3. Populate event.locals.session
  //   4. After resolve(), set Set-Cookie headers on response
}
```

**Dependencies:**

- Uses `SessionAuthorizer` class from `sessionAuthorizer.ts`
- Reads env vars: `BEESOLVE_AUTH_SESSIONS_TABLE_NAME`, `BEESOLVE_AUTH_SESSIONS_USER_ID_INDEX_NAME`, `BEESOLVE_AUTH_SESSION_MAX_AGE`, `BEESOLVE_AUTH_SESSION_REFRESH_DRIFT`
- When `isLambda` is false, uses fallback session (same as `createSessionHandle`)

**File:** `sveltekit.ts`

---

## Change 3: `createSessionHandle()` update

Update the existing `createSessionHandle` to handle missing authorizer context gracefully:

- When authorizer context is present → parse and return session (valid/invalid/expired)
- When authorizer context is missing → return `{ type: "none" }`
- This is NOT a try/catch — use the `hasLambdaAuthorizer` check from `lambda-fetch-api`'s authorizer module to determine if context exists before attempting to parse

**Approach:** Add a new function to `lambda-fetch-api` (or use existing primitives) that checks whether authorizer context is present without throwing. Then in `getSessionContext`:

```typescript
export function getSessionContext(): SessionContext {
  const event = getAwsEvent();

  if (!hasAuthorizerContext(event)) {
    return { type: "none" };
  }

  // existing parsing logic
}
```

This requires either:

- Exporting `hasLambdaAuthorizer` from `lambda-fetch-api` (currently internal)
- Or adding a `getAwsLambdaAuthorizerContextOrNull()` variant

**Decision:** Add a `hasAuthorizerContext()` export to `lambda-fetch-api` that returns boolean. Keep it simple.

**Files:**

- `packages/lambda-fetch-api/src/authorizer.ts` — export `hasAuthorizerContext()`
- `packages/service-auth/src/sessionContext.ts` — update `getSessionContext()` to check before parsing

---

## Change 4: `auth.grantSessionAccess(handler)` on AuthGateway

New method on `AuthGateway` CDK construct:

```typescript
/**
 * Grants the provided Lambda function direct access to the sessions table
 * for in-process session resolution. Use this when the Lambda handler calls
 * `createInProcessSessionHandle()` from `@beesolve/auth-service/sveltekit`
 * instead of relying on the HTTP API Gateway Lambda authorizer.
 *
 * This is the recommended approach for SvelteKit SSR applications where
 * a single Lambda invocation per request is preferred over the authorizer
 * pattern (which requires two Lambda invocations).
 *
 * Grants: DynamoDB read/write on sessions table.
 * Sets env vars: BEESOLVE_AUTH_SESSIONS_TABLE_NAME,
 *   BEESOLVE_AUTH_SESSIONS_USER_ID_INDEX_NAME,
 *   BEESOLVE_AUTH_SESSION_MAX_AGE,
 *   BEESOLVE_AUTH_SESSION_REFRESH_DRIFT
 */
readonly grantSessionAccess = (handler: Function) => {
  this.sessionsTable.grantReadWriteData(handler);
  handler.addEnvironment("BEESOLVE_AUTH_SESSIONS_TABLE_NAME", this.sessionsTable.tableName);
  handler.addEnvironment("BEESOLVE_AUTH_SESSIONS_USER_ID_INDEX_NAME", this.sessionsByUserIdIndexName);
  handler.addEnvironment("BEESOLVE_AUTH_SESSION_MAX_AGE", this.sessionMaxAge);
  handler.addEnvironment("BEESOLVE_AUTH_SESSION_REFRESH_DRIFT", this.sessionRefreshDrift);
};
```

**Note:** This requires exposing `sessionsTable`, `sessionsByUserIdIndexName`, `sessionMaxAge`, and `sessionRefreshDrift` as private fields on `AuthGateway` (some may already be accessible via the tables created in the constructor).

**File:** `cdk.ts`

---

## Change 5: Documentation

### README section: "Integration Patterns"

Add to `packages/service-auth/README.md`:

#### Pattern 1: SPA + HttpApi + Lambda Authorizer (cached)

- Static frontend (S3/CloudFront) with separate API Lambda
- `addAuthorizedEndpoint({ lambda: apiHandler })` on `/api/{proxy+}`
- Gateway returns 401 for unauthenticated API calls → SPA handles client-side
- Authorizer caching enabled via cookie identity source
- Best for: React/Vue/Svelte SPAs with a REST API backend

#### Pattern 2: SSR + HttpApi + Lambda Authorizer (no caching)

- SvelteKit on Lambda via kit-on-lambda
- `addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" })` with `authorizerCache: "disabled"`
- Authorizer always invoked (no identity source requirement)
- SvelteKit uses `createSessionHandle()` to read authorizer context
- App handles redirects for unauthenticated users
- Pros: clean separation — only authorizer Lambda accesses sessions table
- Cons: 2 Lambda invocations per request, no caching
- Best for: when strict data access separation is required

#### Pattern 3: SSR + In-process session resolution (recommended for SSR)

- SvelteKit on Lambda via kit-on-lambda
- `addPublicEndpoint({ lambda: handler })` + `grantSessionAccess(handler)`
- SvelteKit uses `createInProcessSessionHandle()` — resolves session from DynamoDB directly
- App handles redirects for unauthenticated users
- Pros: single Lambda invocation, lowest latency
- Cons: SvelteKit handler has DynamoDB access to sessions table
- Best for: most SvelteKit SSR applications

### kit-on-lambda README addition

Link to service-auth documentation:

> For adding authentication to your SvelteKit app, see [@beesolve/auth-service integration patterns](link).

---

## Change 6: ADRs

### ADR: SSR apps cannot use cached Lambda authorizer

**File:** `packages/service-auth/docs/adr-ssr-authorizer-pattern.md`

**Content summary:**

- Decision: SSR (kit-on-lambda) apps should NOT use the cached Lambda authorizer pattern
- Context: HTTP API Gateway with `identitySource` returns 401 before the Lambda is called when the cookie header is missing. SSR apps need the server to handle unauthenticated requests to issue redirects. SPAs handle 401 client-side.
- Consequence: Two alternative patterns provided for SSR — authorizer without caching (pattern 2) or in-process resolution (pattern 3)
- Status: Accepted

### ADR: In-process session resolution for SvelteKit

**File:** `packages/service-auth/docs/adr-inprocess-session-resolution.md`

**Content summary:**

- Decision: Provide `createInProcessSessionHandle()` that resolves sessions from DynamoDB directly within the SvelteKit handle hook
- Context: Pattern 2 (authorizer without caching) requires 2 Lambda invocations per request. For most SSR apps, the simpler approach is to resolve the session in-process. DynamoDB single-item reads are single-digit milliseconds. In-memory caching was considered but rejected — the added complexity of cache invalidation (session rotation changes SID) isn't worth the marginal latency improvement given Lambda's scaling model (each instance has isolated memory).
- Consequence: The SvelteKit handler Lambda gets DynamoDB read/write access to the sessions table. This is acceptable because the handler already has `grantSdkAccess` for other auth operations.
- Status: Accepted

---

## Changes to `lambda-fetch-api`

### Export `hasAuthorizerContext()`

Add to `src/authorizer.ts`:

```typescript
/**
 * Returns true if the current Lambda event contains authorizer context
 * (either v1 REST API or v2 HTTP API format).
 */
export function hasAuthorizerContext(): boolean {
  const event = getAwsEvent();
  if (isAPIGatewayProxyEventV2(event)) {
    return hasLambdaAuthorizer(event.requestContext);
  }
  return hasAuthorizer(event.requestContext);
}
```

Export from `index.ts`.

**File:** `packages/lambda-fetch-api/src/authorizer.ts`, `packages/lambda-fetch-api/index.ts`

---

## Sample: `authEmailSimple` (pattern 3)

### `stack.ts`:

```typescript
const site = new SvelteKit(this, "Site", {
  runtime: "node",
  invokeMode: InvokeMode.BUFFERED,
  buildDirectory: resolve(__dirname, "./site/build"),
  toDefaultOrigin: ({ handler }) => {
    auth.addPublicEndpoint({ lambda: handler });
    auth.grantSessionAccess(handler);
    auth.grantSdkAccess(handler);

    if (auth.api.url == null) throw Error(`Unexpected error - missing api url`);
    return new HttpOrigin(Fn.parseDomainName(auth.api.url));
  },
});
```

### `hooks.server.ts`:

```typescript
import { createInProcessSessionHandle } from "@beesolve/auth-service/sveltekit";
import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

const publicPaths = new Set(["/sign-in", "/sign-in/verify", "/sign-out"]);

const authGuard: Handle = async ({ event, resolve }) => {
  if (event.locals.session.type !== "valid" && !publicPaths.has(event.url.pathname)) {
    redirect(303, "/sign-in");
  }
  return resolve(event);
};

export const handle = sequence(createInProcessSessionHandle(), authGuard);
```

---

## Future sample: authorizer-based (pattern 2)

A second sample (e.g. `authEmailAuthorizer/`) demonstrating pattern 2 with:

- `authorizerCache: "disabled"` on AuthGateway
- `addAuthorizedEndpoint` on `/{proxy+}`
- `createSessionHandle()` reading from authorizer context
- Same auth guard pattern

Not implementing now — tracked for later.

---

## Implementation order

1. `lambda-fetch-api`: export `hasAuthorizerContext()`
2. `service-auth/src/sessionContext.ts`: add `"none"` state, update `getSessionContext()` to use `hasAuthorizerContext()`
3. `service-auth/sveltekit.ts`: add `createInProcessSessionHandle()`, update `createSessionHandle()`
4. `service-auth/cdk.ts`: add `authorizerCache: "disabled"` option, add `grantSessionAccess()`
5. `service-auth/docs/`: write ADRs
6. `service-auth/README.md`: document all 3 patterns
7. `samples/authEmailSimple/`: update stack.ts and hooks.server.ts to use pattern 3
8. `kit-on-lambda`: add link to service-auth docs
9. Deploy and test the sample

---

## Out of scope

- In-memory session caching in Lambda (rejected — not worth the complexity)
- Pattern 2 sample (deferred to later)
- Passkeys integration (separate track)
