# Plan: Extract auth into publishable packages

## Context

The `bewatr-reporting` repo contains an email-code auth system spread across two packages:
- `packages/auth` (now `packages/service-auth`) — full auth system (sessions, accounts, sign-in/out handlers, CDK construct, SDK)
- `packages/action-tokens` — generic one-time token store used by auth for OTP codes

The goal is to extract both into this repo as independently published packages so they can be reused by any project (SvelteKit, tRPC, TanStack Router, etc.) that deploys to AWS via CDK.

## Decisions

- **Email sending**: EventBridge. Auth emits an `EmailCodeAuth` event; the consuming app sets up its own handler to send the email (likely using `@beesolve/email-service`). No direct coupling to any email provider in the package.
- **`action-tokens`**: Separate publishable package (`@beesolve/action-tokens`), not bundled into auth.
- **`lambda-keep-active`**: External npm package (separate GitHub repo). Made optional on the CDK construct.
- **`cdk-email-alarms`**: Already in this repo. Made optional on the CDK construct.
- **`dataToken`**: Kept as an optional CDK prop (see below for explanation).
- **Lambda bundling**: Three Lambda handlers bundled as separate `.zip` files at build time so consumers do not need a build step when synth-ing CDK.
- **Versioning**: Packages versioned and released independently.

## The `dataToken` concept

`dataToken` solves the anonymous-to-authenticated data transfer problem. Pattern:

1. An unauthenticated user does something on the app (fills a form, configures a draft, adds items to a cart).
2. The app assigns them an opaque identifier and stores it in a short-lived `__Host-DataToken` cookie (15-minute expiry, HttpOnly, SameSite=Lax).
3. When the user signs in, `signInComplete` reads that cookie and fires a `DataToken` EventBridge event:
   ```json
   { "accountId": "...", "emailAddress": "...", "dataToken": "the-opaque-id" }
   ```
4. The consuming app listens for `DataToken` events and merges the anonymous data into the now-authenticated account.

This is useful for any pre-login flow: onboarding wizards, guest carts, anonymous report builds (hence its presence in bewatr-reporting). It is optional — if `dataToken: false` (the default), the cookie is never read and no event is fired.

The `toDataTokenCookie` and `parseDataTokenCookie` helpers are exported from the package root so the consuming app's SSR layer (SvelteKit hook, tRPC middleware, etc.) can set and read the cookie independently of auth's Lambda handler.

**This concept must be documented in the `@beesolve/auth-service` package README.md**, including the cookie name, the EventBridge event shape, and a usage example.

## Packages to create

### `packages/action-tokens` → `@beesolve/action-tokens`

Near-verbatim copy from bewatr-reporting. Minimal changes.

**Files:**
```
packages/action-tokens/
  model.ts        ← DynamoDB token store (create / use / drain)
  cdk.ts          ← ActionTokens CDK construct (DynamoDB table + GSI)
  sdk.ts          ← ActionTokensClient (auto-injected env vars from CDK)
  build.ts        ← esbuild + dts bundler
  package.json
  tsconfig.json
```

**Exports:** `/cdk`, `/sdk`, `/model`

**Dependencies:** `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/credential-providers`, `aws-cdk-lib`, `constructs`, `valibot`

No changes needed to the logic.

---

### `packages/service-auth` → `@beesolve/auth-service`

Copy from bewatr-reporting with targeted adaptations listed below.

**Files:**
```
packages/service-auth/
  cdk.ts           ← Auth CDK construct (adapted — see changes below)
  sdk.ts           ← AuthClient, Lambda-to-Lambda (unchanged)
  api.ts           ← Lambda: signInRequest / signInComplete / signOut
  authorizer.ts    ← Lambda: API Gateway HTTP authorizer
  sdkHandler.ts    ← Lambda: internal SDK bridge
  index.ts         ← re-exports cookie helpers for SSR use
  src/
    account.ts     ← Accounts DynamoDB model
    cookie.ts      ← cookie helpers (addSetCookies, parseSid, dataToken helpers)
    dynamo.ts      ← DynamoDB client factory
    errors.ts      ← typed error classes
    events.ts      ← EventBridge event emitter + event type definitions
    session.ts     ← Sessions DynamoDB model (create / refresh / delete)
    handlers/
      signInRequest.ts
      signInComplete.ts
      signOut.ts
    request.ts
    user.ts
    util.ts
    validation.ts
  build.ts         ← bundles 3 lambda zips + dts
  package.json
  tsconfig.json
```

**Exports:** `/cdk`, `/sdk`, package root (cookie helpers)

**Dependencies:**
- `@beesolve/action-tokens` (workspace, then published)
- `@beesolve/helpers`, `@beesolve/cdk-constructs`, `@beesolve/cdk-email-alarms` (this repo)
- `@beesolve/lambda-fetch-api` (this repo)
- `@beesolve/lambda-keep-active` (external npm)
- AWS SDKs, `aws-cdk-lib`, `constructs`, `valibot`

**Changes from bewatr-reporting version:**

#### 1. `cdk.ts` — optional `alarms` and `warmer` props

```ts
// before (required)
readonly alarms: EmailAlarms;
readonly warmer: LambdaKeepActive;

// after (optional)
readonly alarms?: EmailAlarms;
readonly warmer?: LambdaKeepActive;
```

Calls to `props.alarms.reportLambdaErrors(fn)` and `props.warmer.keepActive(fn)` become conditional.

#### 2. `cdk.ts` — configurable EventBridge source

```ts
readonly eventSource?: string; // default: "beesolve.auth.api"
```

Passed to `AuthHandler` Lambda as `EVENT_SOURCE` env var.

#### 3. `events.ts` — pass request metadata in `EmailCodeAuth` event instead of pre-parsed locale

The current implementation reads a specific cookie (`PARAGLIDE_LOCALE`) and sends `preferredLocale` in the event. This is too opinionated — the consuming app might use a different i18n library, or prefer `Accept-Language`, or use a URL-based locale, or need other request context entirely.

**New approach**: pass raw request metadata in the `EmailCodeAuth` event and let the email handler extract whatever it needs.

```ts
interface EmailCodeAuth {
  readonly type: "EmailCodeAuth";
  readonly detail: {
    readonly accountId: string | null;
    readonly code: string;
    readonly expiresAt: string;
    readonly emailAddress: string;
    readonly baseUri: string;
    /** Parsed cookies from the sign-in request, keyed by cookie name. */
    readonly cookies: Record<string, string>;
    /** Value of the Accept-Language header from the sign-in request, if present. */
    readonly acceptLanguage: string | null;
  };
}
```

The email handler can then extract its locale signal however it wants: read `cookies["PARAGLIDE_LOCALE"]`, parse `acceptLanguage`, or ignore both. The `LOCALE_COOKIE_NAME` env var and the locale-extraction logic are removed from `api.ts` entirely.

Note: the `__Host-SID` and `__Host-DataToken` cookies should be stripped before putting cookies into the event — no need to leak session or transfer-token values into EventBridge.

#### 4. `cdk.ts` — optional `dataToken` prop

```ts
readonly dataToken?: boolean; // default: false
```

When `false`, the auth handler never reads the `__Host-DataToken` cookie and never fires the `DataToken` event.

#### 5. `src/account.ts` — account type extensibility

The `accountTypes` tuple `["email", "phone", "passkey"]` stays as-is. Only `email` is implemented now; `phone` and `passkey` are placeholders for future work. No changes needed.

#### 6. `build.ts` — bundle 3 Lambda zips

The build step must produce:
- `dist/api.zip`
- `dist/authorizer.zip`
- `dist/sdkHandler.zip`
- `dist/*.d.ts` (type declarations for cdk.ts, sdk.ts, index.ts)

The CDK construct references zips via `fileURLToPath(new URL(".", import.meta.url))` (same pattern as `service-email`).

## Migration steps

1. ✅ Create `packages/action-tokens` with package.json, build.ts, exports.
2. ✅ Wire `action-tokens` into bun workspace and verify it builds + type-checks.
3. ✅ Create `packages/service-auth` with all source files and adaptations.
4. ✅ Wire `auth` into bun workspace.
5. Write tests for `src/` domain logic (session refresh, cookie parsing, token use).
6. Publish both packages.
7. Update `bewatr-reporting` to consume from npm instead of workspace.

## Implementation notes

### `tsconfig.lambda.json`
Lambda handler files (`api.ts`, `authorizer.ts`, `sdkHandler.ts`, `build.ts`) live in a separate `tsconfig.lambda.json` in the auth package. TypeScript 6 raises `TS2883` on the inferred type of exported `handler` symbols when declaration mode is active (even with `noEmit`), because the type resolves through `lambda-fetch-api`'s nested `node_modules/@types/aws-lambda`. Keeping lambda files out of the main `tsconfig.json` avoids this without losing type coverage — `type-check` runs both configs.

### Lambda zip build
`build.ts` in auth uses `esmBuild` from `@beesolve/cdk-constructs` to bundle each handler into `dist-lambda/<name>/`, then zips into `dist/<name>.zip`. The `prepublishOnly` script runs this after `bunup` has already produced the JS/DTS exports. CDK references the zips via `fileURLToPath(new URL(".", import.meta.url))` (same pattern as `service-email`).

### `@aws-sdk/credential-providers` in catalog
Added to root workspace catalog so both `action-tokens` and `auth` can reference it with `catalog:`.

## Framework usage notes

The auth system is already framework-agnostic at the Lambda layer (uses standard `Request`/`Response`). For a SvelteKit app:

- **Sign-in / sign-out**: Call `authUrl` (Lambda Function URL) from a SvelteKit `+server.ts` POST route — proxy the request, forward the `Set-Cookie` response headers.
- **Session validation in hooks**: Use `AuthClient` (or read the `__Host-SID` cookie + call the SDK bridge Lambda) from `hooks.server.ts`.
- **Authorized API routes**: Route SvelteKit API calls through the `api` HttpApi Gateway, or invoke authorized Lambdas directly via `grantSdkAccess`.
- **dataToken**: Set `__Host-DataToken` from SvelteKit server-side before redirecting to the sign-in page; read it back using `parseDataTokenCookie` from the package root.
