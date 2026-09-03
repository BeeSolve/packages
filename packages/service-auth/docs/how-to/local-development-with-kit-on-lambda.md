# Running auth-service with kit-on-lambda locally

This guide covers how to run a SvelteKit app that uses **`@beesolve/auth-service`**
and is deployed via **`kit-on-lambda`**, on your machine with `vite dev` — no Lambda,
no CloudFront, no sign-in flow.

## The problem

In production the auth flow depends on infrastructure that does not exist locally:

- **kit-on-lambda** runs the SvelteKit handler inside a Lambda invocation and populates
  the AWS event/context via `AsyncLocalStorage` (`runWithAwsContext`). Under `vite dev`
  there is no invocation, so `getAwsEvent()` / `getAwsContext()` throw
  `NotInHandlerContextError`.
- **auth-service** resolves the session either from a Lambda **authorizer** context
  (`createSessionHandle`) or by reading it in-process from DynamoDB
  (`createInProcessSessionHandle`). Both need a real request that went through
  CloudFront + the `__Host-SID` cookie machinery, which you don't have locally.

So without help, every local request would fail to resolve a session and your auth
guard would redirect to sign-in — which you also can't complete locally.

## The solution: a dev fallback session

`createSessionHandle` and `createInProcessSessionHandle` **auto-detect** whether they
are running in Lambda (`process.env.LAMBDA_TASK_ROOT`). When they are **not**, they skip
the authorizer entirely and inject a `fallbackSession` into `event.locals.session`.
This is the local equivalent of the authorizer context — no `AsyncLocalStorage`, no
`getAwsEvent()`, nothing that would throw under `vite dev`.

```ts
// hooks.server.ts
import { createSessionHandle } from "@beesolve/auth-service/sveltekit";
import { sequence } from "@sveltejs/kit/hooks";

// Locally this injects the default dev session (userId: "dev-user").
// In Lambda it uses the real authorizer.
export const handle = sequence(createSessionHandle(), authGuard);
```

### Built-in presets

Pass one of the presets to simulate different session states locally:

```ts
import {
  createSessionHandle,
  devValidSession, // default — a valid session for "dev-user"
  devInvalidSession, // no session cookie present
  devExpiredSession, // expired session
  devNoneSession, // authorizer did not run
} from "@beesolve/auth-service/sveltekit";

export const handle = sequence(
  createSessionHandle({ fallbackSession: devExpiredSession }),
  authGuard,
);
```

## Mapping the dev session to a real user

The presets use `userId: "dev-user"`, which usually does **not** exist in your table.
If your auth guard looks the session user up (to resolve roles, permissions, tenant,
etc.), that lookup will fail and you'll see a logged-out-looking UI even though the
session is "valid".

To develop against a **real** backend, build a valid `fallbackSession` whose `userId`
is a real record in your database, gated so it never ships in the deployed bundle:

```ts
// hooks.server.ts
import { createSessionHandle, type SessionContext } from "@beesolve/auth-service/sveltekit";
import { sequence } from "@sveltejs/kit/hooks";

// import.meta.env.DEV is true under `vite dev` and compiled out of the
// production build, so this branch never reaches the Lambda bundle.
const devUserEmail = process.env.DEV_USER_EMAIL;
const fallbackSession =
  import.meta.env.DEV && devUserEmail != null
    ? ({
        type: "valid",
        validSession: {
          userId: devUserEmail, // a real user id/email in your table
          sessionId: "dev-session",
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        },
        setCookiesParams: [],
      } satisfies SessionContext)
    : undefined;

export const handle = sequence(createSessionHandle({ fallbackSession }), authGuard);
```

Put `DEV_USER_EMAIL` (and any other backend env) in a gitignored `.env.local`, and load
it in your `dev` script so it reaches `process.env` before the hooks and SDK clients
parse it at import time:

```json
{
  "scripts": {
    "dev": "bun --env-file=.env.local vite dev"
  }
}
```

> Any SDK clients you construct at module load (DynamoDB tables, queue URLs, other
> service ARNs) also read `process.env` at import time, so all their env vars must be
> present in `.env.local` or the first request will throw a validation error naming the
> missing key. You'll also need AWS credentials for the target account in your shell.

## Required: keep `@beesolve/lambda-fetch-api` external in Vite

If you use `createSessionHandle` (the authorizer pattern), add
`@beesolve/lambda-fetch-api` to the SSR externals, or the authorizer path breaks in a
subtle way even in deployment:

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    external: ["@beesolve/lambda-fetch-api"],
  },
});
```

Without this, Vite bundles a **duplicate** `AsyncLocalStorage` instance into the SSR
output: `kit-on-lambda`'s handler sets the AWS event on one instance while
`getAwsEvent()` (used inside `createSessionHandle`) reads from another, producing
`getAws* called outside of a handler invocation` at runtime. `createInProcessSessionHandle`
(Pattern 3) does not use `getAwsEvent()` and is unaffected.

## Non-SvelteKit handlers

If you run a custom Bun/Node fetch handler (not SvelteKit hooks), wrap it with
`withDevSession` from `@beesolve/auth-service/dev`, which fakes the API Gateway
authorizer context so `getSessionContext()` works locally:

```ts
import { serve } from "bun";
import { withDevSession } from "@beesolve/auth-service/dev";
import { myApiHandler } from "./api";

const devApi = withDevSession(myApiHandler, { userId: "dev-user-123" });

serve({ port: 3000, routes: { "/api/*": (request) => devApi(request) } });
```

## Real cookies over local HTTPS (optional)

Fallback sessions bypass cookies entirely, which is enough for almost all local work.
If you specifically need to exercise real `__Host-SID` cookie behavior, note that the
`__Host-` prefix requires `Secure`, so you must serve over HTTPS locally — generate a
cert with `devcert` or `mkcert` and run the dev server over TLS.

## Checklist

- [ ] `createSessionHandle` / `createInProcessSessionHandle` used in `hooks.server.ts`
- [ ] `fallbackSession` set to a real user, guarded by `import.meta.env.DEV`
- [ ] `.env.local` holds `DEV_USER_EMAIL` + all backend env; loaded via `--env-file`
- [ ] AWS credentials available in the shell
- [ ] `@beesolve/lambda-fetch-api` in Vite `ssr.external` (authorizer pattern)

## See also

- [`@beesolve/dmarc-dashboard`](https://github.com/beesolve/packages/tree/main/packages/dmarc-dashboard)
  — a real app wired exactly this way (see its README "Local Development" section).
- `kit-on-lambda` README → "Local development" for the adapter side.
