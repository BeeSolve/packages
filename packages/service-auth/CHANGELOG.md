# @beesolve/auth-service

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
