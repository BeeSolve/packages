# ADR: Extract Email-Code Auth into Publishable Packages

**Status:** Accepted  
**Date:** 2026-05-22  
**Packages:** `@beesolve/action-tokens`, `@beesolve/auth-service`

---

## Context

The codebase contained a full email-code authentication system spread across two internal packages. The system had value beyond a single project: any AWS/CDK app needing passwordless email sign-in would need to re-implement it. The goal was to extract both packages into this repo and publish them independently to npm.

The extraction required several design decisions about where to draw boundaries and how opinionated the packages should be.

---

## Decisions

### 1. Email delivery via EventBridge, not direct

The auth handler does not send emails. Instead it emits an `EmailCodeAuth` EventBridge event containing the OTP code, expiry, and email address. The consuming app sets up its own EventBridge rule and handler (typically using `@beesolve/email-service`) to send the email.

This keeps the auth package free of any email provider dependency and lets each consuming app control email templating, locale, and delivery independently.

### 2. `action-tokens` as a separate published package

The one-time token store (create / use / drain, backed by DynamoDB) is published as `@beesolve/action-tokens` rather than bundled into `@beesolve/auth-service`. It is a general-purpose primitive — useful for any flow that needs short-lived, single-use tokens — and its own CDK construct and SDK client are independently consumable.

### 3. Pre-built Lambda zips distributed in `dist/`

Three Lambda handlers (`api.zip`, `authorizer.zip`, `sdkHandler.zip`) are bundled at publish time and included in the package's `dist/`. Consumers reference them via `fileURLToPath(new URL(".", import.meta.url))` in CDK. This means consumers have no build step when synthesising CDK — they do not need esbuild, a bundler config, or Node.js source access.

### 4. Request metadata in `EmailCodeAuth`, not opinionated locale extraction

The original implementation extracted a specific `PARAGLIDE_LOCALE` cookie and sent `preferredLocale` in the event. This was too opinionated — different consuming apps use different i18n libraries, URL-based locales, or `Accept-Language`.

Instead, the event carries raw request metadata:

```ts
interface EmailCodeAuth {
  readonly cookies: Record<string, string>; // stripped of __Host-SID and __Host-DataToken
  readonly acceptLanguage: string | null;
  readonly requestOrigin: string | null;
}
```

The email handler extracts whatever signal it needs. `LOCALE_COOKIE_NAME` env var and locale logic are removed from the auth handler entirely.

### 5. `dataToken` pattern for anonymous-to-authenticated data transfer

An optional `dataToken` CDK prop (default `false`) enables a transfer pattern:

1. An unauthenticated user is assigned an opaque identifier stored in `__Host-DataToken` (HttpOnly, 15-minute expiry).
2. On sign-in, `signInComplete` reads the cookie and emits a `DataToken` EventBridge event with `{ accountId, emailAddress, dataToken }`.
3. The consuming app listens for `DataToken` and merges anonymous data into the authenticated account.

When `dataToken: false`, the cookie is never read and no event is fired. The `toDataTokenCookie` and `parseDataTokenCookie` helpers are exported from the package root for use in SSR layers (SvelteKit hooks, tRPC middleware, etc.).

### 6. `alarms` and `warmer` CDK props are optional

`EmailAlarms` and `LambdaKeepActive` are optional on the CDK construct. Projects that don't use those packages can deploy auth without them. Calls to `reportLambdaErrors` and `keepActive` are conditional.

### 7. Configurable EventBridge source

The EventBridge event source defaults to `"beesolve.auth.api"` but is configurable via the `eventSource` CDK prop. This allows consuming apps to namespace events under their own source string without forking the package.

---

## Consequences

**Positive:**

- Both packages are independently versioned and published to npm — any CDK project can consume them without copying source.
- The auth system is framework-agnostic at the Lambda layer (standard `Request`/`Response`). Works with SvelteKit, tRPC, TanStack Router, or any SSR framework.
- No email provider coupling in the auth package — email templating and locale handling stay in the consuming app.
- The `dataToken` pattern is an opt-in — projects that don't need it pay no overhead.
- Pre-built Lambda zips mean CDK synth has no build-time dependency on Node.js tooling in the consuming project.

**Negative / open items:**

- **Session refresh tests are missing** in `packages/service-auth`. Tests exist for `cookie.ts` and `errors.ts` but not for `Sessions.refresh` or the token-use flow. These should be added before the next minor release.
- Downstream consumers must be migrated to consume from npm rather than a local workspace reference to avoid the packages diverging.
- The `__Host-DataToken` cookie uses `SameSite=Lax` to support top-level navigation flows. This is intentional but means it is sent on cross-site top-level GETs — a narrower attack surface than `Strict` but a deliberate trade-off for the anonymous transfer pattern.
