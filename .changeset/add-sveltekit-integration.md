---
"@beesolve/auth-service": minor
---

Add SvelteKit integration (`@beesolve/auth-service/sveltekit`)

- New `createSessionHandle` hook factory that populates `event.locals.session` from the Lambda authorizer context and forwards session cookies to the response
- Dev fallback presets: `devValidSession`, `devInvalidSession`, `devExpiredSession`
- New `getSessionContext()` with auto-detection of HTTP API (v2) vs REST API (v1)
- Explicit `getSessionContextV1()` and `getSessionContextV2()` for full control
- Optional `@sveltejs/kit` peer dependency (only needed when importing `/sveltekit`)

Breaking changes:

- Removed `requireSessionV1` and `requireSessionV2` (unused, replaced by `getSessionContext`)
- Renamed internal `src/requireSession.ts` to `src/sessionContext.ts`
