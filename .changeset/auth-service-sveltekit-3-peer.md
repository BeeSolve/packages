---
"@beesolve/auth-service": minor
---

Require SvelteKit 3: the `@sveltejs/kit` peer dependency range is now `^3.0.1` (was `^2.70.3`).

The SSR session integration (`createSessionHandle`, `createInProcessSessionHandle`) is used from SvelteKit `hooks.server.ts`. Consumers must upgrade their app to SvelteKit 3 to use this version. No runtime code changed.
