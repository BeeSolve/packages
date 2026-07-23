# New Samples Plan

## 1. authSsrOnly

SSR-only session resolution — no API Gateway authorizer, no CloudFront cookie function. The SvelteKit Lambda resolves sessions directly from DynamoDB on every request.

### What it demonstrates

- `createInProcessSessionHandle()` in hooks — resolves sessions in-process
- `auth.grantSessionAccess(handler)` CDK method instead of `addAuthorizedEndpoint`
- `auth.addPublicEndpoint({ lambda: handler })` for the Function URL origin
- Simplest possible authenticated SSR app (no authorizer indirection)

### Differences from authEmailSimple

`authEmailSimple` already uses `createInProcessSessionHandle`. The key difference is that `authSsrOnly` strips away everything non-essential:

- No EventBridge consumer (auth events are logged but not processed)
- No email delivery — uses the built-in dev code (`000000`)
- No sign-up (`allowSignUp: false`) — demonstrates pre-provisioned accounts
- Minimal UI: no countdown, no resend, no reference code display

### Structure

```
authSsrOnly/
├── stack.ts           # CDK: AuthGateway + SvelteKit + grantSessionAccess
└── site/
    ├── svelte.config.js
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── app.html
        ├── app.d.ts
        ├── hooks.server.ts       # createInProcessSessionHandle()
        └── routes/
            ├── +page.server.ts   # load: return session info
            ├── +page.svelte      # dashboard with sign-out button
            └── sign-in/
                ├── +layout.server.ts  # redirect if already signed in
                ├── +page.svelte       # email form
                └── verify/
                    ├── +page.ts       # validate token param
                    └── +page.svelte   # code input
```

### CDK stack (sketch)

```ts
const auth = new AuthGateway(this, "Auth", {
  stage: "dev",
  frontendUri,
  allowSignUp: false,
  alarms,
});

const site = new SvelteKit(this, "Site", {
  runtime: "node",
  invokeMode: InvokeMode.BUFFERED,
  buildDirectory: resolve(__dirname, "./site/build"),
  toDefaultOrigin: ({ handler }) => {
    auth.addPublicEndpoint({ lambda: handler });
    auth.grantSessionAccess(handler);

    return new HttpOrigin(Fn.parseDomainName(auth.api.url!));
  },
});

const authBehaviour = auth.createAuthBehavior(site.distribution);
site.distribution.addBehavior("/auth/*", authBehaviour.origin, authBehaviour);
```

---

## 2. authCookieFunction

Authorizer-based session validation with `ensureCookieFunction` on the default CloudFront behavior. The Lambda authorizer runs on every request; the CloudFront Function injects a placeholder cookie so the authorizer identity source always resolves.

### What it demonstrates

- `createSessionHandle()` in hooks — reads session from authorizer context (not DynamoDB)
- `auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" })` for authorizer coverage
- `auth.ensureCookieFunction` attached to the default behavior via L1 escape hatch
- Why you need the cookie function: the authorizer's identity source includes `$request.cookies.__Host-SID` — without it, unauthenticated requests fail at CloudFront before reaching the Lambda
- `authorizerCache: "disabled"` mode (every request hits the authorizer — no stale sessions)

### Differences from authEmailAuthorizer

`authEmailAuthorizer` already demonstrates this pattern. This sample is a **stripped-down version** that:

- Removes the EventBridge consumer (no email processing)
- Uses dev code (`000000`) instead of real email delivery
- Adds explicit comments explaining the cookie function's role
- Shows how to handle `session.type === "none"` (request where authorizer didn't run)

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

### CDK stack (sketch)

```ts
const auth = new AuthGateway(this, "Auth", {
  stage: "dev",
  frontendUri,
  allowSignUp: false,
  alarms,
  authorizerCache: "disabled",
});

const site = new SvelteKit(this, "Site", {
  runtime: "node",
  invokeMode: InvokeMode.BUFFERED,
  buildDirectory: resolve(__dirname, "./site/build"),
  toDefaultOrigin: ({ handler }) => {
    auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" });

    return new HttpOrigin(Fn.parseDomainName(auth.api.url!));
  },
});

// Attach ensureCookieFunction to default behavior.
// The authorizer identity source includes __Host-SID. Without a value,
// unauthenticated requests get rejected by CloudFront before reaching Lambda.
const cfnDist = site.distribution.node.defaultChild as CfnDistribution;
cfnDist.addPropertyOverride("DistributionConfig.DefaultCacheBehavior.FunctionAssociations", [
  { EventType: "viewer-request", FunctionARN: auth.ensureCookieFunction.functionArn },
]);

const authBehaviour = auth.createAuthBehavior(site.distribution);
site.distribution.addBehavior("/auth/*", authBehaviour.origin, authBehaviour);
```

---

## 3. authSpaWithApi

SPA (React) with a tRPC API Lambda — no SSR. The React app is a static Vite build deployed to S3 + CloudFront. The API is a separate Lambda behind the `/api/*` behavior, protected by the session authorizer.

### What it demonstrates

- React 19 SPA with tRPC client (`@trpc/client` + `@trpc/tanstack-react-query`)
- tRPC server on Lambda using `fetchRequestHandler` + `asLambdaAuthorizedHttpV2Handler`
- Session context extracted from the Lambda authorizer (`getAwsLambdaAuthorizerContext`)
- CloudFront distribution with three behaviors: default (S3 SPA), `/api/*` (tRPC Lambda), `/auth/*` (auth service)
- `ensureCookieFunction` on `/api/*` behavior so unauthenticated API calls reach the authorizer
- The `shared/utils/authClient.ts` used directly from the React app for sign-in/sign-out
- Minimal React — no routing library, no UI framework, no CSS-in-JS

### Dependencies

**SPA (`site/`):**

- `react` + `react-dom` (^19)
- `@trpc/client` (^11.18)
- `@trpc/tanstack-react-query` (^11.18)
- `@tanstack/react-query` (^5.100)
- `valibot` (validation, consistent with other samples)
- `vite` (build)

**API (`api/`):**

- `@trpc/server` (^11.18)
- `@beesolve/lambda-fetch-api`
- `@beesolve/auth-service`
- `valibot`

### Structure

```
authSpaWithApi/
├── stack.ts
├── api/
│   ├── context.ts      # getAwsLambdaAuthorizerContext → { userId }
│   ├── router.ts       # appRouter with identity query + signOut mutation
│   └── handler.ts      # fetchRequestHandler + asLambdaAuthorizedHttpV2Handler
└── site/
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx          # createRoot + render <App />
        ├── app.tsx           # QueryClientProvider + TRPCProvider + page routing
        ├── trpc.ts           # createTRPCClient, createTRPCContext, queryClient
        ├── authClient.ts     # re-export or copy from shared/utils/authClient.ts
        ├── pages/
        │   ├── dashboard.tsx     # shows userId, sign-out button
        │   ├── signIn.tsx        # email form
        │   └── verify.tsx        # code input
        └── components/
            ├── emailForm.tsx     # minimal email input + submit
            └── codeInput.tsx     # 6-digit code input
```

### tRPC router (sketch)

```ts
import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.userId == null) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { userId: ctx.userId } });
});

export const appRouter = t.router({
  identity: protectedProcedure.query(({ ctx }) => {
    return { userId: ctx.userId };
  }),
});

export type AppRouter = typeof appRouter;
```

### tRPC client (sketch)

```ts
import type { AppRouter } from "../api/router";
import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext, createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api" })],
});

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
export const queryClient = new QueryClient();
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
```

### CDK stack (sketch)

```ts
const auth = new AuthGateway(this, "Auth", {
  stage: "dev",
  frontendUri,
  allowSignUp: true,
  alarms,
});

// API Lambda
const api = new Nodejs24Function(this, "Api", {
  entry: `${__dirname}/api/handler.ts`,
  handler: "handler.handler",
});
auth.addAuthorizedEndpoint({ lambda: api, path: "/api/{proxy+}" });

// SPA: S3 + CloudFront
const bucket = new Bucket(this, "SiteBucket", { ... });
new BucketDeployment(this, "Deploy", {
  sources: [Source.asset(resolve(__dirname, "./site/dist"))],
  destinationBucket: bucket,
});

const distribution = new Distribution(this, "CDN", {
  defaultBehavior: {
    origin: S3BucketOrigin.withOriginAccessControl(bucket),
    viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
  },
  defaultRootObject: "index.html",
  errorResponses: [
    { httpStatus: 403, responsePagePath: "/index.html", responseHttpStatus: 200 },
    { httpStatus: 404, responsePagePath: "/index.html", responseHttpStatus: 200 },
  ],
});

// /api/* → API Lambda via HTTP origin
distribution.addBehavior("/api/*", new HttpOrigin(Fn.parseDomainName(api.url!)), {
  allowedMethods: AllowedMethods.ALLOW_ALL,
  cachePolicy: CachePolicy.CACHING_DISABLED,
  originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
  viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
  functionAssociations: [{
    function: auth.ensureCookieFunction,
    eventType: FunctionEventType.VIEWER_REQUEST,
  }],
});

// /auth/* → auth service
const authBehaviour = auth.createAuthBehavior(distribution);
distribution.addBehavior("/auth/*", authBehaviour.origin, authBehaviour);
```

### Page routing approach

Simple state-based routing without a router library:

```tsx
function App() {
  const [page, setPage] = useState<"signIn" | "verify" | "dashboard">("signIn");
  // After signInComplete → window.location.href navigates, full reload
  // On load, call identity query — if it succeeds, show dashboard; if UNAUTHORIZED, show signIn
}
```

The identity query determines auth state on page load. If it returns `UNAUTHORIZED`, show the sign-in page. After successful sign-in, `authClient.signInComplete()` does `window.location.href = redirectTo` (full page reload), and on the fresh load the identity query succeeds → dashboard.

---

## Shared considerations

- All three samples reuse `shared/utils/authClient.ts` for the sign-in/sign-out client calls
- The SPA sample additionally imports it directly (or copies it with React-compatible types)
- All use `allowSignUp: true` or `false` as appropriate for the demo scenario
- None require real email delivery — they use the dev auth code (`000000`) for simplicity
- Each gets a deploy script in `package.json` and a stack registered in `app.ts`
