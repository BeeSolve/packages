# Plan: `authWithPasskeys` Sample

> A new deployable sample demonstrating passkey (WebAuthn) registration and authentication alongside email OTP sign-in.

## Rationale — New sample vs. modifying existing

The existing samples are deliberately minimal and focused:

- `authEmailSimple` — minimal email OTP, no real email delivery, demonstrates in-process session
- `authWithEmail` — email OTP with real email delivery via `@beesolve/email-service`
- `authSpaWithApi` — React SPA with tRPC API, authorizer pattern

Adding passkey UI to any of these would conflate concerns and make them harder to follow for users only interested in the original pattern. A dedicated sample clearly demonstrates the passkey user journey without noise.

## User Journey Demonstrated

1. Open the app → redirected to `/sign-in`
2. Enter email → receive code in CloudWatch logs (no real email, same as `authEmailSimple`)
3. Enter code → authenticated, redirected to dashboard
4. Dashboard shows "Register a passkey" button
5. Click it → browser shows biometric/PIN prompt → passkey stored → success feedback
6. Click "Sign out"
7. Back on `/sign-in` → click "Sign in with passkey" → browser shows passkey picker → authenticated without email

## File Structure

```
packages/samples/authWithPasskeys/
├── consumer.ts              # EventBridge consumer (logs email code + passkey events)
├── stack.ts                 # CDK stack (AuthGateway with rpId)
└── site/
    ├── package.json
    ├── svelte.config.js
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── app.html
        ├── app.d.ts
        ├── hooks.server.ts
        └── routes/
            ├── +page.server.ts      # Dashboard load: session info
            ├── +page.svelte         # Dashboard: sign out + register passkey + passkey list
            └── sign-in/
                ├── +layout.server.ts  # Redirect if already authenticated
                ├── +page.svelte       # Email form + "Sign in with passkey" button
                └── verify/
                    └── +page.svelte   # OTP code input
```

## Files to Create

### 1. `packages/samples/shared/utils/passkeyClient.ts`

Shared client-side utility for all passkey operations. Used by any sample that needs passkeys.

Exports:

- `bufferToBase64url(buffer: ArrayBuffer): string` — convert ArrayBuffer to base64url
- `base64urlToBuffer(base64url: string): ArrayBuffer` — convert base64url to ArrayBuffer
- `registerPasskey(displayName?: string): Promise<{ credentialId: string }>` — full registration ceremony:
  1. POST `/auth/passkey/registerOptions` with `{ displayName }`
  2. Call `navigator.credentials.create()` with decoded options
  3. POST `/auth/passkey/registerComplete` with encoded attestation response
  4. Return `{ credentialId }`
- `signInWithPasskey(): Promise<void>` — full authentication ceremony:
  1. POST `/auth/passkey/authOptions` with `{}`
  2. Call `navigator.credentials.get()` with decoded options
  3. POST `/auth/passkey/authComplete` with encoded assertion response
  4. Navigate to `redirectTo`

### 2. `packages/samples/authWithPasskeys/stack.ts`

CDK stack based on `authEmailSimple` pattern with additions:

- `rpId` derived from `frontendUri` (strip protocol + port, e.g. `"d1234.cloudfront.net"`)
- `rpName: "Passkey Sample"`
- Consumer subscribes to `EmailCodeAuth`, `UnsuccessfulAuth`, `PasskeyRegistered`, `PasskeyAuthUsed`

```ts
const auth = new AuthGateway(this, "Auth", {
  stage: "dev",
  frontendUri,
  allowSignUp: true,
  rpId: new URL(frontendUri).hostname,
  rpName: "Passkey Sample",
  alarms,
});
```

### 3. `packages/samples/authWithPasskeys/consumer.ts`

Logs all events to CloudWatch (no real email sending):

```ts
if (isEmailCodeAuth(event)) {
  console.log(`[EmailCodeAuth] Send code ${code} to ${emailAddress}`);
}
if (isPasskeyRegistered(event)) {
  console.log(`[PasskeyRegistered] User ${userId} registered ${credentialId}`);
}
if (isPasskeyAuthUsed(event)) {
  console.log(`[PasskeyAuthUsed] User ${userId} signed in with ${credentialId}`);
}
```

### 4. `packages/samples/authWithPasskeys/site/src/hooks.server.ts`

Same as `authEmailSimple` — `createInProcessSessionHandle()` + auth guard with public paths `/sign-in` and `/sign-in/verify`.

### 5. Sign-in page (`routes/sign-in/+page.svelte`)

Two actions on the sign-in page:

- **Primary**: Email form (reuses `$shared/components/emailForm.svelte`) — required for first sign-up
- **Secondary**: "Sign in with passkey" button — calls `signInWithPasskey()` from `passkeyClient.ts`

Layout:

```
┌─────────────────────────────┐
│        Sign in              │
│                             │
│  [email input         ]     │
│  [Send code            ]    │
│                             │
│  ── or ──                   │
│                             │
│  [Sign in with passkey]     │
└─────────────────────────────┘
```

The "Sign in with passkey" button is always visible (browser capabilities detection is optional — if no passkeys exist, the browser will show an empty picker or error, which is acceptable for a sample).

### 6. Verify page (`routes/sign-in/verify/+page.svelte`)

Reuses `$shared/components/codeInput.svelte`. Same as `authEmailSimple`.

### 7. Dashboard page (`routes/+page.svelte`)

Shows:

- Session info (session ID)
- "Register a passkey" button → calls `registerPasskey()` → shows success/error message
- Sign out button

The passkey list is intentionally omitted from the dashboard to keep the sample simple. The focus is on the register + auth ceremony, not credential management UI. (A comment in the code can note that `getPasskeysByUserId` exists for apps that want to show/manage credentials.)

### 8. Dashboard server load (`routes/+page.server.ts`)

Returns session ID (same as `authEmailSimple`). No server-side passkey data needed for this sample.

## Files to Modify

### 1. `packages/samples/app.ts`

Add:

```ts
import { AuthWithPasskeysStack } from "./authWithPasskeys/stack.ts";

new AuthWithPasskeysStack(app, "SamplesAuthWithPasskeys", {
  env: { account, region },
});
```

### 2. `packages/samples/mise.toml.example`

Add:

```
SAMPLES_AUTH_WITH_PASSKEYS_FRONTEND_URI = "<cloudfront-distribution-url>"
```

### 3. `packages/samples/package.json`

Add to scripts:

```json
"deploy:authWithPasskeys": "cd authWithPasskeys/site && bun run vite build && cd - && bun run cdk deploy SamplesAuthWithPasskeys --require-approval never"
```

### 4. `packages/samples/README.md`

Add sample description:

```
### authWithPasskeys

Email code authentication with passkey (WebAuthn) support. Demonstrates the full
passkey lifecycle: sign up via email → register a passkey → sign in with passkey.
Uses `rpId` on the AuthGateway construct to enable passkey endpoints.
```

## Comparison with Existing Samples

| Aspect            | authEmailSimple                     | authWithPasskeys                                |
| ----------------- | ----------------------------------- | ----------------------------------------------- |
| CDK construct     | `AuthGateway` (no `rpId`)           | `AuthGateway` with `rpId` + `rpName`            |
| Sign-in page      | Email form only                     | Email form + "Sign in with passkey" button      |
| Dashboard         | Session ID + sign out               | Session ID + sign out + register passkey button |
| Consumer events   | `EmailCodeAuth`, `UnsuccessfulAuth` | + `PasskeyRegistered`, `PasskeyAuthUsed`        |
| Shared utils used | `authClient.ts`                     | `authClient.ts` + `passkeyClient.ts`            |
| Complexity        | Minimal                             | Moderate (one extra button per page)            |

## Design Decisions

1. **Email first, passkey secondary on sign-in** — since passkey-only signup isn't supported, the email form is primary. The passkey button appears below a separator ("or"). This matches the actual user journey.

2. **No passkey list on dashboard** — keeps the sample focused on the ceremony. A comment points to `getPasskeysByUserId` for apps that want credential management.

3. **No browser feature detection** — the sample doesn't check `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`. If passkeys aren't supported, the browser will show an error. Acceptable for a reference sample; production apps should add detection.

4. **`passkeyClient.ts` in shared** — allows future samples (e.g. an SPA variant) to reuse the same passkey logic without duplication.

5. **No real email delivery** — same as `authEmailSimple`. Codes appear in CloudWatch logs. Keeps deployment simple (no SES setup required).

## Implementation Order

1. Create `shared/utils/passkeyClient.ts` (pure client-side, no dependencies)
2. Create `authWithPasskeys/site/` SvelteKit app (copy from `authEmailSimple`, add passkey UI)
3. Create `authWithPasskeys/stack.ts` and `consumer.ts`
4. Wire into `app.ts`, `package.json`, `mise.toml.example`, `README.md`
5. Build site, type-check, verify lint passes
