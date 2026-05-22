# Security Review: `packages/service-auth/`

Reviewed against [OWASP Top 10:2025](https://owasp.org/Top10/2025/) (RC1).

---

## A01:2025 — Broken Access Control

### [Critical] Open redirect via unvalidated `redirectTo`

**Files:** `src/handlers/signInComplete.ts:27,82`, `src/handlers/signOut.ts:17,47`

Both handlers accept `redirectTo` from the request body as a plain string and use it directly in the `Location` header:

```ts
redirectTo: v.optional(v.string()),
// ...
Location: redirectTo ?? "/",
```

Any string is accepted — including `//evil.com` or `https://attacker.com`. An attacker crafts a sign-in link with `redirectTo` pointing to a phishing site. After the user completes legitimate OTP verification, the browser is sent there.

**Fix:** Constrain `redirectTo` to relative paths only:

```ts
redirectTo: v.optional(v.pipe(v.string(), v.regex(/^\/(?!\/)/)))
```

---

### [High] Lambda authorizer always returns `Effect: "Allow"`

**File:** `authorizer.ts:166-179`

The authorizer returns `Allow` for all outcomes — valid, expired, and non-existent sessions alike. Session state is serialized into `context.session` and downstream handlers are expected to check it:

```ts
// same for type: "invalid", "expired", and "valid"
Statement: [{ Action: "execute-api:Invoke", Effect: "Allow", Resource: resource }]
```

This shifts the entire enforcement burden to every individual downstream Lambda. A single handler that doesn't parse `context.session` admits all requests including completely unauthenticated ones.

**Fix:** Return `Effect: "Deny"` for `"invalid"` and `"expired"` contexts. Only `"valid"` should return `"Allow"`.

---

### [High] 1-hour authorizer cache makes sign-out ineffective

**File:** `cdk.ts:217-219`

```ts
identitySource: ["$request.header.Cookie"],
resultsCacheTtl: props.authorizerCacheTtl ?? Duration.hours(1),
```

API Gateway caches the authorizer decision keyed by cookie value. After sign-out, the session is deleted from DynamoDB — but for up to one hour, any request carrying the old cookie still gets `Allow` from the cache without hitting the authorizer Lambda.

**Fix:** Default to `Duration.seconds(0)`, or document the security implication and let callers opt in to caching with a short TTL (e.g., 60 seconds).

---

## A02:2025 — Security Misconfiguration

### [Low] CORS wildcard on auth function URL

**File:** `cdk.ts:267-272`

```ts
cors: {
  allowedOrigins: ["*"],
  allowedMethods: [LambdaHttpMethod.POST],
  allowedHeaders: ["*"],
}
```

The auth function URL allows POST from any origin with any headers. Cross-origin requests can trigger OTP emails on behalf of users. Combined with the open redirect above, a cross-origin attacker can initiate sign-in for a victim and redirect them post-auth.

**Fix:** Restrict `allowedOrigins` to `[props.frontendUri]` and enumerate `allowedHeaders` explicitly.

---

### [Low] `__Host-DataToken` uses `SameSite=Lax`

**File:** `src/cookie.ts:34`

```ts
return `${cookieName}=${token}; HttpOnly; Max-Age=${maxAge}; SameSite=Lax; Secure; Path=/`;
```

The session cookie (`__Host-SID`) correctly uses `SameSite=Strict`. The data token uses `Lax`, permitting it to be sent on top-level cross-site navigations. Since the data token carries a pre-auth identity claim, it should use `Strict`.

**Fix:** Change `SameSite=Lax` to `SameSite=Strict` in `toDataTokenCookie`.

---

### [Low] Validation errors expose schema structure

**File:** `src/request.ts:11-14`

```ts
throw new BadRequestError({ message: `Error parsing request body.`, details: issues.nested });
```

Valibot's flattened `issues.nested` reveals internal field names and constraint violations to API callers.

**Fix:** Omit `details` from the response: `throw new BadRequestError("Error parsing request body.")`.

---

## A03:2025 — Software Supply Chain Failures

### [Observation] All dependencies pinned to `catalog:` references

All `package.json` dependencies defer version resolution to a workspace-level catalog. The actual versions can't be audited from this package alone. Ensure the catalog pins exact versions or tight ranges with a lock file, and that `@beesolve/action-tokens` — which handles OTP token creation and validation — is versioned with the same rigour as external packages.

---

## A04:2025 — Cryptographic Failures

No issues found. Session tokens use `randomBytes(32).toString("base64url")` (256-bit entropy, CSPRNG). OTPs use `randomInt` from `node:crypto`. DynamoDB tables are encrypted with `TableEncryptionV2.awsManagedKey()`. The `__Host-` cookie prefix enforces `Secure` at the protocol level.

---

## A05:2025 — Injection

No issues found. All DynamoDB queries use `ExpressionAttributeNames` and `ExpressionAttributeValues` — no string interpolation into query expressions.

---

## A06:2025 — Insecure Design

### [Medium] No rate limiting on `/signInRequest`

**File:** `api.ts:105-128`

No rate limiting exists at any layer. An attacker can call `/signInRequest` in a tight loop for a victim's email, causing:

1. Inbox flooding — an OTP email is fired via EventBridge on every call
2. Continuous overwrite of the previous OTP (`overwrite: true`), blocking the legitimate user from completing sign-in
3. SES cost amplification

**Fix:** Apply AWS WAF rate-based rules to the function URL, or add a per-email/per-IP throttle before calling `actionTokens.createNew`.

---

### [Medium] OTP `remainingUses: 10` is too permissive

**File:** `src/handlers/signInRequest.ts:57`

```ts
remainingUses: 10,
```

Ten guesses on a 6-digit code gives a 1/100,000 success rate per OTP. Combined with unlimited re-requests, an attacker can cycle through fresh tokens and attempt brute-force. Standard practice is 3–5 attempts.

**Fix:** Reduce to `remainingUses: 3`.

---

### [Low] No session invalidation on new sign-in

**File:** `src/handlers/signInComplete.ts`

When `signInComplete` succeeds, a new session is created but existing sessions for that account are left active. An attacker who previously compromised a session cookie retains access indefinitely. The `sessionList` SDK command provides visibility, but no revoke-all mechanism is exposed.

**Fix:** Emit a `SessionsRevoked` event on sign-in or document this explicitly so callers know to build revocation UI on top of `sessionList`.

---

### [Low] CloudFront headers trusted without origin verification

**File:** `src/session.ts:345-440`

`Sessions.dataFromCloudFrontHeaders` reads `CloudFront-Viewer-City`, `CloudFront-Is-Android-Viewer`, etc. from raw request headers. If the Lambda function URL is invoked directly (bypassing CloudFront), an attacker can inject arbitrary geo/device metadata into session records, corrupting session analytics and any downstream logic that trusts this data.

**Fix:** Document that the function URL must be fronted exclusively by CloudFront in production. Optionally verify a shared CloudFront secret header.

---

## A07:2025 — Authentication Failures

The rate limiting and `remainingUses` issues (A06) directly affect authentication brute-force resilience. No additional distinct issues beyond those.

---

## A08:2025 — Software or Data Integrity Failures

### [Low] `sdkHandler` deserializes events without schema validation

**File:** `sdkHandler.ts:88`

```ts
const { type, request } = decodeFromStringifiable<HandlerEvent>(event);
```

The handler trusts the decoded payload and branches on `type` without validating the shape of `request` before passing it to `accounts.createNew` or `accounts.getOne`. A malformed invocation will reach the DynamoDB layer and produce an opaque error.

**Fix:** Validate `request` with a valibot schema per `type` branch before use, consistent with how the API handler validates request bodies.

---

## A09:2025 — Security Logging and Alerting Failures

### [Low] `UnsuccessfulAuth` event is defined but never emitted

**Files:** `src/events.ts:93-98`, `src/handlers/signInComplete.ts`

The `UnsuccessfulAuth` event type exists but is never fired. Failed sign-in attempts — wrong OTP, expired token, unregistered email when `allowSignUp: false` — produce no audit trail, making brute-force detection and anomaly alerting impossible.

**Fix:** Emit `UnsuccessfulAuth` from `signInComplete` whenever `actionTokens.use` throws or the code is rejected.

---

## A10:2025 — Mishandling of Exceptional Conditions

### [Low] Sign-out silently swallows session deletion failures

**File:** `src/handlers/signOut.ts:34-35`

```ts
sessions.delete(sid).catch(asNull),
```

If DynamoDB is unavailable and session deletion fails, the error is swallowed and the user is redirected as if sign-out succeeded. The session record remains active.

**Fix:** Either propagate the error (fail the sign-out) or emit a compensating event so the failure is observable and retryable.

---

## Summary

| # | Severity | OWASP 2025 | Issue | File |
|---|----------|-----------|-------|------|
| 1 | Critical | A01 | Open redirect via unvalidated `redirectTo` | `signInComplete.ts:82`, `signOut.ts:47` |
| 2 | High | A01 | Authorizer always returns `Allow` | `authorizer.ts:168` |
| 3 | High | A01 | 1-hour cache defeats sign-out | `cdk.ts:219` |
| 4 | Medium | A06 | No rate limiting on `/signInRequest` | `api.ts:105` |
| 5 | Medium | A06 | `remainingUses: 10` too permissive | `signInRequest.ts:57` |
| 6 | Low | A09 | `UnsuccessfulAuth` event never fired | `signInComplete.ts`, `events.ts` |
| 7 | Low | A10 | Sign-out swallows session deletion failure | `signOut.ts:34` |
| 8 | Low | A02 | CORS wildcard on auth function URL | `cdk.ts:268` |
| 9 | Low | A02 | `__Host-DataToken` uses `SameSite=Lax` | `cookie.ts:34` |
| 10 | Low | A02 | Validation errors expose schema internals | `request.ts:12` |
| 11 | Low | A08 | `sdkHandler` no schema validation on request | `sdkHandler.ts:88` |
| 12 | Low | A06 | No session invalidation on re-sign-in | `signInComplete.ts` |
| 13 | Low | A06 | CloudFront headers trusted without verification | `session.ts:345` |

**Sound foundations:** CSPRNG everywhere, `__Host-` prefixed cookies with `HttpOnly`/`Secure`/`SameSite=Strict`, parameterized DynamoDB expressions throughout, conditional writes preventing duplicate accounts, email normalized to lowercase before storage.
