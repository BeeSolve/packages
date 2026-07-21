# @beesolve/auth-service

Email-code authentication system backed by AWS DynamoDB and EventBridge, deployable via CDK. Ships three Lambda handlers (API, authorizer, SDK bridge) and a framework-agnostic CDK construct that wires them together with API Gateway, DynamoDB tables, and IAM permissions.

## Purpose

The package implements a passwordless, email-code ("magic code") sign-in flow:

1. The user submits their email address → an OTP code is generated and an `EmailCodeAuth` EventBridge event is emitted (your consumer sends the email).
2. The user submits the code they received → the session is created and a `__Host-SID` cookie is set.
3. A Lambda authorizer validates the session cookie on every subsequent request and refreshes the session transparently.

The auth logic is framework-agnostic — the API handler uses the standard Web `Request`/`Response` API so it can be adapted to any runtime. The CDK construct manages all AWS wiring so consumers only need to provide a frontend URI and a stage name.

## Installation

```sh
npm install @beesolve/auth-service
# or
bun add @beesolve/auth-service
```

## Usage

### 1 — Infrastructure (CDK)

Import from `@beesolve/auth-service/cdk` and add the `Auth` construct to your stack.

```ts
import { Auth } from "@beesolve/auth-service/cdk";

const auth = new Auth(this, "Auth", {
  stage: "prod",
  frontendUri: "https://app.example.com",
  allowSignUp: true,
});
```

The construct provisions:

- **DynamoDB tables** — `Sessions` (with a userId GSI) and `Accounts` (with a reverse-lookup GSI).
- **Three Lambda functions** — the auth API handler, a Lambda authorizer, and an SDK bridge handler.
- **Function URL** (`authUrl`) — an IAM-protected endpoint for `signInRequest`, `signInComplete`, `resendCode`, and `signOut`. Access is restricted via CloudFront Origin Access Control (OAC).
- **Lambda@Edge** — computes `x-amz-content-sha256` for POST body SigV4 signing.
- **`authBehavior`** — a ready-to-use CloudFront `BehaviorOptions` object that wires the OAC origin and Lambda@Edge together.
- **`createAuthBehavior(scope)`** — creates the behavior with the edge function scoped to the provided construct, avoiding cross-stack CloudFormation export issues.
- **HTTP API** (`api`) — an API Gateway HTTP API with the Lambda authorizer attached, used for all routes that require a valid session.

#### Optional props

| Prop                            | Type               | Description                                                                                                 |
| ------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `alarms`                        | `EmailAlarms`      | Attach a `@beesolve/cdk-email-alarms` instance to report Lambda errors by email.                            |
| `eventBusArn`                   | `string`           | ARN of a custom EventBridge bus. Defaults to the `default` bus.                                             |
| `warmer`                        | `LambdaKeepActive` | Pass a `@beesolve/lambda-keep-active` instance to keep handlers warm.                                       |
| `eventSource`                   | `string`           | EventBridge source for all auth events. Defaults to `"beesolve.auth.api"`.                                  |
| `dataToken`                     | `boolean`          | When `true`, reads `__Host-DataToken` cookie on sign-in and fires a `DataToken` event. Defaults to `false`. |
| `logGroupProps`                 | `LogGroupProps`    | Override Lambda log group configuration. Defaults to `RemovalPolicy.DESTROY` / 2-week retention.            |
| `encryptionKey`                 | `IKey`             | Customer-managed KMS key for all data-at-rest resources (DynamoDB tables and SQS queues).                   |
| `contributorInsights`           | `boolean`          | CloudWatch Contributor Insights on DynamoDB tables. Defaults to `true` in prod.                             |
| `accessLogging`                 | `boolean`          | Access logging on the HTTP API. Creates a CloudWatch Log Group. Defaults to `true` in prod.                 |
| `authorizerReservedConcurrency` | `number`           | Reserved concurrent executions for the authorizer Lambda.                                                   |
| `sdkHandlerReservedConcurrency` | `number`           | Reserved concurrent executions for the SDK handler Lambda.                                                  |
| `resendCooldown`                | `Duration`         | Minimum time between code generations for the same email. Defaults to `Duration.seconds(60)`.               |
| `drainOnResend`                 | `boolean`          | Whether the previous OTP token is invalidated on resend. Defaults to `true`.                                |

> [!TIP]
> When deploying in a VPC, add a DynamoDB VPC Gateway Endpoint to keep traffic off the public internet. Gateway endpoints are free.

#### Adding authorized endpoints

```ts
import { Function } from "aws-cdk-lib/aws-lambda";

// Wire any Lambda behind the session-cookie authorizer
auth.addAuthorizedEndpoint({
  lambda: myApiLambda, // your Lambda
  path: "/api/{proxy+}", // optional, defaults to "/api/{proxy+}"
  methods: [HttpMethod.ANY], // optional, defaults to ANY
});
```

#### Granting SDK access

```ts
// Gives myLambda permission to invoke the SDK bridge and injects
// BEESOLVE_AUTH_SDK_HANDLER_ARN into its environment
auth.grantSdkAccess(myLambda);
```

#### Cross-stack usage

When the CloudFront distribution lives in a different stack, use `createAuthBehavior(scope)` instead of `authBehavior` to avoid CloudFormation cross-stack export issues with Lambda@Edge version ARNs:

```ts
// In a different stack from the Auth construct:
const behavior = auth.createAuthBehavior(this);
distribution.addBehavior("/auth/*", behavior.origin, behavior);
```

### 2 — Auth flow (client side)

The core design principle of this package is **same-domain, cookie-based authorization**. Your frontend, the auth endpoints, and your API all run behind a single CloudFront distribution at one domain (e.g. `app.example.com`). CloudFront routes `/auth/*` to the Lambda function URL and all other paths to your application and API.

Because every request — page loads, auth calls, API calls — shares the same origin, the `__Host-SID` session cookie set by the auth handler is automatically included by the browser on every subsequent API request. There is no cross-origin cookie handling, no token plumbing in your frontend code, and no CORS configuration needed between your app and the API.

Use `auth.authBehavior` to add the `/auth/*` behavior to your CloudFront distribution — it includes the OAC-signed origin and Lambda@Edge for body hashing. See [docs/cloudfront.md](docs/cloudfront.md) for a complete CDK example.

All endpoints expect `POST`, `Content-Type: application/json`.

```mermaid
sequenceDiagram
    participant Browser
    participant CloudFront
    participant AuthLambda

    Browser->>CloudFront: POST /auth/signInRequest {emailAddress}
    CloudFront->>AuthLambda: OAC-signed request
    AuthLambda-->>CloudFront: 200 {token, referenceCode, canResendAt, expiresAt}
    CloudFront-->>Browser: 200

    Note over Browser: User receives code via email

    Browser->>CloudFront: POST /auth/signInComplete {token, code, redirectTo}
    CloudFront->>AuthLambda: OAC-signed request
    AuthLambda-->>CloudFront: 301 + Set-Cookie: __Host-SID, aSID
    CloudFront-->>Browser: 301 redirect → /dashboard
```

#### Sign-in request

```ts
const res = await fetch("/auth/signInRequest", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ emailAddress: "user@example.com" }),
});
const { token, referenceCode, canResendAt, expiresAt } = await res.json();
// save `token` for signInComplete or resendCode
```

This emits an `EmailCodeAuth` EventBridge event. Your event consumer should send the code to the user's email address.

#### Resend code

```ts
const res = await fetch("/auth/resendCode", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token }),
});
const { token: newToken, referenceCode, canResendAt, expiresAt } = await res.json();
// Replace stored token with newToken for signInComplete
```

Returns HTTP 429 if called before the cooldown (default 60s) has elapsed. The previous token is drained (invalidated) by default.

#### Sign-in complete

```ts
const res = await fetch("/auth/signInComplete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token, code: "123456", redirectTo: "/dashboard" }),
});
// 301 redirect with __Host-SID and aSID cookies set
```

#### Sign out

```ts
await fetch("/auth/signOut", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ redirectTo: "/" }),
});
// 301 redirect with __Host-SID cookie cleared
```

### 3 — SDK client (server-to-server)

Use `AuthClient` from `@beesolve/auth-service/sdk` inside Lambdas that have been granted SDK access via `grantSdkAccess`. The client reads `BEESOLVE_AUTH_SDK_HANDLER_ARN` from the environment automatically.

```ts
import { AuthClient } from "@beesolve/auth-service/sdk";

const auth = new AuthClient();

// Look up an account ID by email
const result = await auth.invoke({
  type: "accountIdByEmail",
  request: { emailAddress: "user@example.com" },
});
// result: { id: string } | null

// Create a new email account
const { id } = await auth.invoke({
  type: "newEmailAccount",
  request: { emailAddress: "new@example.com" },
});

// List active sessions for an account
const sessions = await auth.invoke({
  type: "sessionList",
  request: { accountId: id },
});

// Delete all sessions for an account (optionally keep one)
await auth.invoke({
  type: "deleteAllSessions",
  request: { accountId: id, exceptSessionId: "keep-this-one" },
});
```

### 4 — EventBridge events

All events are emitted on the configured event bus with source `"beesolve.auth.api"` (or the value of `eventSource`).

| `detail-type`          | Fired when                                | Key fields                                                                                                                                      |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `EmailCodeAuth`        | Sign-in requested or code resent          | `accountId` (null for new users), `code`, `expiresAt`, `emailAddress`, `referenceCode`, `baseUri`, `cookies`, `acceptLanguage`, `requestOrigin` |
| `EmailAddressVerified` | New account created on first sign-in      | `accountId`, `emailAddress`, `verifiedAt`                                                                                                       |
| `DataToken`            | Sign-in complete with `dataToken` enabled | `accountId`, `emailAddress`, `dataToken`                                                                                                        |
| `SuccessfulAuth`       | _(reserved)_                              | `userId`                                                                                                                                        |
| `UnsuccessfulAuth`     | Sign-in failed (invalid/expired code)     | `emailAddress`, `reason`                                                                                                                        |
| `SessionInvalidated`   | Sign out                                  | `sessionId`                                                                                                                                     |
| `EmailInvitation`      | _(reserved)_                              | `emailAddress`, `baseUri`                                                                                                                       |

> **Important**: `EmailCodeAuth` is the integration point for email delivery. Subscribe an EventBridge rule to this event and implement your own email-sending logic (e.g. using `@beesolve/service-email`).

### 5 — Public cookie utilities

The main export (`@beesolve/auth-service`) exposes the cookie helpers used internally, which are useful for server-side middleware:

```ts
import {
  addSetCookies,
  parseSid,
  parseDataTokenCookie,
  toDataTokenCookie,
} from "@beesolve/auth-service";

// Parse the session ID from a Cookie header
const sid = parseSid(request.headers.get("cookie")); // string | null

// Parse the data token from a Cookie header
const dataToken = parseDataTokenCookie(request.headers.get("cookie")); // string | null

// Build a data-token Set-Cookie string (Max-Age 900s, SameSite=Strict)
const setCookie = toDataTokenCookie("my-token");

// Append __Host-SID and aSID Set-Cookie headers (pass maxAge=-1 to clear)
addSetCookies({
  headers: responseHeaders,
  cookies: [{ sid: sessionId, maxAge: 2592000 }],
});
```

### 6 — Error types

The main export also exposes the HTTP error classes used by the API handler:

```ts
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "@beesolve/auth-service";
```

Each class extends `Error` and carries a `stringified: boolean` property that is `true` when the constructor received a non-string argument (the `message` is then `JSON.stringify(argument)`).

### 7 — Session middleware

```mermaid
sequenceDiagram
    participant Browser
    participant CloudFront
    participant APIGateway
    participant Authorizer
    participant YourLambda

    Browser->>CloudFront: GET /api/data (Cookie: __Host-SID=...)
    CloudFront->>APIGateway: forward request
    APIGateway->>Authorizer: invoke (Cookie header)
    Authorizer->>Authorizer: parse __Host-SID, lookup session in DynamoDB
    Authorizer-->>APIGateway: Allow + session context {userId, sessionId, type: "valid"}
    APIGateway->>YourLambda: invoke with authorizer context
    YourLambda-->>APIGateway: 200 response
    APIGateway-->>CloudFront: 200
    CloudFront-->>Browser: 200
```

The package exports `getSessionContext` which retrieves and validates the session from the Lambda authorizer context. It auto-detects HTTP API (v2) vs REST API (v1):

```ts
import { addSetCookies, getSessionContext } from "@beesolve/auth-service";

export async function handler(request: Request, resHeaders: Headers): Promise<Response> {
  const session = await getSessionContext();
  const userId = session.type === "valid" ? session.validSession.userId : null;

  // Forward session refresh/clear cookies to the response
  addSetCookies({ headers: resHeaders, cookies: session.setCookiesParams });

  if (userId == null) {
    return new Response("Unauthorized", { status: 401 });
  }

  return new Response(JSON.stringify({ userId }));
}
```

For explicit control over API version detection:

```ts
import { getSessionContextV1, getSessionContextV2 } from "@beesolve/auth-service";

// HTTP API (v2) — reads event.requestContext.authorizer.lambda
const session = await getSessionContextV2();

// REST API (v1) — reads event.requestContext.authorizer
const session = await getSessionContextV1();
```

### 8 — Usage with tRPC

When using `@trpc/server` with a fetch adapter, create a context factory that retrieves the session and forwards cookies:

```ts
// context.ts
import { addSetCookies, getSessionContext } from "@beesolve/auth-service";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

export async function createContext({ resHeaders }: FetchCreateContextFnOptions) {
  const session = await getSessionContext();
  const userId = session.type === "valid" ? session.validSession.userId : null;

  return {
    resHeaders: addSetCookies({ headers: resHeaders, cookies: session.setCookiesParams }),
    userId,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
```

Then use the context in your router:

```ts
// router.ts
import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

const authed = t.middleware(({ ctx, next }) => {
  if (ctx.userId == null) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

export const protectedProcedure = t.procedure.use(authed);
```

### 9 — Local development

In local dev (e.g., a Bun server), there is no API Gateway or Lambda authorizer. The `@beesolve/auth-service/dev` export provides `withDevSession` which wraps your fetch handler and injects a fake authorizer context, so `getSessionContext` works without AWS:

```ts
import { withDevSession } from "@beesolve/auth-service/dev";
import { serve } from "bun";
import api from "./api";

const devApi = withDevSession(api.fetch, { userId: "user-123" });

serve({
  routes: {
    "/api/*": (request) => devApi(request),
  },
});
```

`withDevSession` accepts:

- `handler` — your fetch handler (`(request: Request) => Promise<Response>`)
- `session` — an object with at least `userId`. Optionally provide `sessionId` and `expiresAt`.

The wrapper runs your handler inside `runWithAwsContext` with a fake API Gateway v2 event containing the session, so all middleware that reads from the authorizer context works transparently.

### 10 — SvelteKit Integration

Import from `@beesolve/auth-service/sveltekit` to wire up session handling in a SvelteKit app deployed with [kit-on-lambda](https://github.com/BeeSolve/kit-on-lambda).

Works with both HTTP API (v2) and REST API (v1) — auto-detected at runtime.

#### Integration Patterns

There are three deployment patterns depending on your frontend architecture:

##### Pattern 1: SPA + Lambda Authorizer (cached)

Static frontend (S3/CloudFront) with a separate API Lambda. The gateway returns 401 for unauthenticated API calls — the SPA handles this client-side.

```ts
// CDK
auth.addAuthorizedEndpoint({ lambda: apiHandler, path: "/api/{proxy+}" });
```

- Authorizer caching enabled via cookie identity source
- Best for: React/Vue/Svelte SPAs with a REST API backend

##### Pattern 2: SSR + Lambda Authorizer (cached) + CloudFront Function

SvelteKit on Lambda via kit-on-lambda. A CloudFront Function injects a placeholder cookie (`__Host-SID=anonym`) on requests where the cookie is absent, ensuring API Gateway's `identitySource` is always satisfied. The authorizer caches normally — anonymous requests cache to "session invalid" context, and the SSR app handles redirects.

```ts
// CDK
const site = new SvelteKit(this, "Site", {
  toDefaultOrigin: ({ handler }) => {
    auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" });
    auth.grantSdkAccess(handler);
    return new HttpOrigin(Fn.parseDomainName(auth.api.url!));
  },
});

// Attach ensureCookieFunction to the default behavior
const cfnDist = site.distribution.node.defaultChild as CfnDistribution;
cfnDist.addPropertyOverride("DistributionConfig.DefaultCacheBehavior.FunctionAssociations", [
  { EventType: "viewer-request", FunctionARN: auth.ensureCookieFunction.functionArn },
]);
```

```ts
// hooks.server.ts
import { createSessionHandle } from "@beesolve/auth-service/sveltekit";
export const handle = sequence(createSessionHandle(), authGuard);
```

- Pros: authorizer caching works, clean separation, no DynamoDB access on the handler
- Cons: 2 Lambda invocations per request (mitigated by caching on repeat requests)
- Best for: SSR apps that want authorizer separation with caching benefits

> **Important:** Add `@beesolve/lambda-fetch-api` to Vite's SSR externals in your
> `vite.config.ts` so that the `AsyncLocalStorage` instance is shared between the
> handler and hooks (prevents esbuild deduplication issues):
>
> ```ts
> export default defineConfig({
>   plugins: [sveltekit()],
>   ssr: {
>     external: ["@beesolve/lambda-fetch-api"],
>   },
> });
> ```

> **Note:** If you don't need authorizer caching and prefer to skip the CloudFront Function,
> set `authorizerCache: "disabled"` which removes the `identitySource` requirement entirely.
> The authorizer is then invoked on every request without caching.

##### Pattern 3: SSR + In-process session resolution (recommended for SSR)

SvelteKit on Lambda via kit-on-lambda. The handler resolves the session from DynamoDB directly — no authorizer Lambda involved.

```ts
// CDK
auth.addPublicEndpoint({ lambda: handler });
auth.grantSessionAccess(handler);
auth.grantSdkAccess(handler);
```

```ts
// hooks.server.ts
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

- Pros: single Lambda invocation, lowest latency
- Cons: SvelteKit handler has DynamoDB access to the sessions table
- Best for: most SvelteKit SSR applications

See [ADR-002](docs/adr-002-ssr-authorizer-pattern.md) and [ADR-003](docs/adr-003-inprocess-session-resolution.md) for the architectural reasoning.

#### Setup

**src/app.d.ts:**

```ts
import type { SessionContext } from "@beesolve/auth-service/sveltekit";

declare global {
  namespace App {
    interface Locals {
      session: SessionContext;
    }
  }
}

export {};
```

**src/hooks.server.ts:**

```ts
import { createSessionHandle } from "@beesolve/auth-service/sveltekit";
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

export const handle = sequence(createSessionHandle(), authGuard);
```

`createSessionHandle` populates `event.locals.session` on every request. On Lambda it reads the authorizer context; locally (when `LAMBDA_TASK_ROOT` is not set) it falls back to a dev preset.

#### Local development fallbacks

When running `vite dev` there is no Lambda authorizer. By default `createSessionHandle` provides a valid dev session. Switch presets to simulate other states:

```ts
import {
  createSessionHandle,
  devExpiredSession,
  devInvalidSession,
  devNoneSession,
  devValidSession,
} from "@beesolve/auth-service/sveltekit";

// Simulate an expired session locally
export const handle = sequence(
  createSessionHandle({ fallbackSession: devExpiredSession }),
  authGuard,
);
```

Available presets: `devValidSession` (default), `devInvalidSession`, `devExpiredSession`, `devNoneSession`.

You can also provide a custom fallback:

```ts
export const handle = sequence(
  createSessionHandle({
    fallbackSession: {
      type: "valid",
      validSession: { userId: "ivan", sessionId: "abc", expiresAt: "2099-01-01T00:00:00Z" },
      setCookiesParams: [],
    },
  }),
  authGuard,
);
```

#### Accessing the session in routes

```ts
// +page.server.ts
import { redirect } from "@sveltejs/kit";

export function load({ locals }) {
  if (locals.session.type !== "valid") {
    redirect(303, "/sign-in");
  }

  return { userId: locals.session.validSession.userId };
}
```

#### Direct access to session context

For advanced use cases where you need full control over v1/v2 detection:

```ts
import {
  getSessionContext,
  getSessionContextV1,
  getSessionContextV2,
} from "@beesolve/auth-service/sveltekit";

// Auto-detect (recommended)
const session = await getSessionContext();

// Explicit v2 (HTTP API)
const session = await getSessionContextV2();

// Explicit v1 (REST API)
const session = await getSessionContextV1();
```

These functions work anywhere within a Lambda invocation (hooks, load functions, API routes) because the context is stored in `AsyncLocalStorage` by `@beesolve/lambda-fetch-api`.

## FAQ

**Q: How does the authorizer work?**

The Lambda authorizer is attached to API Gateway as a `HttpLambdaAuthorizer` with a configurable result cache keyed on `$request.header.Cookie`. On each request it parses `__Host-SID` from the cookie, fetches the session from DynamoDB, and returns the session state to downstream Lambdas as `event.requestContext.authorizer.lambda.session`.

**The authorizer always returns `Effect: "Allow"`** — this is intentional. Session state (`"valid"`, `"expired"`, or `"invalid"`) is serialized into the authorizer context, and enforcement happens at the handler level. This design allows handlers to differentiate between anonymous, expired, and authenticated requests (e.g., showing different content or returning a specific error).

To enforce authentication in your handlers, use `getSessionContext` and check `session.type` (see section 7).

**Q: What does `allowSignUp` control?**

When `allowSignUp: false`, users who complete the OTP flow but have no existing account receive a `400 BadRequest` (`"Email not registered."`). Set it to `true` to auto-create an account on first sign-in.

**Q: What is the `dataToken` feature?**

When `dataToken: true` is set on the CDK construct, the auth API reads a `__Host-DataToken` cookie from the sign-in request. On successful authentication it fires a `DataToken` EventBridge event containing the account ID, email, and the raw token value. This enables anonymous-to-authenticated data handoff (e.g. linking an anonymous shopping cart to a user account).

**Q: Can I use a custom EventBridge bus?**

Yes. Pass `eventBusArn` to the CDK construct. If omitted, the `default` event bus is used.

**Q: Why do client examples use relative URLs with no base address?**

Everything — the frontend, `/auth/*` endpoints, and `/api/*` routes — is served from a single CloudFront distribution on one domain. Because the browser is already on that domain, relative paths like `/auth/signInRequest` resolve to the same origin automatically. This also means `credentials: "include"` is unnecessary (same-origin requests include cookies by default) and there is zero CORS configuration. The `__Host-SID` cookie "just works" because the cookie's origin matches every request the browser makes.

**Q: Why does `signInComplete` return a redirect instead of JSON?**

The redirect (HTTP 301) sets `__Host-SID` and `aSID` cookies as part of the response. This allows the browser to store the session cookie in a single round-trip, then follow the redirect to the destination page.

**Q: Why are session cookies prefixed with `__Host-`?**

The `__Host-` prefix is a browser security mechanism. Browsers refuse to set or send a `__Host-` cookie unless it is `Secure`, has no `Domain` attribute, and has `Path=/`. This means:

- The cookie cannot be set by a subdomain or a non-HTTPS response — the server can be confident the value came from the exact first-party origin it set it on.
- `__Host-SID` is also `HttpOnly`, so JavaScript running in the browser (including third-party scripts) can never read the session token via `document.cookie`. Even if an XSS attack injects a script, the session token is not exfiltrated.

**Q: How does the frontend know if the user is logged in if `__Host-SID` is hidden from JavaScript?**

The `aSID` companion cookie is set alongside `__Host-SID` on every session change. Unlike `__Host-SID`, `aSID` is not `HttpOnly`, so client-side JavaScript can read it. It holds `1` when a session is active and `0` (or a negative `Max-Age`) when the session is cleared. Your frontend reads `aSID` to show or hide the logged-in UI state — it never sees the real session token.

For **SPA (Single Page Application)** deployments where there is no SSR to check session state server-side, `aSID` is the primary mechanism for client-side auth-aware routing:

```ts
// Check if the user has an active session
function isAuthenticated(): boolean {
  return document.cookie.includes("aSID=1");
}

// Example: redirect away from /sign-in if already authenticated
if (isAuthenticated()) {
  router.replace("/");
}

// Example: redirect to /sign-in if not authenticated
if (!isAuthenticated()) {
  router.replace("/sign-in");
}
```

> **Important:** `aSID` is a UI hint, not a security boundary. The actual session validity is enforced server-side by the Lambda authorizer or in-process session resolution. A tampered `aSID` cookie cannot grant access — it only affects what the client renders before the next server round-trip.

**Q: What are the session expiry and refresh rules?**

Sessions expire after 30 days (`defaultMaxAge = 2_592_000` seconds). The authorizer refreshes the session on every request older than 15 seconds. A refresh creates a new session row and short-expires the old one, so the window where both are valid is at most 30 seconds.

**Q: Which account types are supported?**

Currently only `email`. The schema includes `phone` and `passkey` as reserved values for future extension, but no handlers implement them yet.

**Q: What is the reference code?**

A random 10-byte base64url string generated alongside every OTP (both initial sign-in and resend). It's returned in the API response and included in the `EmailCodeAuth` event so you can display it in the email subject or body. This helps users identify which email corresponds to their sign-in attempt when multiple codes are in-flight.

**Q: What format are date fields in?**

All date fields (`expiresAt`, `createdAt`, `startedAt`, `updatedAt`) returned by the authorizer and SDK are ISO 8601 timestamp strings. Use `Date.parse(value)` for comparisons or `new Date(value)` to convert.

**Q: How does OAC protect the auth endpoint?**

CloudFront Origin Access Control signs requests to the Lambda function URL using SigV4. The function URL has `AuthType: AWS_IAM`, so direct access without a valid SigV4 signature is rejected at the IAM layer — the Lambda is never invoked. For POST requests, a Lambda@Edge function computes the body hash (`x-amz-content-sha256`) automatically. This is already wired into `auth.authBehavior`.
