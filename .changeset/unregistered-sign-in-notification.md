---
"@beesolve/auth-service": minor
---

Notify instead of leaking on unregistered sign-in, and make `UnsuccessfulAuth` a discriminated union on `code`.

When `allowSignUp` is `false` and a sign-in is completed for an email address that has no account, `signInComplete` no longer returns "Email not registered." (which allowed account enumeration). It now emits an `UnsuccessfulAuth` event with `code: "emailNotRegistered"` and returns the same response shape as a successful sign-in, but without creating a session or setting a cookie. Subscribe to that event to notify the address owner.

`UnsuccessfulAuth.detail` is now a discriminated union on a required `code`:

- `{ code: "invalidToken", reason }`
- `{ code: "emailNotRegistered", emailAddress, reason }`

Migration for consumers of `@beesolve/auth-service/events`:

- `detail.code` is now always present — branch on it.
- `detail.emailAddress` now exists only on the `emailNotRegistered` variant. Narrow on `code === "emailNotRegistered"` before reading `emailAddress`; it is no longer nullable and is no longer present on other variants.

```ts
if (isUnsuccessfulAuth(event)) {
  if (event.detail.code === "emailNotRegistered") {
    // event.detail.emailAddress is a string here
  }
}
```
