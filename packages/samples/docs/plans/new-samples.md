# New Samples Plan

## Status

- **authSsrOnly**: Skipped — `authEmailSimple` already demonstrates this exact pattern (`createInProcessSessionHandle` + `grantSessionAccess` + `addPublicEndpoint`).
- **authCookieFunction**: ✅ Implemented
- **authSpaWithApi**: ✅ Implemented

---

## 1. ~~authSsrOnly~~ (not needed)

`authEmailSimple` already covers this use case. It uses `createInProcessSessionHandle()`, `auth.grantSessionAccess(handler)`, and `auth.addPublicEndpoint({ lambda: handler })`. Adding a near-identical sample would be redundant.

---

## 2. authCookieFunction

Authorizer-based session validation with `ensureCookieFunction` on the default CloudFront behavior. The Lambda authorizer runs on every request (`authorizerCache: "disabled"`); the CloudFront Function injects a placeholder cookie so the authorizer identity source always resolves.

### What it demonstrates

- `createSessionHandle()` in hooks — reads session from authorizer context (not DynamoDB)
- `auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" })` for authorizer coverage
- `auth.ensureCookieFunction` attached to the default behavior via L1 escape hatch
- Why you need the cookie function: the authorizer's identity source includes `$request.cookies.__Host-SID` — without it, unauthenticated requests fail at CloudFront before reaching the Lambda
- `authorizerCache: "disabled"` mode (every request hits the authorizer — no stale sessions)
- No EventBridge consumer, no email delivery — uses dev code (`000000`)
- `allowSignUp: false` — demonstrates pre-provisioned accounts

### Structure

```
authCookieFunction/
├── stack.ts
└── site/
    ├── svelte.config.js
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── app.html
        ├── app.d.ts
        ├── hooks.server.ts       # createSessionHandle()
        └── routes/
            ├── +page.server.ts
            ├── +page.svelte
            └── sign-in/
                ├── +layout.server.ts
                ├── +page.svelte
                └── verify/
                    ├── +page.ts
                    └── +page.svelte
```

---

## 3. authSpaWithApi

SPA (React 19) with a tRPC API Lambda — no SSR. The React app is a static Vite build deployed via the `StaticWebsite` construct (S3 + CloudFront). The API is a separate Lambda behind the `/api/*` behavior, protected by the session authorizer.

### What it demonstrates

- React 19 SPA with tRPC client (`@trpc/client` + `@trpc/tanstack-react-query`)
- tRPC server on Lambda using `fetchRequestHandler` + `asLambdaAuthorizedHttpV2Handler`
- Session context extracted from the Lambda authorizer (`getAwsLambdaAuthorizerContext`)
- `StaticWebsite` construct from `@beesolve/cdk-constructs` for the SPA deployment
- CloudFront distribution with three behaviors: default (S3 SPA), `/api/*` (tRPC Lambda), `/auth/*` (auth service)
- `ensureCookieFunction` on `/api/*` behavior so unauthenticated API calls reach the authorizer
- Shared `authClient.ts` for sign-in/sign-out client calls (copied into the React app)
- Minimal React — no routing library, no UI framework, state-based page switching
- No email delivery — uses dev code (`000000`)

### Structure

```
authSpaWithApi/
├── stack.ts
├── api/
│   ├── context.ts      # getAwsLambdaAuthorizerContext → { userId }
│   ├── router.ts       # appRouter with identity query
│   └── handler.ts      # fetchRequestHandler + asLambdaAuthorizedHttpV2Handler
└── site/
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx
        ├── app.tsx           # QueryClientProvider + TRPCProvider + page routing
        ├── trpc.ts           # createTRPCClient, createTRPCContext, queryClient
        ├── authClient.ts     # sign-in/sign-out fetch calls
        ├── pages/
        │   ├── dashboard.tsx
        │   ├── signIn.tsx
        │   └── verify.tsx
        └── components/
            ├── emailForm.tsx
            └── codeInput.tsx
```

---

## Shared considerations

- Both samples reuse the auth client pattern for sign-in/sign-out
- Both use `allowSignUp: false` (authCookieFunction) or `true` (authSpaWithApi)
- None require real email delivery — they use the dev auth code (`000000`)
- Each has a deploy script in `package.json` and a stack registered in `app.ts`
- `authorizerCache: "disabled"` is used in both to avoid stale sessions in dev
