---
"@beesolve/dmarc-dashboard": minor
"@beesolve/email-service-dashboard": minor
---

Migrate the dashboard to SvelteKit 3 (requires `@sveltejs/kit` ^3 and `kit-on-lambda` ^1).

SvelteKit 3 no longer reads `svelte.config.js`, so the adapter and `paths` configuration now live in the `sveltekit(...)` plugin options inside `vite.config.ts`, and the `svelte.config.js` file has been removed. The removed `$lib` alias is replaced by a `#lib` Node subpath import (declared in `package.json` `imports`) with explicit file extensions. `tsconfig.json` now extends `$app/tsconfig`. The `Handle` type is imported from `@sveltejs/kit/hooks`, deprecated `json()` responses use `Response.json()`, and reads of the now-readonly `page.url.searchParams` were updated. The app's `typescript` devDependency is pinned to `~6.0.3` because the SvelteKit toolchain (`svelte-kit sync`, `svelte-check`) is not yet compatible with the TypeScript 7 native compiler.
