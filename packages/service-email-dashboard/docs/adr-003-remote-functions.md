# ADR-003: SvelteKit Remote Functions as the Data Layer

## Status

Accepted

## Context

The dashboard originally talked to the server through `+page.server.ts` `load`
functions (reads) and form `actions` (mutations). Every page duplicated the same
plumbing: read `event.locals.services` / `event.locals.user`, parse
`url.searchParams` by hand, run an inline admin guard, and shape a `data` payload
the `.svelte` file consumed through generated `$types`. Form submissions used
`<form method="POST" use:enhance>` against named `?/action` routes, and
client-side filter changes (year/month/cursor) round-tripped through URL
navigation and a fresh `load`.

The message detail view has an extra wrinkle: the message body is fetched on
demand via `email.getMessage(requestId)` and never stored, so it had to be a
separate `action` triggered by a button, deliberately kept out of the page's
`load` so S3 is only read when the user asks for it.

Three problems motivated a change:

1. **No end-to-end type safety on the wire.** `load` returns and `data`
   consumption were only loosely coupled through generated types.
2. **Named form actions break behind CloudFront.** SvelteKit named actions put
   `?/name` in the query string. The `/` is rejected or misrouted by CloudFront
   in front of `kit-on-lambda`, forcing every mutation onto the default action.
3. **Boilerplate per page.** Guards, arg parsing, and error-to-HTTP mapping were
   copy-pasted into every `load`/`action`.

SvelteKit 3's remote functions (`query`/`form`/`command` in `*.remote.ts`) are now
stable. They give end-to-end type-safe server calls, Valibot-validated arguments,
single-flight mutation refresh, and co-located client/server access, while reading
request context from `getRequestEvent()`. The sibling project `expense-ease` runs
exactly this stack (SvelteKit 3, Svelte 5.57, Vite 8, `kit-on-lambda`,
`@beesolve/auth-service` with `createSessionHandle`, `@beesolve/lambda-fetch-api`)
with remote functions in production, giving us a proven reference.

## Decision

Adopt SvelteKit remote functions as the dashboard's data layer and remove the
`load`/`actions` pairs.

- Enable `experimental.remoteFunctions` and `compilerOptions.experimental.async`
  on the `sveltekit({ ... })` plugin options in `vite.config.ts`.
- Centralize definitions in `src/lib/remote/<area>.remote.ts` by domain area
  (`overview`, `messages`, `recipients`, `users`, `setup`) rather than colocating
  per route, matching the `expense-ease` organization.
- Use `query` for reads, `form` for user-submitted mutations, and `command` for
  programmatic mutations. The on-demand message body stays a `command`
  (`loadMessageBody`) so S3 is read only when the user triggers it, never inside
  the detail `query`. URL-search-param reads become Valibot-validated query
  arguments. After a mutation, call the relevant `query(...).refresh()` for
  single-flight UI updates.
- Access request context inside each function via
  `const { locals } = getRequestEvent();` and read `locals.user` / `locals.session`
  / `locals.services`. Move the inline admin guards into the remote functions.
- Centralize error mapping in `src/lib/server/httpErrors.ts`: `toRemoteError(error,
  { redirectOnUnauthorized })` maps domain errors to SvelteKit `error()`/`redirect()`
  and `requireUser(user)` guards a present session. In `catch` blocks call
  `toRemoteError(...)` directly, never `throw` its result (a `throw` form trips the
  `only-throw-error` lint rule).
- Resolve environment variables through `src/env.ts` using `defineEnvVars` with
  Valibot schemas, imported typed and validated from `$app/env/private`, replacing
  the hand-rolled `process.env` parsing.
- Keep the auth boundary unchanged: `hooks.server.ts` still runs
  `sequence(createSessionHandle({ fallbackSession }), authGuard)`.
- Use only the default (unnamed) `form()` semantics; never introduce named
  `?/action` routes.

Retained server loads (deliberately not converted): `+layout.server.ts` (supplies
`user` and the setup redirect), `setup/+page.server.ts` (redirect-if-complete
guard), and the sign-in universal/layout loads. The `/auth/*` sign-in / verify
flows hit the auth-service CloudFront origin, not SvelteKit, and stay outside this
layer.

## Rationale

### 1. End-to-end type safety and less boilerplate

A `query`/`form` is a single typed function shared by server and client, so a
shape change surfaces at every call site. Guards, argument validation, and
error mapping live in one place per area instead of being copied into each
`load`/`action`.

### 2. Default forms sidestep the CloudFront named-action problem

Remote `form()` uses the default (unnamed) action semantics, so no `?/name`
appears in the URL and the CloudFront-behind-`kit-on-lambda` routing problem does
not arise.

### 3. On-demand body stays explicit

Modeling the message body as a `command` keeps the "only read S3 when asked"
behavior that the old separate `action` provided, while the message detail itself
is a plain `query`.

### 4. Single-flight mutations and proven precedent

`query(...).refresh()` updates affected data in the same round trip, and
`expense-ease` already runs this exact stack in production, so the migration
ported known-good conventions rather than inventing them.

## Consequences

- The data layer depends on experimental SvelteKit flags
  (`remoteFunctions`, `compilerOptions.experimental.async`). Accepted: the
  features are stable enough for `expense-ease` production use, and the flags are a
  single localized change in `vite.config.ts`.
- `ssr.external: ["@beesolve/lambda-fetch-api"]` must remain in `vite.config.ts`.
  The dashboard consumes `@beesolve/auth-service` via `workspace:^`, so Vite
  bundles the workspace source and would otherwise create a duplicate
  `AsyncLocalStorage` instance. Both `createSessionHandle` and `getRequestEvent()`
  are AsyncLocalStorage-based, so a duplicate store breaks request context at
  runtime (`getAws* called outside of a handler invocation`). `expense-ease` can
  omit this only because it consumes `@beesolve/auth-service` as a published npm
  package.
- Guards now live in remote functions, so a page cannot render data without its
  function running.
- Environment variables are validated through `$app/env/private`, so a missing var
  fails fast at first import; the `build` script supplies placeholder values for
  exactly this reason.

## Alternatives Considered

### Keep `load`/`actions`

Rejected. It preserves the per-page boilerplate, the loose typing between `load`
and `data`, and the named-action-versus-CloudFront constraint that this migration
removes.

### Colocate remote functions per route

Rejected. Centralizing by domain area in `src/lib/remote/` matches `expense-ease`
and keeps related queries/forms/commands together.

### Switch to `createInProcessSessionHandle`

Rejected as out of scope. The Lambda-authorizer `createSessionHandle` pattern is
orthogonal to remote functions and changing it would alter the deployment topology.

## References

- `vite.config.ts` — experimental flags and `ssr.external`.
- `src/env.ts` — `defineEnvVars` env resolution.
- `src/hooks.server.ts` — `sequence(createSessionHandle({ fallbackSession }), authGuard)`.
- `src/lib/remote/*.remote.ts` — the `query`/`form`/`command` definitions, including `loadMessageBody`.
- `src/lib/server/httpErrors.ts` — `toRemoteError` / `requireUser`.
- `.kiro/steering/sveltekit-lambda` — the `ssr.external` and named-form-action caveats.
- ADR-002 — the event projection the queries read from.
