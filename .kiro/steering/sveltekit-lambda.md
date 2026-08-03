# SvelteKit + kit-on-lambda — Known Issues

## Vite SSR Externals

When using `@beesolve/lambda-fetch-api` in SvelteKit hooks (e.g. `createSessionHandle()`), the vite config **must** externalize it:

```ts
ssr: {
  external: ["@beesolve/lambda-fetch-api"],
},
```

Without this, Vite creates a duplicate `AsyncLocalStorage` instance — the handler and hooks use different stores, causing "getAws* called outside of a handler invocation" errors at runtime.

This affects `createSessionHandle()` (authorizer pattern). `createInProcessSessionHandle()` is unaffected.

## CDK identitySource for Disabled Cache

When setting `authorizerCache: "disabled"` on `AuthGateway`, the `identitySource` must be `[]` (empty array), not `undefined`. Passing `undefined` makes CDK use the default (`$request.header.Authorization`), which causes API Gateway to return 401 without ever invoking the authorizer Lambda.

## Named Form Actions and CloudFront/Lambda

SvelteKit named form actions use `?/actionName` in the URL (e.g. `?/verify`). The `/` in the query parameter causes issues with CloudFront and Lambda — the request gets rejected or misrouted. Solutions:

- Use the **default** form action (no name) instead of named actions
- Or encode the `/` in the query parameter (e.g. `?%2Fverify`)

This applies to any SvelteKit app deployed behind CloudFront via kit-on-lambda.

## First Deployment (Chicken-and-Egg)

Sample stacks require a `FRONTEND_URI` env var (the CloudFront URL) which doesn't exist until after first deploy. Workflow:

1. Set a placeholder URL in `mise.toml`
2. Deploy — note the CloudFront URL from CDK output
3. Update `mise.toml` with the real URL and redeploy
