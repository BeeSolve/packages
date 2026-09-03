---
"@beesolve/auth-service": patch
---

Add a how-to guide for running auth-service with `kit-on-lambda` locally
(`docs/how-to/local-development-with-kit-on-lambda.md`): why the authorizer/AWS
context is unavailable under `vite dev`, mapping the dev `fallbackSession` to a real
user via `DEV_USER_EMAIL`, loading `.env.local`, and the required
`@beesolve/lambda-fetch-api` SSR-externals config. Linked from the README.
