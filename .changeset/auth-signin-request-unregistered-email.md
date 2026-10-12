---
"@beesolve/auth-service": minor
---

`signInRequest` now emits `UnsuccessfulAuth`/`emailNotRegistered` instead of `EmailCodeAuth`
when `allowSignUp` is `false` and the email is not registered. Previously an unregistered
email received a sign-in code at step 1 and then a "not registered" email at step 2 (after
submitting the code) — now it receives only the "not registered" email and never a code.

To keep the request indistinguishable between registered and unregistered emails (preventing
email enumeration and timing attacks), all other work is unchanged: the action token is still
created with the same expiry and throttling, and the HTTP response still returns the same
`token`/`referenceCode`/`expiresAt`. Only the emitted EventBridge event differs. The returned
token is harmless for an unknown email because `signInComplete` creates no session when the
account is missing and `allowSignUp` is `false`.

When `allowSignUp` is `true`, behavior is unchanged (unknown emails continue to sign up at
step 2). Consumers already subscribed to both `EmailCodeAuth` and `UnsuccessfulAuth` (as in the
service-email-dashboard auth consumer) require no changes.
