# Examples / Samples Plan for `service-auth`

## Goals

1. **Reference implementations** — show consumers how to integrate `service-auth` for different use cases
2. **Self-contained** — each example is deployable to AWS with minimal setup (CDK + `kit-on-lambda`)
3. **Validation** — deploying and using the samples serves as practical verification that everything works end-to-end (including passkeys)

---

## Technology

- **Frontend**: SvelteKit (plain HTML forms, no styling library, no component framework)
- **Backend**: SvelteKit server routes calling service-auth endpoints
- **Deployment**: `kit-on-lambda` (npm package — SvelteKit adapter + CDK construct, deploys Lambda behind CloudFront with S3 for static assets)
- **Infrastructure**: CDK stack per example that provisions the `Auth` construct + `SvelteKit` construct from `kit-on-lambda/cdk` + any supporting Lambda (EventBridge consumers)
- **Package**: `@beesolve/samples` — a dedicated package in the monorepo (`packages/samples/`) for all reference implementations across beesolve packages (auth, email, SQS, etc.)
- **Runtime**: Node.js (default `kit-on-lambda` configuration with esbuild bundling)

### Why a Separate Package

- Keeps individual packages (`service-auth`, `service-email`, etc.) free of example code
- Single place to maintain deployable demos across the ecosystem
- Can grow over time: auth samples today, React Email templates tomorrow, SQS consumer patterns later
- Not published to npm — `"private": true`, exists only as a reference in the monorepo

### Key Dependencies (per example site)

```json
{
  "dependencies": {
    "kit-on-lambda": "^0.4.1"
  },
  "devDependencies": {
    "@sveltejs/kit": "^2.68.0",
    "@sveltejs/vite-plugin-svelte": "^7.1.2",
    "svelte": "^5.0.0",
    "vite": "^6.0.0"
  }
}
```

### Key Dependencies (per CDK stack)

```json
{
  "dependencies": {
    "kit-on-lambda": "^0.4.1",
    "aws-cdk-lib": "^2.260.0",
    "constructs": "^10.6.0",
    "@beesolve/service-auth": "workspace:^"
  }
}
```

---

## Prerequisite: `kit-on-lambda` HTTP API Gateway Support

### The Problem

The main strength of `service-auth` is its **Lambda authorizer on HTTP API Gateway** — the authorizer checks the session cookie, resolves the user, and injects user context into every request. Protected routes don't need any auth logic; the gateway handles it.

Currently `kit-on-lambda` only supports **CloudFront → Lambda Function URL**. There's no way to attach a Lambda authorizer to a Function URL. This means with the current setup, every SvelteKit server route would have to manually validate the session — defeating the purpose of the authorizer pattern.

### What Needs to Be Added to `kit-on-lambda`

A new deployment mode: **CloudFront → HTTP API Gateway → Lambda**

```ts
// New CDK construct usage
const { handler, distribution } = new SvelteKit(stack, "Site", {
  runtime: "node",
  origin: "httpApi", // new option (vs current implicit "functionUrl")
  httpApi: auth.api, // pass existing HTTP API from Auth construct
  authorizer: auth.authorizer, // attach Lambda authorizer to all routes
});
```

This would:

1. Create the Lambda function (same as today)
2. Add it as an integration on the provided HTTP API (or create a new one)
3. Attach the authorizer to the catch-all route
4. Use the HTTP API as the CloudFront origin (instead of Function URL)
5. Expose the user context (from authorizer) to SvelteKit handlers via `@beesolve/lambda-fetch-api` event data

### Implementation in `kit-on-lambda`

- Add `origin: "httpApi" | "functionUrl"` prop (default: `"functionUrl"` for backwards compat)
- When `origin: "httpApi"`:
  - Accept `httpApi` (existing or create new) and optional `authorizer`
  - Create `HttpLambdaIntegration` for the Lambda
  - Add catch-all route (`ANY /{proxy+}`) with the authorizer
  - CloudFront origin becomes the HTTP API endpoint (not Function URL)
  - Response streaming not available (HTTP API doesn't support it) — document this trade-off

---

## Two Example Variants Per Flow

Each auth example should have **two deployment variants** to demonstrate both patterns:

### Variant A: HTTP API Gateway + Lambda Authorizer (recommended for production)

- Session validation happens at the gateway level
- SvelteKit server routes receive authenticated user context automatically
- No auth boilerplate in route handlers
- Requires the new `kit-on-lambda` HTTP API mode

### Variant B: Function URL (simpler, current `kit-on-lambda`)

- Session validation happens in SvelteKit hooks (`hooks.server.ts`)
- App calls service-auth SDK handler to validate session on each request
- More code in the app, but works with current `kit-on-lambda` today
- Good for cases where you don't need/want HTTP API Gateway

### Folder Structure

```
packages/samples/auth/
├── emailSimple/
│   ├── stack.ts                 # CDK stack (choose HTTP API or Function URL variant)
│   ├── consumer.ts              # EventBridge consumer Lambda handler
│   └── site/                    # SvelteKit app (same code for both variants)
│       ├── src/
│       │   ├── hooks.server.ts  # Session handling (differs between variants)
│       │   └── routes/...
│       ├── svelte.config.js
│       └── package.json
```

The SvelteKit app code is the same — only the CDK stack and `hooks.server.ts` differ between variants. In the HTTP API variant, the hook reads the authorizer context from the Lambda event. In the Function URL variant, the hook calls the SDK handler to validate the session.

---

### 1. `emailSimple` — Email Code, No Sign-Up

The simplest possible integration. Users must be pre-created (admin seeds them).

**Scenario**: Internal tool where only known employees can sign in.

**What it demonstrates**:

- `signInRequest` → code email → `signInComplete`
- Handling "user not found" gracefully (show generic "check your email" to avoid enumeration)
- Session cookie management
- Protected page with session check

**Pages**:

- `/sign-in` — email input form
- `/sign-in/verify` — code input form
- `/` — protected dashboard (redirects to `/sign-in` if no session)
- `/sign-out` — calls signOut, clears cookie

**Backend (EventBridge consumer Lambda)**:

- Receives `EmailCodeAuth` event → sends email via SES (or logs to CloudWatch for demo)
- Receives `UnsuccessfulAuth` where user doesn't exist → sends "you're not registered" email

**CDK**:

- `Auth` construct with `allowSignUp: false`
- SvelteKit app via `kit-on-lambda`
- EventBridge rule → Lambda consumer

---

### 2. `emailResend` — Email Code with Resend + Countdown

Builds on example 1 with polished UX for code resend.

**Scenario**: Consumer-facing app where resend is critical for UX.

**What it demonstrates**:

- `resendCode` endpoint usage
- Client-side countdown timer (shows seconds until resend is available)
- Reference code display (matching code to email)
- Handling `429 Throttled` response when resending too fast
- `RESEND_COOLDOWN` configuration

**Pages**:

- `/sign-in` — email input
- `/sign-in/verify` — code input + resend button with countdown + reference code display
- `/` — protected page
- `/sign-out`

**Key Svelte components**:

- `countdown.svelte` — reactive countdown from `RESEND_COOLDOWN` seconds
- Code input with auto-submit on 6 digits

**CDK**: Same as example 1 (reuses `Auth` with `allowSignUp: false`)

---

### 3. `emailSignup` — Full Sign-Up Workflow

Complete flow where new users can register.

**Scenario**: SaaS app where anyone can sign up.

**What it demonstrates**:

- `allowSignUp: true` configuration
- EventBridge consumer distinguishing between existing user (send code) vs new user (send welcome/invitation email)
- `EmailCodeAuth` event with `accountId: null` indicating sign-up
- `EmailInvitation` event for first-time users
- `EmailAddressVerified` event handling (e.g., trigger onboarding)
- Post-sign-up onboarding page

**Pages**:

- `/sign-in` — email input (same form for sign-in and sign-up)
- `/sign-in/verify` — code input + resend
- `/` — dashboard
- `/welcome` — shown after first sign-in (onboarding)
- `/sign-out`

**Backend (EventBridge consumer Lambda)**:

- `EmailCodeAuth` with `accountId !== null` → send "here's your code" email
- `EmailCodeAuth` with `accountId === null` → send "welcome, here's your code" email (different template)
- `EmailAddressVerified` → log/trigger onboarding workflow

**CDK**:

- `Auth` construct with `allowSignUp: true`
- Two EventBridge rules (or single rule with logic in handler)
- SvelteKit app

---

### 4. `emailNoSignup` — Sign-Up Blocked with Notification

Existing users can sign in; unknown emails get a "someone tried to use your email" notification.

**Scenario**: Enterprise app where IT controls user provisioning.

**What it demonstrates**:

- `allowSignUp: false`
- Custom handling of `EmailCodeAuth` event for unknown users (system still emits the event, consumer decides what email to send)
- Actually — with `allowSignUp: false`, the system emits `UnsuccessfulAuth` instead. The consumer sends a notification email to the address saying "someone attempted to sign in with your email, but you don't have an account"
- Security-conscious UX: frontend shows same "check your email" message regardless of whether account exists

**Pages**:

- `/sign-in` — email input
- `/sign-in/verify` — code input (only shown if token returned, otherwise redirect back)
- `/` — protected page
- `/sign-out`

**Backend (EventBridge consumer Lambda)**:

- `EmailCodeAuth` → send code email (only for existing users)
- `UnsuccessfulAuth` → send "unauthorized attempt" notification email to the address

**CDK**:

- `Auth` construct with `allowSignUp: false`
- EventBridge rules for both event types

---

### 5. `passkeys` — Email Code + Passkeys (Choose Method)

Full passkeys integration alongside email OTP. Users choose their preferred method.

**Scenario**: Modern consumer app offering passwordless via passkeys with email OTP as fallback.

**What it demonstrates**:

- All passkey endpoints: `registerOptions`, `registerComplete`, `authOptions`, `authComplete`
- Conditional UI: if browser supports WebAuthn, show "Sign in with passkey" option
- Discoverable credential flow (no username needed for passkey auth)
- Registering a passkey from settings page (requires active session)
- Fallback to email code when user doesn't have a passkey
- Managing multiple passkeys per user

**Pages**:

- `/sign-in` — email input + "Sign in with passkey" button (conditional on WebAuthn support)
- `/sign-in/verify` — code input (email flow)
- `/` — protected dashboard
- `/settings/passkeys` — list registered passkeys, register new, delete
- `/sign-out`

**Key Svelte logic**:

- `lib/passkeys.ts` — client-side helpers wrapping `navigator.credentials.create()` / `.get()`
- Conditional rendering based on `PublicKeyCredential` availability
- Base64url encode/decode utilities for credential data

**CDK**:

- `Auth` construct with `allowSignUp: true` + `RP_ID` env var
- EventBridge consumer for emails
- SvelteKit app

---

### 6. `emailVerify` — Non-Auth Email Verification Form

Standalone email verification flow that has nothing to do with sign-in. Shows how the code-input + countdown + resend pattern works for arbitrary verification use cases.

**Scenario**: Waitlist signup, email change confirmation, or any "prove you own this email" flow that lives outside the auth system.

**What it demonstrates**:

- Using `@beesolve/action-tokens` directly (not through service-auth) to create and verify OTP codes
- The same `codeInput` + `countdown` + `emailForm` components reused in a non-auth context
- How to build your own verification flow on top of action-tokens without service-auth
- EventBridge event emission for sending the verification email
- Clean separation: the form and UX components are framework-agnostic patterns, not tied to auth

**Pages**:

- `/` — email input form ("Enter your email to join the waitlist")
- `/verify` — code input + resend with countdown
- `/confirmed` — success page

**Backend**:

- `POST /` (server action) → generate code via action-tokens, emit event to send email
- `POST /verify` → verify code via action-tokens, mark email as confirmed
- `POST /verify/resend` → resend code with cooldown

**CDK**:

- No `Auth` construct — just action-tokens table + EventBridge + SvelteKit app
- Minimal infrastructure to show the pattern standalone

---

## Shared Code Between Examples

To keep examples readable but avoid excessive duplication:

```
packages/samples/
├── auth/
│   ├── shared/
│   │   ├── lib/
│   │   │   ├── authClient.ts        # Typed fetch wrapper for service-auth endpoints
│   │   │   ├── session.ts           # Cookie parsing + session check helper
│   │   │   └── passkeys.ts          # WebAuthn browser API helpers (base64url, credential calls)
│   │   └── components/
│   │       ├── codeInput.svelte     # 6-digit code input with auto-submit
│   │       ├── countdown.svelte     # Resend countdown timer
│   │       └── emailForm.svelte     # Simple email input form
│   ├── emailSimple/
│   │   └── stack.ts
│   ├── emailResend/
│   │   └── stack.ts
│   ├── emailSignup/
│   │   └── stack.ts
│   ├── emailNoSignup/
│   │   └── stack.ts
│   ├── passkeys/
│   │   └── stack.ts
│   └── emailVerify/
│       └── stack.ts
├── email/                           # Future: React Email template samples
├── package.json                     # private: true, workspace deps
└── README.md
```

Each example imports from `../shared/` — keeping them as readable references, not a publishable library. If patterns prove useful, they can be extracted to standalone packages later.

---

## `authClient.ts` — Service-Auth Client

A thin typed fetch wrapper for all service-auth endpoints. Shared across examples.

```ts
interface AuthClient {
  signInRequest(email: string): Promise<{ token: string; referenceCode: string }>;
  signInComplete(token: string, code: string): Promise<Response>;
  resendCode(token: string): Promise<{ token: string; referenceCode: string }>;
  signOut(sessionId: string): Promise<void>;
  // Passkey endpoints
  passkeyAuthOptions(username?: string): Promise<PublicKeyCredentialRequestOptionsJSON>;
  passkeyAuthComplete(
    token: string,
    assertion: AuthenticatorAssertionResponseJSON,
  ): Promise<Response>;
  passkeyRegisterOptions(): Promise<PublicKeyCredentialCreationOptionsJSON>;
  passkeyRegisterComplete(
    token: string,
    attestation: AuthenticatorAttestationResponseJSON,
  ): Promise<Response>;
}
```

All calls go server-side (SvelteKit server routes → service-auth Lambda). The browser never talks to service-auth directly.

---

## CDK Structure

Each example has its own CDK stack that can be deployed independently:

```
packages/samples/
├── auth/
│   ├── cdk.ts                       # App entry — registers all example stacks
│   ├── emailSimple/
│   │   ├── stack.ts                 # CDK stack for this example
│   │   ├── consumer.ts              # EventBridge consumer Lambda handler
│   │   └── site/                    # SvelteKit app
│   │       ├── src/routes/...
│   │       ├── svelte.config.js
│   │       └── package.json
│   └── ...
```

### SvelteKit Adapter Config (per example site)

```js
// svelte.config.js
import adapter from "kit-on-lambda";

export default { kit: { adapter: adapter() } };
```

### CDK Stack Pattern — Variant A (HTTP API + Authorizer)

```ts
// emailSimple/stack.ts
import { Auth } from "@beesolve/service-auth/cdk";
import { SvelteKit } from "kit-on-lambda/cdk";
import { App, Stack } from "aws-cdk-lib";

const stack = new Stack(app, "ExampleEmailSimpleHttpApi", { env });

const auth = new Auth(stack, "Auth", {
  allowSignUp: false,
  frontendUri: "https://xxx.cloudfront.net",
});

// SvelteKit behind HTTP API Gateway with Lambda authorizer
const { handler, distribution } = new SvelteKit(stack, "Site", {
  runtime: "node",
  origin: "httpApi",
  httpApi: auth.api,
  authorizer: auth.authorizer,
  buildDirectory: resolve("./emailSimple/site/build"),
});

// Auth routes added to CloudFront as /auth/* behavior
distribution.addBehavior("/auth/*", auth.authOrigin, auth.authBehavior);
```

### CDK Stack Pattern — Variant B (Function URL, session check in hooks)

```ts
// emailSimple/stack.ts (alternative)
import { Auth } from "@beesolve/service-auth/cdk";
import { SvelteKit } from "kit-on-lambda/cdk";
import { App, Stack } from "aws-cdk-lib";

const stack = new Stack(app, "ExampleEmailSimpleFunctionUrl", { env });

const auth = new Auth(stack, "Auth", {
  allowSignUp: false,
  frontendUri: "https://xxx.cloudfront.net",
});

// SvelteKit behind Function URL (current kit-on-lambda behavior)
const { handler, distribution } = new SvelteKit(stack, "Site", {
  runtime: "node",
  buildDirectory: resolve("./emailSimple/site/build"),
  lambdaProps: {
    environment: {
      AUTH_SDK_FUNCTION_NAME: auth.sdkHandler.functionName,
    },
  },
});

// Grant the SvelteKit handler permission to invoke the SDK handler
auth.sdkHandler.grantInvoke(handler);

// Auth routes added to CloudFront
distribution.addBehavior("/auth/*", auth.authOrigin, auth.authBehavior);
```

Deploy a single example:

```bash
cd packages/samples/auth/emailSimple/site && bun run build
cd ../.. && cdk deploy ExampleEmailSimple --profile samples-dev
```

---

## SvelteKit App Structure (per example)

```
site/
├── src/
│   ├── routes/
│   │   ├── +layout.server.ts    # Session check, pass user to layout
│   │   ├── +page.svelte         # Protected home page
│   │   ├── sign-in/
│   │   │   ├── +page.svelte     # Email form
│   │   │   ├── +page.server.ts  # POST: call signInRequest
│   │   │   ├── verify/
│   │   │   │   ├── +page.svelte # Code form
│   │   │   │   └── +page.server.ts # POST: call signInComplete
│   │   ├── sign-out/
│   │   │   └── +page.server.ts  # POST: call signOut
│   │   └── settings/            # (passkeys example only)
│   │       └── passkeys/
│   ├── lib/
│   │   └── server/
│   │       └── auth.ts          # Server-side auth helpers
│   └── app.html
├── svelte.config.js             # adapter: kit-on-lambda (default esbuild + Node.js)
├── package.json
└── tsconfig.json
```

---

## Implementation Order

1. **`kit-on-lambda` HTTP API mode** — implement `origin: "httpApi"` support in kit-on-lambda (prerequisite for the authorizer-based examples)
2. **Shared code** — `authClient.ts`, `session.ts`, basic Svelte components
3. **`emailSimple`** — minimal working example, both variants (HTTP API + Function URL), validate CDK setup
4. **`emailResend`** — add countdown + resend UX
5. **`emailSignup`** — add sign-up flow + EventBridge consumer logic
6. **`emailNoSignup`** — add unauthorized-attempt notification
7. **`emailVerify`** — standalone non-auth verification (validates components work outside auth context)
8. **`passkeys`** — full passkeys integration (deferred until passkeys implementation is done)

---

## Decisions

1. **Email sending** — use `@beesolve/service-email` with SES sandbox. Verified addresses: `no-reply@dev.beesolve.com` (sender), `test@dev.beesolve.com` (recipient for testing). AWS profile `samples-dev` with all required permissions.
2. **Domain setup** — use CloudFront default domains (`*.cloudfront.net`) for all examples. `__Host-` cookies work on any HTTPS origin.
3. **Passkeys RP_ID** — deferred until passkeys implementation is complete. The `passkeys` example will be built last once the RP_ID / domain situation is resolved.
