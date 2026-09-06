# Auth `appId` refactor + dashboard bus wiring cleanup

## Status: Complete (uncommitted — pending review)

## Problem Statement

Logging into the email dashboard produces two OTP emails — one from the dashboard's
own auth, one from the project's auth — because both `AuthGateway` instances publish
`EmailCodeAuth` to the same (default) event bus and both auth-consumer handlers listen
there.

The fix is bus separation for auth: the caller gives the dashboard's `AuthGateway` a
dedicated event bus (via `eventBusArn`), and the dashboard subscribes its auth rule to
that bus. This part is already wired (`AuthGateway` exposes `eventBus`/`eventSource`,
the dashboard binds its `AuthEventsRule` to `props.auth.eventBus`). This plan finalizes
that and **reworks the `appId` source-tagging** to match the intended design.

`appId` stays as an optional, complementary knob (useful when apps share the default
bus). The current implementation is over-engineered and must be simplified per the
following rules:

- `appId` is the **only** knob the user sees — an optional prop on the auth constructs.
- No exported `defaultAuthEventSource` constant, no exported `authEventSource()` helper.
- Source is computed **inline**: `beesolve.auth.${appId ?? "api"}`.
- The explicit `eventSource` prop is **removed** (only `appId` remains).
- Runtime: the CDK injects `APP_ID` (not a precomputed source string) into the auth
  handler env; the `Events`/`putEvents` helper builds the source inline at runtime.
- Fully automatic: the user never constructs source strings or imports helpers. Works
  out of the box whether or not `appId` is set.

Also drop the optional "custom SES bus" idea entirely — SES configuration-set event
destinations can only target the account default bus; that is understood and accepted.
SES delivery events stay on default, which is fine.

## Architecture / Approach

### Source computation — ONE place (the CDK construct)

The full source string is built exactly once, in the CDK construct, and the resolved
value is reused everywhere. The runtime never recomputes it.

- **CDK (once):** `this.eventSource = `beesolve.auth.${props.appId ?? "api"}``.
  - Exposed as the public `eventSource` field (consumer rule patterns match it).
  - Injected verbatim into the auth handler env as `EVENT_SOURCE: this.eventSource`
    (always injected, not conditional).
- **Runtime (publisher):** `api.ts` reads `EVENT_SOURCE` and passes it to `new Events(...)`.
  `Events.putEvents` uses that string verbatim as `Source`. No `beesolve.auth.${...}`
  template exists at runtime.

The `beesolve.auth.${appId ?? "api"}` template lives in a single location (the construct).

### Public API surface changes

`@beesolve/auth-service`:

- `CoreProps.appId?: string` — kept, docs simplified (the only user knob).
- `CoreProps.eventSource?: string` — **removed** (input prop only; the computed `eventSource`
  field is kept).
- `AuthGateway.eventSource: string` / `AuthService.eventSource: string` — kept, computed once
  as `beesolve.auth.${props.appId ?? "api"}`.
- `AuthGateway.eventBus: IEventBus` / `AuthService.eventBus: IEventBus` — kept.
- `@beesolve/auth-service/events` no longer re-exports `authEventSource` / `defaultAuthEventSource`.
- `src/events.ts`: remove `defaultAuthEventSource` + `authEventSource`; `Events` constructor
  takes a **required** `eventSource: string`; `putEvents` uses it verbatim (no template).

### Runtime env

- `api.ts` env schema: replace `EVENT_SOURCE: v.optional(v.string())` with a **required**
  `EVENT_SOURCE: v.string()` (CDK always injects it); construct
  `new Events({ client, eventBusArn: env.EVENT_BUS_ARN, eventSource: env.EVENT_SOURCE })`.
- `cdk.ts` `createAuthHandler`: always inject `EVENT_SOURCE: <the construct's resolved eventSource>`.

`@beesolve/email-service-dashboard` and `@beesolve/dmarc-dashboard`:

- No API change. Rules already bind to `props.auth.eventBus` + filter `props.auth.eventSource`.
  Verify correctness after the auth changes.

### Runtime env

### Runtime env (details)

- `api.ts` env schema: `EVENT_SOURCE: v.string()` (required — CDK always injects the
  resolved value); `new Events({ client, eventBusArn: env.EVENT_BUS_ARN, eventSource: env.EVENT_SOURCE })`.
- `cdk.ts` `createAuthHandler`: `authHandlerEnv["EVENT_SOURCE"] = <resolved eventSource>` always.

### Cross-package dependencies

None added. Internal only.

### Key design decisions

- The `beesolve.auth.${appId ?? "api"}` template exists in exactly ONE place (the CDK
  construct). The resolved string is injected as `EVENT_SOURCE` and used verbatim at
  runtime — the runtime has zero source-string logic.
- `Events.eventSource` and the `EVENT_SOURCE` env are **required** (CDK always injects),
  so there is no runtime fallback/default duplicating the format.
- `EVENT_SOURCE` env is always injected (value differs only by `appId`), keeping the
  default source `beesolve.auth.api` identical to today when `appId` is unset.
- Remove `eventSource` input prop: the user's only knob is `appId`.
- Auth bus ownership stays with the caller; dashboard only subscribes via `auth.eventBus`.

## Execution Instructions

Single focused session (small refactor). Check gates after the change:

1. `bun run check` (oxfmt + oxlint)
2. `bun run --filter '@beesolve/auth-service' --filter '@beesolve/email-service-dashboard' --filter '@beesolve/dmarc-dashboard' type-check`
3. `bun test` for affected packages

No commits — leave changes uncommitted for review. Do not skip signing or hooks.

## Tasks

### Task 1: Rework `Events` runtime helper (`src/events.ts`)

- [x] Remove `export const defaultAuthEventSource` and `export function authEventSource`.
- [x] `Events` constructor props: **required** `eventSource: string` (keep `eventBusArn?`).
- [x] In `putEvents`, set `Source: this.props.eventSource` (verbatim, no template).

**Files:** `packages/service-auth/src/events.ts`

**Acceptance:** no helpers/constants; `putEvents` uses `eventSource` verbatim; no `beesolve.auth.` string in this file.

---

### Task 2: Stop re-exporting helpers from consumer events module

- [x] Remove `export { authEventSource, defaultAuthEventSource } from "./src/events.ts";`
      from `packages/service-auth/events.ts`.

**Files:** `packages/service-auth/events.ts`

**Acceptance:** no helper re-exports; consumer event types/guards unchanged.

---

### Task 3: Update auth handler runtime (`api.ts`)

- [x] Env schema: `EVENT_SOURCE: v.string()` (required).
- [x] `new Events({ client, eventBusArn: env.EVENT_BUS_ARN, eventSource: env.EVENT_SOURCE })`.

**Files:** `packages/service-auth/api.ts`

**Acceptance:** handler passes the resolved `EVENT_SOURCE` to `Events`.

---

### Task 4: Compute `eventSource` once in CDK, inject it (`cdk.ts`)

- [x] Remove the `import { authEventSource } from "./events.ts";` import.
- [x] Remove the `eventSource?: string` **input prop** from `CoreProps`; simplify `appId`
      JSDoc (the only knob; source becomes `beesolve.auth.<appId>`, default `beesolve.auth.api`).
- [x] In both `AuthGateway` and `AuthService`: `this.eventSource = `beesolve.auth.${props.appId ?? "api"}``
      (this is the single place the template exists).
- [x] In `createAuthHandler`: always set `authHandlerEnv["EVENT_SOURCE"] = <resolved eventSource>`.
      Resolved string is computed once in each constructor and passed into `createAuthHandler`
      via a new `eventSource` prop.
- [x] Keep `this.eventBus = eventBus` and the exposed `eventBus`/`eventSource` fields.

**Files:** `packages/service-auth/cdk.ts`

**Acceptance:** the `beesolve.auth.` template appears exactly once per construct in cdk.ts;
`EVENT_SOURCE` always injected; no `authEventSource`/`eventSource`-input-prop references.

---

### Task 5: Verify dashboards + docs + changeset

- [x] Confirm `EmailServiceDashboard` and `DmarcDashboard` still compile (they use
      `props.auth.eventBus` + `props.auth.eventSource` — no change needed).
- [x] Update `docs/how-to/consuming-events.md`: removed references to exported helpers;
      shows `source: [auth.eventSource]` + `eventBus: auth.eventBus`; kept the SES-default-bus caveat.
- [x] Update `adr-006-multi-app-event-isolation.md`: removed helper/`eventSource`-prop
      mentions; describes source computed once in the construct + injected `EVENT_SOURCE`;
      kept the two mechanisms and the SES limitation; added the rejected-helper alternative.
- [x] Update `README.md` props table: dropped `eventSource` row; kept `appId`.
- [x] Update changeset `.changeset/auth-appid-event-source-scoping.md` to reflect the
      final API (no exported helpers, no `eventSource` prop, `appId` only, `eventBus`/
      `eventSource` fields exposed, `eventBusName` removed from dashboard).

**Files:** `packages/service-email-dashboard/cdk.ts` (verified),
`packages/dmarc-dashboard/cdk.ts` (verified),
`packages/service-auth/docs/how-to/consuming-events.md`,
`packages/service-auth/docs/adr-006-multi-app-event-isolation.md`,
`packages/service-auth/README.md`,
`.changeset/auth-appid-event-source-scoping.md`

**Acceptance:** all three packages type-check; `bun run check` clean; docs/changeset consistent with final API.

---

## Verification (completed)

- `oxfmt --check` clean, `oxlint` clean.
- Type-check clean: `@beesolve/auth-service`, `@beesolve/email-service-dashboard`, `@beesolve/dmarc-dashboard`.
- `bun run build` succeeded; all 173 `@beesolve/auth-service` tests pass.
- Changes uncommitted, pending user review.

## Future Work (out of scope)

- Cross-account bus bridging (account A project → account B dashboard). Explicitly deferred.
- Routing SES events to a non-default bus (not possible via config-set destination; dropped).
- Migrating sample stacks to the `auth.eventBus`/`auth.eventSource` pattern (samples still
  use the old hardcoded `beesolve.auth.api` default-bus rule; not required for this change).

```

```
