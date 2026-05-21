# @beesolve/auth-service

Email-code authentication system backed by AWS DynamoDB and EventBridge, deployable via CDK. Ships three Lambda handlers (API, authorizer, SDK bridge) and a framework-agnostic CDK construct that wires them together with API Gateway, DynamoDB tables, and IAM permissions.

## Purpose

The package implements a passwordless, email-code ("magic code") sign-in flow:

1. The user submits their email address → an OTP code is generated and an `EmailCodeAuth` EventBridge event is emitted (your consumer sends the email).
2. The user submits the code they received → the session is created and a `__Host-SID` cookie is set.
3. A Lambda authorizer validates the session cookie on every subsequent request and refreshes the session transparently.

The auth logic is framework-agnostic — the API handler uses the standard Web `Request`/`Response` API so it can be adapted to any runtime. The CDK construct manages all AWS wiring so consumers only need to provide a frontend URI and a stage name.

## Installation

```sh
npm install @beesolve/auth-service
# or
bun add @beesolve/auth-service
```

## Usage

### 1 — Infrastructure (CDK)

Import from `@beesolve/auth-service/cdk` and add the `Auth` construct to your stack.

```ts
import { Auth } from "@beesolve/auth-service/cdk";

const auth = new Auth(this, "Auth", {
  stage: "prod",
  frontendUri: "https://app.example.com",
  allowSignUp: true,
});
```

The construct provisions:

- **DynamoDB tables** — `Sessions` (with a userId GSI) and `Accounts` (with a reverse-lookup GSI).
- **Three Lambda functions** — the auth API handler, a Lambda authorizer, and an SDK bridge handler.
- **Function URL** (`authUrl`) — a public, CORS-enabled endpoint for `signInRequest`, `signInComplete`, and `signOut`.
- **HTTP API** (`api`) — an API Gateway HTTP API with the Lambda authorizer attached, used for all routes that require a valid session.

#### Optional props

| Prop | Type | Description |
|---|---|---|
| `alarms` | `EmailAlarms` | Attach a `@beesolve/cdk-email-alarms` instance to report Lambda errors by email. |
| `eventBusArn` | `string` | ARN of a custom EventBridge bus. Defaults to the `default` bus. |
| `warmer` | `LambdaKeepActive` | Pass a `@beesolve/lambda-keep-active` instance to keep handlers warm. |
| `eventSource` | `string` | EventBridge source for all auth events. Defaults to `"beesolve.auth.api"`. |
| `dataToken` | `boolean` | When `true`, reads `__Host-DataToken` cookie on sign-in and fires a `DataToken` event. Defaults to `false`. |
| `logGroupProps` | `LogGroupProps` | Override Lambda log group configuration. Defaults to `RemovalPolicy.DESTROY` / 2-week retention. |

#### Adding authorized endpoints

```ts
import { Function } from "aws-cdk-lib/aws-lambda";

// Wire any Lambda behind the session-cookie authorizer
auth.addAuthorizedEndpoint({
  lambda: myApiLambda,             // your Lambda
  path: "/api/{proxy+}",           // optional, defaults to "/api/{proxy+}"
  methods: [HttpMethod.ANY],       // optional, defaults to ANY
});
```

#### Granting SDK access

```ts
// Gives myLambda permission to invoke the SDK bridge and injects
// BEESOLVE_AUTH_SDK_HANDLER_ARN into its environment
auth.grantSdkAccess(myLambda);
```

### 2 — Auth flow (client side)

The core design principle of this package is **same-domain, cookie-based authorization**. Your frontend, the auth endpoints, and your API all run behind a single CloudFront distribution at one domain (e.g. `app.example.com`). CloudFront routes `/auth/*` to the Lambda function URL and all other paths to your application and API.

Because every request — page loads, auth calls, API calls — shares the same origin, the `__Host-SID` session cookie set by the auth handler is automatically included by the browser on every subsequent API request. There is no cross-origin cookie handling, no token plumbing in your frontend code, and no CORS configuration needed between your app and the API.

See [docs/cloudfront.md](docs/cloudfront.md) for a complete CDK example.

All three endpoints expect `POST`, `Content-Type: application/json`.

#### Sign-in request

```ts
const res = await fetch(`${authUrl}/auth/signInRequest`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ emailAddress: "user@example.com" }),
  credentials: "include",
});
const { token } = await res.json(); // save `token` for the next step
```

This emits an `EmailCodeAuth` EventBridge event. Your event consumer should send the code to the user's email address.

#### Sign-in complete

```ts
const res = await fetch(`${authUrl}/auth/signInComplete`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token, code: "123456", redirectTo: "/dashboard" }),
  credentials: "include",
});
// 301 redirect with __Host-SID and aSID cookies set
```

#### Sign out

```ts
await fetch(`${authUrl}/auth/signOut`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ redirectTo: "/" }),
  credentials: "include",
});
// 301 redirect with __Host-SID cookie cleared
```

### 3 — SDK client (server-to-server)

Use `AuthClient` from `@beesolve/auth-service/sdk` inside Lambdas that have been granted SDK access via `grantSdkAccess`. The client reads `BEESOLVE_AUTH_SDK_HANDLER_ARN` from the environment automatically.

```ts
import { AuthClient } from "@beesolve/auth-service/sdk";

const auth = new AuthClient();

// Look up an account ID by email
const result = await auth.invoke({
  type: "accountIdByEmail",
  request: { emailAddress: "user@example.com" },
});
// result: { id: string } | null

// Create a new email account
const { id } = await auth.invoke({
  type: "newEmailAccount",
  request: { emailAddress: "new@example.com" },
});

// List active sessions for an account
const sessions = await auth.invoke({
  type: "sessionList",
  request: { accountId: id },
});
```

### 4 — EventBridge events

All events are emitted on the configured event bus with source `"beesolve.auth.api"` (or the value of `eventSource`).

| `detail-type` | Fired when | Key fields |
|---|---|---|
| `EmailCodeAuth` | Sign-in requested | `accountId` (null for new users), `code`, `expiresAt`, `emailAddress`, `baseUri`, `cookies`, `acceptLanguage`, `requestOrigin` |
| `EmailAddressVerified` | New account created on first sign-in | `accountId`, `emailAddress`, `verifiedAt` |
| `DataToken` | Sign-in complete with `dataToken` enabled | `accountId`, `emailAddress`, `dataToken` |
| `SuccessfulAuth` | *(reserved)* | `userId` |
| `UnsuccessfulAuth` | *(reserved)* | `userId` |
| `SessionInvalidated` | Sign out | `sessionId` |
| `EmailInvitation` | *(reserved)* | `emailAddress`, `baseUri` |

> **Important**: `EmailCodeAuth` is the integration point for email delivery. Subscribe an EventBridge rule to this event and implement your own email-sending logic (e.g. using `@beesolve/service-email`).

### 5 — Public cookie utilities

The main export (`@beesolve/auth-service`) exposes the cookie helpers used internally, which are useful for server-side middleware:

```ts
import {
  addSetCookies,
  parseSid,
  parseDataTokenCookie,
  toDataTokenCookie,
} from "@beesolve/auth-service";

// Parse the session ID from a Cookie header
const sid = parseSid(request.headers.get("cookie")); // string | null

// Parse the data token from a Cookie header
const dataToken = parseDataTokenCookie(request.headers.get("cookie")); // string | null

// Build a data-token Set-Cookie string (Max-Age 900s, SameSite=Lax)
const setCookie = toDataTokenCookie("my-token");

// Append __Host-SID and aSID Set-Cookie headers (pass maxAge=-1 to clear)
addSetCookies({
  headers: responseHeaders,
  cookies: [{ sid: sessionId, maxAge: 2592000 }],
});
```

### 6 — Error types

The main export also exposes the HTTP error classes used by the API handler:

```ts
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "@beesolve/auth-service";
```

Each class extends `Error` and carries a `stringified: boolean` property that is `true` when the constructor received a non-string argument (the `message` is then `JSON.stringify(argument)`).

## FAQ

**Q: How does the authorizer work?**

The Lambda authorizer is attached to API Gateway as a `HttpLambdaAuthorizer` with a 1-hour result cache keyed on `$request.header.Cookie`. On each request it parses `__Host-SID` from the cookie, fetches the session from DynamoDB, and either allows or denies the request. If the session is valid and older than 15 seconds it is rotated (old cookie cleared, new one issued via `Set-Cookie`). The session result is forwarded to downstream Lambdas as `event.requestContext.authorizer.lambda.session`.

**Q: What does `allowSignUp` control?**

When `allowSignUp: false`, users who complete the OTP flow but have no existing account receive a `400 BadRequest` (`"Email not registered."`). Set it to `true` to auto-create an account on first sign-in.

**Q: What is the `dataToken` feature?**

When `dataToken: true` is set on the CDK construct, the auth API reads a `__Host-DataToken` cookie from the sign-in request. On successful authentication it fires a `DataToken` EventBridge event containing the account ID, email, and the raw token value. This enables anonymous-to-authenticated data handoff (e.g. linking an anonymous shopping cart to a user account).

**Q: Can I use a custom EventBridge bus?**

Yes. Pass `eventBusArn` to the CDK construct. If omitted, the `default` event bus is used.

**Q: Why does `signInComplete` return a redirect instead of JSON?**

The redirect (HTTP 301) sets `__Host-SID` and `aSID` cookies as part of the response. This allows the browser to store the session cookie in a single round-trip, then follow the redirect to the destination page.

**Q: Why are session cookies prefixed with `__Host-`?**

The `__Host-` prefix is a browser security mechanism. Browsers refuse to set or send a `__Host-` cookie unless it is `Secure`, has no `Domain` attribute, and has `Path=/`. This means:

- The cookie cannot be set by a subdomain or a non-HTTPS response — the server can be confident the value came from the exact first-party origin it set it on.
- `__Host-SID` is also `HttpOnly`, so JavaScript running in the browser (including third-party scripts) can never read the session token via `document.cookie`. Even if an XSS attack injects a script, the session token is not exfiltrated.

**Q: How does the frontend know if the user is logged in if `__Host-SID` is hidden from JavaScript?**

The `aSID` companion cookie is set alongside `__Host-SID` on every session change. Unlike `__Host-SID`, `aSID` is not `HttpOnly`, so client-side JavaScript can read it. It holds `1` when a session is active and `0` (or a negative `Max-Age`) when the session is cleared. Your frontend reads `aSID` to show or hide the logged-in UI state — it never sees the real session token.

**Q: What are the session expiry and refresh rules?**

Sessions expire after 30 days (`defaultMaxAge = 2_592_000` seconds). The authorizer refreshes the session on every request older than 15 seconds. A refresh creates a new session row and short-expires the old one, so the window where both are valid is at most 30 seconds.

**Q: Which account types are supported?**

Currently only `email`. The schema includes `phone` and `passkey` as reserved values for future extension, but no handlers implement them yet.
