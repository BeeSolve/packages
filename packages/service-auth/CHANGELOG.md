# @beesolve/auth-service

## 0.5.0

### Minor Changes

- d34336c: Fix cross-stack CloudFormation export error for Lambda@Edge version ARN. Add `createAuthBehavior(scope)` method to create the edge function within the consuming stack, avoiding export update conflicts. Fix session refresh drift check to compare against `createdAt` instead of `startedAt`.

## 0.4.1

### Patch Changes

- 7253dfa: fix prevention of rotating young sessions

## 0.4.0

### Minor Changes

- 35eb37e: implement AuthHandler OAC instead of origin token

## 0.3.2

### Patch Changes

- 9823894: fix session list type

## 0.3.1

### Patch Changes

- dc5d7bf: add missing prebuilt tasks handler

## 0.3.0

### Minor Changes

- 5628db5: Security hardening based on OWASP Top 10:2025 review:

  - **[Critical]** Fix open redirect via unvalidated `redirectTo` — decode + validate against `^/(?!/)`
  - **[High]** Add `requireSessionV1`/`requireSessionV2` middleware and `withDevSession` dev helper
  - **[High]** Add authorizer cache presets (`immediate`/`balanced`/`relaxed`) — default changed from 1h to `balanced` (45s)
  - **[Medium]** Add optional WAF rule group for rate limiting (`waf` prop)
  - **[Medium]** Reduce OTP `remainingUses` from 10 to 3
  - **[Low]** Emit `UnsuccessfulAuth` event from `signInComplete`
  - **[Low]** Replace `catch(asNull)` in sign-out with SQS retry for eventual session deletion
  - **[Low]** Restrict CORS to `frontendUri` with explicit allowed headers
  - **[Low]** Change `__Host-DataToken` to `SameSite=Strict`
  - **[Low]** Remove validation error details from response (log server-side only)
  - **[Low]** Add schema validation per type branch in `sdkHandler`
  - **[Low]** Add `sessions.deleteAllForUser` and expose via SDK (`deleteAllSessions` command)
  - **[Low]** Add origin verification token for CloudFront → Lambda

  ### Breaking changes

  - `authorizerCacheTtl` prop replaced with `authorizerCache` (preset string or `Duration`)
  - Default authorizer cache changed from 1h to 45s
  - CORS no longer allows all origins — `frontendUri` is now required and used
  - `UnsuccessfulAuth` event detail changed from `{ userId }` to `{ emailAddress, reason }`
  - `ORIGIN_TOKEN` env var now required (auto-injected by CDK construct)
  - SQS queue now always created (new `BEESOLVE_TASKS_MAIN_QUEUE_URL` env var)

### Patch Changes

- Updated dependencies [5628db5]
  - @beesolve/action-tokens@0.3.0

## 0.2.1

### Patch Changes

- cb6e17e: Fix `./api` export and publish pipeline.

  **`./api` export now ships compiled JavaScript**

  Previously the `./api` entry pointed at the raw `api.ts` source file, which failed in standard Node.js environments. It is now built by bunup and exported as `dist/api.js` with a matching `dist/api.d.ts` declaration file, consistent with all other package exports.

  **Publish pipeline path corrected**

  `dependencies.json` referenced `packages/auth` instead of `packages/service-auth`, causing the CI publish script to fail silently and leave the package unpublished (or published without the prebuilt Lambda zip files). The path is now correct so `prepublishOnly` runs and `dist/api.zip`, `dist/authorizer.zip`, and `dist/sdkHandler.zip` are included in the tarball.

## 0.2.0

### Minor Changes

- 02a7ace: Add `@beesolve/auth-service` package — passwordless email-code auth backed by DynamoDB and EventBridge, deployable via CDK.

  - **CDK construct** (`/cdk`): provisions DynamoDB tables (Sessions, Accounts), three Lambda functions (auth API, authorizer, SDK bridge), a Lambda Function URL (`authUrl`) for public auth endpoints, and an API Gateway HTTP API (`api`) for session-protected routes. Designed for same-domain CloudFront deployment — see `docs/cloudfront.md`.
  - **API handler**: handles `POST /auth/signInRequest`, `POST /auth/signInComplete`, and `POST /auth/signOut`. Emits EventBridge events on each action.
  - **Lambda authorizer**: validates `__Host-SID` session cookies, rotates sessions transparently, and forwards session context to downstream Lambdas.
  - **SDK client** (`/sdk`): server-to-server `AuthClient` for account lookup, account creation, and session listing from other Lambdas granted access via `auth.grantSdkAccess`.
  - **Typed event helpers** (`/events`): consumer-facing TypeScript types and `parseAuthEvent` / `isEmailCodeAuth` / `isSessionInvalidated` (etc.) type guards for processing EventBridge events via SQS without casting to `any`.
  - **Cookie utilities** (main export): `parseSid`, `parseDataTokenCookie`, `toDataTokenCookie`, `addSetCookies` helpers for server-side middleware.
  - **Error types** (main export): `BadRequestError`, `ForbiddenError`, `NotFoundError`, `UnauthorizedError`.
  - **Docs**: `docs/consuming-events.md` (typed EventBridge handler, locale detection), `docs/data-token.md` (anonymous-to-authenticated handoff), `docs/cloudfront.md` (complete CDK CloudFront example).

### Patch Changes

- Updated dependencies [d425826]
- Updated dependencies [9ac7256]
  - @beesolve/action-tokens@0.2.0
  - @beesolve/cdk-constructs@0.1.30
