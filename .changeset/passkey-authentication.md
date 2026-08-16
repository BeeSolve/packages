---
"@beesolve/auth-service": minor
---

Add passkey (WebAuthn) registration and authentication support.

- New endpoints: `/auth/passkey/registerOptions`, `/auth/passkey/registerComplete`, `/auth/passkey/authOptions`, `/auth/passkey/authComplete`
- Minimal CBOR decoder and COSE key parser for attestation/assertion verification (no external dependencies)
- Account model extended with discriminated union schema supporting passkey-specific fields
- New EventBridge events: `PasskeyRegistered`, `PasskeyAuthUsed`
- CDK: `AuthGateway` accepts `rpId` and `rpName` props to enable passkey endpoints
- Fix: `getOne` now accepts `{ exact: true }` option to preserve case-sensitive credential ID lookups
