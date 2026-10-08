---
"@beesolve/dmarc-dashboard": minor
---

Migrate the dashboard data layer to SvelteKit remote functions.

All `+page.server.ts` `load` functions and form `actions` are replaced by `query` / `form` / `command` definitions in `src/lib/remote/*.remote.ts`, organized by domain area (`domains`, `reports`, `stats`, `users`, `setup`). URL filters become Valibot-validated query arguments, mutations use the default (unnamed) `form()` semantics with single-flight `query(...).refresh()`, and domain-error-to-HTTP mapping is centralized in `src/lib/server/httpErrors.ts` (`toRemoteError` / `requireUser`). Environment variables now resolve through `src/env.ts` (`defineEnvVars`) and `$app/env/private`.

The `createSessionHandle` auth boundary, the `/auth/*` flows, and `ssr.external: ["@beesolve/lambda-fetch-api"]` are unchanged. This is an internal data-layer refactor with no change to the exported CDK construct API or deployment behavior.
