# How to: Use lambda-fetch-api with SvelteKit

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailAuthorizer

SvelteKit produces a Fetch handler, so it runs on Lambda directly through this package's adapters. The adapter's `AsyncLocalStorage` context is what lets SvelteKit server code read the Lambda event - including the authorizer payload - from inside `hooks.server.ts`. The session handles from `@beesolve/auth-service/sveltekit` (`createSessionHandle` and `createInProcessSessionHandle`) rely on this context.

## Prerequisites

- A SvelteKit app deployed to Lambda behind API Gateway (e.g. via kit-on-lambda)
- `@beesolve/lambda-fetch-api` installed in the app
- `@beesolve/auth-service` if you use the session handles

## Steps

### 1. Externalize the package in the Vite config

This is the critical step. Vite's SSR bundler will otherwise create a second copy of the module, and the duplicate copy gets its own `AsyncLocalStorage` instance. The handler stores the event in one instance while your hooks read from the other, so the getters throw `NotInHandlerContextError` ("getAws* called outside of a handler invocation") at runtime.

Add the package to `ssr.external`:

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    external: ["@beesolve/lambda-fetch-api"],
  },
});
```

### 2. Resolve the session in hooks

With a single externalized module instance, the authorizer-backed session handle can read the Lambda authorizer context the adapter stored for the request:

```ts
import { createSessionHandle } from "@beesolve/auth-service/sveltekit";
import { redirect, type Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

const publicPaths = new Set(["/sign-in", "/sign-in/verify"]);

const authGuard: Handle = async ({ event, resolve }) => {
  if (event.locals.session.type !== "valid" && !publicPaths.has(event.url.pathname)) {
    redirect(303, "/sign-in");
  }
  return resolve(event);
};

export const handle = sequence(createSessionHandle(), authGuard);
```

### 3. Choose the session handle for your pattern

- `createSessionHandle()` - the authorizer pattern. A Lambda authorizer runs before the app, and the session is read from the authorizer context carried on the Lambda event. This is the pattern that depends on the externalized adapter module. Used by the `authEmailAuthorizer` and `authCookieFunction` samples.
- `createInProcessSessionHandle()` - resolves the session inside the app process by reading the sessions table directly, instead of a separate authorizer Lambda. Used by the `authEmailSimple` sample. This pattern does not depend on the adapter's `AsyncLocalStorage` context, so the externals requirement does not apply to it - but keeping the external entry is harmless.

## Common Pitfalls

- Forgetting `ssr.external` is the most common failure. The symptom is a runtime error that `getAws*` was called outside a handler invocation, even though the code clearly runs during a request. The cause is two module instances with separate `AsyncLocalStorage` stores. Only `createSessionHandle()` (authorizer pattern) is affected; `createInProcessSessionHandle()` is not.
- The getters only resolve during a real Lambda invocation. In local dev (`vite dev`) there is no Lambda event, so session handles fall back to a dev session rather than reading the adapter context.

## See Also

- [Getting started](./getting-started.md)
- [authEmailAuthorizer sample](https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailAuthorizer)
- [authCookieFunction sample](https://github.com/BeeSolve/packages/tree/main/packages/samples/authCookieFunction)
