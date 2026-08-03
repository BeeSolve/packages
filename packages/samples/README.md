# @beesolve/samples

Deployable reference implementations showcasing `@beesolve/*` packages. Each sample is a standalone CDK stack with a frontend deployed via `kit-on-lambda` (SvelteKit) or a plain SPA (React).

## Samples

### authEmailSimple

Minimal email code authentication. Users must be pre-created — no sign-up. Demonstrates `@beesolve/auth-service` with in-process session validation in SvelteKit hooks (Function URL pattern).

### authEmailAuthorizer

Same flow as authEmailSimple but uses an HTTP API Gateway Lambda authorizer for session validation. The SvelteKit app receives authenticated context automatically via `createSessionHandle()`.

### authWithEmail

Full-featured email code authentication with real email delivery via `@beesolve/email-service`. Includes sign-in, code verification with resend + countdown, and sign-out. The EventBridge consumer sends actual verification code emails.

### emailVerify

Standalone email verification form (contact form pattern). Demonstrates `@beesolve/action-tokens` directly — no auth system involved. Submitting the form sends a verification code to the user's email; entering the code sends the contact message to the recipient.

### authCookieFunction

Demonstrates the authorizer + `ensureCookieFunction` pattern with caching disabled. The CloudFront Function injects a placeholder `__Host-SID=anonym` cookie so the Lambda authorizer always runs. Uses `createSessionHandle()` to read session context from the authorizer response.

### authSpaWithApi

React SPA with a separate tRPC API backend. The SPA is served from CloudFront (S3 origin) and communicates with an API Gateway endpoint protected by the Lambda authorizer. Demonstrates the auth service in a non-SvelteKit context.

## Deployment

Each sample deploys independently:

```bash
bun run deploy:authEmailSimple
bun run deploy:authEmailAuthorizer
bun run deploy:authWithEmail
bun run deploy:emailVerify
bun run deploy:authCookieFunction
bun run deploy:authSpaWithApi
```

### Environment setup

Copy the example configuration and fill in your values:

```bash
cp mise.toml.example mise.toml
```

See [`mise.toml.example`](mise.toml.example) for the required environment variables. The `mise.toml` file is gitignored.

### First deployment (chicken-and-egg)

The `FRONTEND_URI` variables require the CloudFront distribution URL, which doesn't exist until the stack is deployed. For a first deploy:

1. Set a placeholder value (e.g. `https://placeholder.example.com`)
2. Deploy the stack — note the CloudFront URL from the CDK output
3. Update `mise.toml` with the real URL and redeploy

## SvelteKit + kit-on-lambda

All SvelteKit samples use `kit-on-lambda` as the adapter. When using `@beesolve/lambda-fetch-api` utilities (like `getAwsEvent()`, `hasAuthorizerContext()`) in SvelteKit hooks, the vite config **must** externalize the package:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    external: ["@beesolve/lambda-fetch-api"],
  },
});
```

**Why this is required:** `@beesolve/lambda-fetch-api` uses an `AsyncLocalStorage` instance to pass the Lambda event/context to downstream code. The `kit-on-lambda` handler calls `runWithAwsContext()` to set the store, and SvelteKit hooks call `getAwsEvent()` to read it. Both must reference the **same** `AsyncLocalStorage` instance.

Without `ssr.external`, Vite bundles `@beesolve/lambda-fetch-api` into the SSR output, creating a duplicate `AsyncLocalStorage` instance. The handler and hooks end up with separate stores, causing `getAwsEvent()` to throw:

```
Error: getAws* called outside of a handler invocation.
```

This applies to any SvelteKit sample that uses `createSessionHandle()` (authorizer-based pattern). Samples using `createInProcessSessionHandle()` don't call `getAwsEvent()` and are unaffected.

## Structure

```
samples/
├── authEmailSimple/       # Auth with in-process session check in hooks
├── authEmailAuthorizer/   # Auth with Lambda authorizer
├── authWithEmail/         # Auth with email delivery
├── authCookieFunction/    # Auth with ensureCookieFunction + disabled cache
├── authSpaWithApi/        # React SPA with tRPC API
├── emailVerify/           # Standalone email verification (action-tokens)
├── shared/                # Reusable components and utilities
├── app.ts                 # CDK app entry — registers all stacks
├── mise.toml.example      # Environment variable template
└── package.json
```
