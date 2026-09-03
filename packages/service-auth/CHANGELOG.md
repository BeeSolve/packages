# @beesolve/auth-service

## 0.14.2

### Patch Changes

- 7b49cc3: Add a how-to guide for running auth-service with `kit-on-lambda` locally
  (`docs/how-to/local-development-with-kit-on-lambda.md`): why the authorizer/AWS
  context is unavailable under `vite dev`, mapping the dev `fallbackSession` to a real
  user via `DEV_USER_EMAIL`, loading `.env.local`, and the required
  `@beesolve/lambda-fetch-api` SSR-externals config. Linked from the README.

## 0.14.1

### Patch Changes

- f7e28a0: Raise `@sveltejs/kit` peer dependency range to ^2.70.3.

## 0.14.0

### Minor Changes

- ebd8317: Add passkey (WebAuthn) registration and authentication support.

  - New endpoints: `/auth/passkey/registerOptions`, `/auth/passkey/registerComplete`, `/auth/passkey/authOptions`, `/auth/passkey/authComplete`
  - Minimal CBOR decoder and COSE key parser for attestation/assertion verification (no external dependencies)
  - Account model extended with discriminated union schema supporting passkey-specific fields
  - New EventBridge events: `PasskeyRegistered`, `PasskeyAuthUsed`
  - CDK: `AuthGateway` accepts `rpId` and `rpName` props to enable passkey endpoints
  - Fix: `getOne` now accepts `{ exact: true }` option to preserve case-sensitive credential ID lookups

## 0.13.0

### Minor Changes

- f8e3f7b: Add `sessionRefreshInterval` prop to `AuthGateway` and `AuthService` constructs. The authorizer now skips session rotation when the current session is younger than the configured interval (default: 1 hour), reducing unnecessary DynamoDB writes while still running the authorizer on every request.

### Patch Changes

- d54dca7: Fix `identitySource` for `authorizerCache: "disabled"` — use empty array instead of `undefined` so CDK doesn't fall back to the default `$request.header.Authorization`, which caused API Gateway to return 401 without invoking the authorizer Lambda.
- Updated dependencies [d54dca7]
- Updated dependencies [d674ccd]
  - @beesolve/cdk-constructs@0.3.0
  - @beesolve/lambda-fetch-api@2.1.0
  - @beesolve/sqs-handler@0.2.4

## 0.12.1

### Patch Changes

- 0615a63: Move aws-cdk-lib and constructs from dependencies to peerDependencies to prevent duplicate package instances in consuming projects
- Updated dependencies [0615a63]
  - @beesolve/cdk-constructs@0.2.1
  - @beesolve/cdk-email-alarms@0.1.5
  - @beesolve/sqs-handler@0.2.2
  - @beesolve/action-tokens@0.5.2

## 0.12.0

### Minor Changes

- f1e4fc9: Add dual-mode request/response support. Handlers now accept both `application/json` and `application/x-www-form-urlencoded` request bodies via the new `getBody` helper. Sign-in and sign-out handlers return a JSON response when the client sends `Accept: application/json`, falling back to a 303 redirect otherwise. Fix redirect status from 301 to 303 (correct semantics for POST→redirect).

### Patch Changes

- Updated dependencies [f1e4fc9]
  - @beesolve/action-tokens@0.5.1
  - @beesolve/sqs-handler@0.2.1
  - @beesolve/lambda-fetch-api@2.0.2

## 0.11.0

### Minor Changes

- 04ed4d2: Add SSR session integration patterns for SvelteKit apps.

  - `createInProcessSessionHandle` — resolves sessions directly from DynamoDB without the API Gateway authorizer
  - `grantSessionAccess()` CDK method for granting a Lambda direct DynamoDB session access
  - `ensureCookieFunction` CloudFront Function to inject placeholder cookie for authorizer identity source
  - `"disabled"` authorizerCache mode for SSR apps where requests without cookies must reach the authorizer
  - `SessionContext` adds `"none"` type for routes where the authorizer did not run
  - `hasAuthorizerContext()` utility in lambda-fetch-api to detect authorizer presence

### Patch Changes

- Updated dependencies [04ed4d2]
  - @beesolve/lambda-fetch-api@2.0.1

## 0.10.0

### Minor Changes

- 3092176: Add SvelteKit integration (`@beesolve/auth-service/sveltekit`)

  - New `createSessionHandle` hook factory that populates `event.locals.session` from the Lambda authorizer context and forwards session cookies to the response
  - Dev fallback presets: `devValidSession`, `devInvalidSession`, `devExpiredSession`
  - New `getSessionContext()` with auto-detection of HTTP API (v2) vs REST API (v1)
  - Explicit `getSessionContextV1()` and `getSessionContextV2()` for full control
  - Optional `@sveltejs/kit` peer dependency (only needed when importing `/sveltekit`)

  Breaking changes:

  - Removed `requireSessionV1` and `requireSessionV2` (unused, replaced by `getSessionContext`)
  - Renamed internal `src/requireSession.ts` to `src/sessionContext.ts`

### Patch Changes

- Updated dependencies [3092176]
  - @beesolve/lambda-fetch-api@2.0.0

## 0.9.0

### Minor Changes

- 39a97ac: Split `Auth` CDK construct into `AuthGateway` (with API Gateway authorizer) and `AuthService` (standalone, no API Gateway). Add `./sessionAuthorizer` export with `SessionAuthorizer` class and `withSession` wrapper for in-process session verification. Extract shared authorize logic into `src/authorize.ts` and refactor CDK code into composable helper functions.

## 0.8.0

### Minor Changes

- c5a8322: Add resend code endpoint (`/auth/resendCode`) with per-email throttling and configurable cooldown. Migrate `signInRequest` to use `createNewWithThrottling` with reference code generation. Map `TokenThrottledError` to HTTP 429. Add `resendCooldown` and `drainOnResend` CDK props.

  Update README: add mermaid sequence diagrams, use relative URLs in client examples, document resend flow, add FAQ entries.

## 0.7.0

### Minor Changes

- ff131ea: Date fields (`expiresAt`, `createdAt`, `startedAt`, `updatedAt`) are now ISO timestamp strings instead of `Date` objects. Use `Date.parse(value)` for comparisons or `new Date(value)` to convert.

  Migrate from Biome to Oxlint + Oxfmt. Add `@beesolve/lint-config` with custom rules. Replace `T[]` with `Array<T>` syntax. Add typeguards to lambda-fetch-api authorizer.

### Patch Changes

- Updated dependencies [ff131ea]
  - @beesolve/action-tokens@0.5.0
  - @beesolve/lambda-fetch-api@1.0.1
  - @beesolve/helpers@0.1.7

## 0.6.1

### Patch Changes

- 3b965b3: Fix API Gateway access log deployment failure by adding required `format` field to `accessLogSettings`.

## 0.6.0

### Minor Changes

- c2bd8aa: Add optional `encryptionKey` prop for customer-managed KMS encryption on all data-at-rest resources (DynamoDB tables and SQS queues).

  **@beesolve/cdk-constructs**

  - `SqsWithDlq`: add `encryptionKey?: IKey` — uses KMS encryption when provided
  - `Nodejs24Function`: add VPC + DynamoDB Gateway Endpoint documentation

  **@beesolve/sqs-handler**

  - `SqsHandler`: add `encryptionKey?: IKey` — forwarded to SQS queues

  **@beesolve/action-tokens**

  - Add `encryptionKey?: IKey` for customer-managed table encryption
  - Add `contributorInsights?: boolean` for CloudWatch Contributor Insights
  - Default `deletionProtection` to `true` when `removalPolicy` is `RETAIN`
  - Default `pointInTimeRecoveryEnabled` to `true` when `deletionProtection` is `true`

  **@beesolve/auth-service**

  - Add `encryptionKey?: IKey` applied to all tables and SQS queues
  - Add `contributorInsights?: boolean` (default `true` in prod)
  - Add `accessLogging?: boolean` for HTTP API access logs (default `true` in prod)
  - Add `authorizerReservedConcurrency?: number`
  - Add `sdkHandlerReservedConcurrency?: number`
  - Add CDK warning when `alarms` is not provided

### Patch Changes

- Updated dependencies [c2bd8aa]
  - @beesolve/cdk-constructs@0.2.0
  - @beesolve/sqs-handler@0.2.0
  - @beesolve/action-tokens@0.4.0

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
