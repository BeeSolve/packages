# ADR-004: SvelteKit Remote Functions as the Data Layer

## Status

Accepted

## Context

The dashboard originally talked to the server through `+page.server.ts` `load`
functions (reads) and form `actions` (mutations). Every page duplicated the same
plumbing: read `event.locals.services` / `event.locals.user`, parse
`url.searchParams` by hand, run an inline admin or per-domain guard, and shape a
`data` payload the `.svelte` file consumed through generated `$types`. Form
submissions used `<form method="POST" use:enhance>` against named `?/action`
routes, and client-side filter changes (cursor/date/month) round-tripped through
URL navigation and a fresh `load`.

Three problems motivated a change:

1. **No end-to-end type safety on the wire.** `load` returns and `data`
   consumption were only loosely coupled through generated types; a shape change
   in a `load` was easy to miss in the matching `.svelte`.
2. **Named form actions break behind CloudFront.** SvelteKit named actions put
   `?/name` in the query string. The `/` is rejected or misrouted by CloudFront
   in front of `kit-on-lambda`, so every mutation had to be the default action,
   which does not compose well when a page needs more than one.
3. **Boilerplate per page.** Guards, arg parsing, and error-to-HTTP mapping were
   copy-pasted into every `load`/`action`.

SvelteKit 3's remote functions (`query`/`form`/`command` in `*.remote.ts`) are now
stable. They give end-to-end type-safe server calls, Valibot-validated arguments,
single-flight mutation refresh, and co-located client/server access, while reading
request context from `getRequestEvent()`. The sibling project `expense-ease` runs
exactly this stack (SvelteKit 3, Svelte 5.57, Vite 8, `kit-on-lambda`,
`@beesolve/auth-service` with `createSessionHandle`, `@beesolve/lambda-fetch-api`)
with remote functions in production, giving us a proven reference for the patterns.

## Decision

Adopt SvelteKit remote functions as the dashboard's data layer and remove the
`load`/`actions` pairs.

- Enable `experimental.remoteFunctions` and `compilerOptions.experimental.async`
  on the `sveltekit({ ... })` plugin options in `vite.config.ts`.
- Centralize definitions in `src/lib/remote/<area>.remote.ts` by domain area
  (`domains`, `reports`, `stats`, `users`, `setup`) rather than colocating per
  route, matching the `expense-ease` organization.
- Use `query` for reads, `form` for user-submitted mutations, and `command` for
  programmatic mutations invoked from event handlers. URL-search-param reads become
  Valibot-validated query arguments. After a mutation, call the relevant
  `query(...).refresh()` for single-flight UI updates.
- Access request context inside each function via
  `const { locals } = getRequestEvent();` and read `locals.user` / `locals.session`
  / `locals.services`. Move the inline admin / per-domain guards into the remote
  functions.
- Centralize error mapping in `src/lib/server/httpErrors.ts`: `toRemoteError(error,
  { redirectOnUnauthorized })` maps domain errors to SvelteKit `error()`/`redirect()`
  and `requireUser(user)` guards a present session. In `catch` blocks call
  `toRemoteError(...)` directly, never `throw` its result (a `throw` form trips the
  `only-throw-error` lint rule).
- Resolve environment variables through `src/env.ts` using `defineEnvVars` with
  Valibot schemas, imported typed and validated from `$app/env/private`, replacing
  the hand-rolled `v.parse(envSchema, process.env)` block.
- Keep the auth boundary unchanged: `hooks.server.ts` still runs
  `sequence(createSessionHandle({ fallbackSession }), authGuard)`.
- Use only the default (unnamed) `form()` semantics; never introduce named
  `?/action` routes.

Retained server loads (deliberately not converted): `+layout.server.ts` (supplies
`user`), `setup/+page.server.ts` (redirect-if-complete guard), and the sign-in
universal/layout loads. The `/auth/*` sign-in / verify flows hit the auth-service
CloudFront origin, not SvelteKit, and stay outside this layer.

## Rationale

### 1. End-to-end type safety and less boilerplate

A `query`/`form` is a single typed function shared by server and client, so a
shape change surfaces at every call site. Guards, argument validation, and
error mapping live in one place per area instead of being copied into each
`load`/`action`.

### 2. Default forms sidestep the CloudFront named-action problem

Remote `form()` uses the default (unnamed) action semantics, so no `?/name`
appears in the URL and the CloudFront-behind-`kit-on-lambda` routing problem does
not arise. Multiple forms on a page compose cleanly as separate remote functions.

### 3. Single-flight mutations

`query(...).refresh()` after a mutation updates the affected data in the same
round trip, replacing the full-navigation-plus-reload pattern the old `actions`
relied on.

### 4. Proven precedent

`expense-ease` already runs this exact stack with remote functions in production,
so the risk of the patterns themselves is low; the migration ported known-good
conventions rather than inventing them.

## Consequences

- The data layer depends on experimental SvelteKit flags
  (`remoteFunctions`, `compilerOptions.experimental.async`). This is accepted: the
  features are stable enough for `expense-ease` production use, and the flags are a
  single localized change in `vite.config.ts`.
- `ssr.external: ["@beesolve/lambda-fetch-api"]` must remain in `vite.config.ts`.
  These dashboards consume `@beesolve/auth-service` via `workspace:^`, so Vite
  bundles the workspace source and would otherwise create a duplicate
  `AsyncLocalStorage` instance. Both `createSessionHandle` and `getRequestEvent()`
  are AsyncLocalStorage-based, so a duplicate store breaks request context at
  runtime (`getAws* called outside of a handler invocation`). `expense-ease` can
  omit this only because it consumes `@beesolve/auth-service` as a published npm
  package.
- Guards now live in remote functions, so a page cannot render data without its
  function running — the guard cannot be bypassed by a stale `load`.
- Environment variables are validated through `$app/env/private`, so a missing var
  fails fast at first import; the `build` script supplies placeholder values for
  exactly this reason.

## Alternatives Considered

### Keep `load`/`actions`

Rejected. It preserves the per-page boilerplate, the loose typing between `load`
and `data`, and the named-action-versus-CloudFront constraint that this migration
removes.

### Colocate remote functions per route

Rejected. Centralizing by domain area in `src/lib/remote/` matches `expense-ease`,
keeps related queries/forms/commands together, and lets several routes share one
area module (e.g. `domains` serves both the overview query and the refresh command).

### Switch to `createInProcessSessionHandle`

Rejected as out of scope. The Lambda-authorizer `createSessionHandle` pattern is
orthogonal to remote functions and changing it would alter the deployment topology.

## References

- `vite.config.ts` — experimental flags and `ssr.external`.
- `src/env.ts` — `defineEnvVars` env resolution.
- `src/hooks.server.ts` — `sequence(createSessionHandle({ fallbackSession }), authGuard)`.
- `src/lib/remote/*.remote.ts` — the `query`/`form`/`command` definitions.
- `src/lib/server/httpErrors.ts` — `toRemoteError` / `requireUser`.
- `.kiro/steering/sveltekit-lambda` — the `ssr.external` and named-form-action caveats.
