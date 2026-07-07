# Passkeys Authentication Plan for `service-auth`

## Current Architecture Summary

- **Email OTP flow**: `signInRequest` → emits code via EventBridge → `signInComplete` verifies code via action-tokens → creates session
- **Accounts table**: already supports `type: "passkey"` in the schema (partition key: `id`, sort key: `username`)
- **Sessions**: created on successful auth, stored in DynamoDB with TTL
- **CDK**: single Lambda behind CloudFront with function URL + OAC

---

## 1. Accounts Table — Discriminated Union Schema

Reuse the existing accounts table (PK: `id`, SK: `username`, reverse GSI on `username → id`). Passkey credentials are stored as account records with `type: "passkey"` where `username` holds the base64url-encoded `credentialId`.

No prefix on the credential ID — it's a random byte sequence (32-64 bytes, base64url-encoded) that cannot collide with email addresses or phone numbers. The `type` discriminator is sufficient to distinguish record kinds.

The Valibot schema becomes a discriminated union:

```ts
const baseFields = { id: v.string(), createdAt: dateSchema, updatedAt: dateSchema };

const schema = v.variant("type", [
  v.object({ ...baseFields, type: v.literal("email"), username: v.string() }),
  v.object({ ...baseFields, type: v.literal("phone"), username: v.string() }),
  v.object({
    ...baseFields,
    type: v.literal("passkey"),
    username: v.string(), // credentialId (base64url)
    publicKey: v.string(), // base64url-encoded SPKI/DER public key
    counter: v.number(), // signature counter for replay detection
    transports: v.array(v.string()), // e.g. ["internal", "hybrid"]
    aaguid: v.string(), // authenticator AAGUID
    backedUp: v.boolean(), // multi-device credential (from flags)
  }),
]);
```

**Lookup patterns:**

- **By userId** (PK query): returns all accounts including passkeys — used in `registerOptions` to build `excludeCredentials`
- **By credentialId** (reverse GSI query on `username`): returns the passkey account — used in `authComplete` to find the credential during authentication

## 2. New API Endpoints

### Registration (authenticated users adding a passkey)

| Endpoint                              | Purpose                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/passkey/registerOptions`  | Generate and return `PublicKeyCredentialCreationOptions` (challenge, rp, user info, pubKeyCredParams, excludeCredentials) |
| `POST /auth/passkey/registerComplete` | Verify attestation response, store credential                                                                             |

### Authentication (passwordless sign-in)

| Endpoint                          | Purpose                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /auth/passkey/authOptions`  | Generate and return `PublicKeyCredentialRequestOptions` (challenge, allowCredentials, rpId) |
| `POST /auth/passkey/authComplete` | Verify assertion response, create session                                                   |

## 3. Challenge Storage

Use the existing `@beesolve/action-tokens` service to store challenges:

- **Action**: `"passkeyRegister"` or `"passkeyAuth"`
- **Value**: the random challenge (base64url)
- **Owner**: a temporary token returned to the client
- **Expiry**: 5 minutes
- **Remaining uses**: 1 (single use)

This reuses the existing infrastructure without new tables for ephemeral challenges.

## 4. Server-Side Crypto (No Libraries)

All verification uses Node.js `node:crypto`:

- **Challenge verification**: compare stored challenge with `clientDataJSON.challenge`
- **Origin verification**: validate `clientDataJSON.origin` matches `env.BASE_URI`
- **Signature verification** (assertion): use `crypto.createVerify()` or `crypto.verify()` with the stored public key in SPKI/DER format against the signed data (`authenticatorData + SHA-256(clientDataJSON)`)
- **Attestation parsing** (registration): parse CBOR-encoded `attestationObject` to extract `authData` → credential ID, public key, flags. For `"none"` attestation (recommended for consumer apps), skip attestation statement verification.
- **CBOR decoding**: implement a minimal CBOR decoder (~100 lines) for parsing `attestationObject` and the COSE public key. Only needs to handle the subset WebAuthn produces (maps, byte strings, integers, text, arrays). **Must be thoroughly tested** — use known attestation payloads from the WebAuthn spec / FIDO conformance tests as test vectors. Cover: maps with integer keys (COSE), maps with text keys (attestationObject top-level), nested byte strings, negative integers (COSE algorithm identifiers like -7), and arrays (credential transports).

## 5. Registration Flow

```
Client                                Server
  |                                      |
  |-- POST /passkey/registerOptions ---->|  (requires active session)
  |                                      |  - Generate 32-byte random challenge
  |                                      |  - Query user's existing passkey accounts for excludeCredentials
  |                                      |  - Store challenge in action-tokens
  |                                      |  - Return PublicKeyCredentialCreationOptions
  |<---- { challenge, rp, user, ... } ---|
  |                                      |
  | navigator.credentials.create()       |
  |                                      |
  |-- POST /passkey/registerComplete --->|  (requires active session)
  |   { token, attestationResponse }     |  - Retrieve & consume challenge from action-tokens
  |                                      |  - Parse clientDataJSON, verify origin + type
  |                                      |  - Parse attestationObject (CBOR)
  |                                      |  - Extract credentialId, publicKey, counter, flags
  |                                      |  - Store as account record (type: "passkey", username: credentialId)
  |<---- { success: true } -------------|
```

## 6. Authentication Flow

```
Client                                Server
  |                                      |
  |-- POST /passkey/authOptions -------->|  (unauthenticated)
  |   { }  (or { username } for hints)  |  - Generate 32-byte random challenge
  |                                      |  - Optionally look up allowCredentials by username
  |                                      |  - Store challenge in action-tokens
  |<---- { challenge, rpId, allow... } --|
  |                                      |
  | navigator.credentials.get()          |
  |                                      |
  |-- POST /passkey/authComplete ------->|  (unauthenticated)
  |   { token, assertionResponse }       |  - Retrieve & consume challenge
  |                                      |  - Query reverse GSI by credentialId (username field)
  |                                      |  - Narrow result to type: "passkey" → get publicKey, counter
  |                                      |  - Parse clientDataJSON, verify origin + type
  |                                      |  - Verify signature over (authData + hash(clientDataJSON))
  |                                      |  - Verify counter > stored counter, update counter
  |                                      |  - Create session (same as signInComplete)
  |                                      |  - Emit SuccessfulAuth event
  |<---- 301 + Set-Cookie: __Host-SID --|
```

## 7. Events

Add new event types to the `Events` class:

- **`PasskeyRegistered`**: `{ accountId, credentialId, createdAt }`
- **`PasskeyAuthUsed`** (optional, for audit): `{ accountId, credentialId }`

Update the consumer-facing `events.ts` schemas accordingly.

## 8. CDK Changes

In the `Auth` construct:

1. Add an env variable `RP_ID` (relying party ID, typically the domain without port) to the auth handler
2. No new tables — passkey credentials are stored in the existing accounts table
3. No new permissions — the handler already has read/write on accounts table
4. The authorizer Lambda needs no changes (sessions work identically)

## 9. File Structure

```
src/
├── passkey/
│   ├── cbor.ts              # Minimal CBOR decoder
│   ├── cose.ts              # COSE key → Node.js KeyObject conversion
│   ├── parseAuthData.ts     # Parse authenticator data bytes
│   └── verify.ts            # Signature + origin + challenge verification
├── account.ts               # Extended with discriminated union schema + passkey fields
├── handlers/
│   ├── passkeyRegisterOptions.ts
│   ├── passkeyRegisterComplete.ts
│   ├── passkeyAuthOptions.ts
│   └── passkeyAuthComplete.ts
tests/
├── cbor.test.ts             # Thorough CBOR decoder tests
├── cose.test.ts
├── parseAuthData.test.ts
└── verify.test.ts
```

## 10. Security Considerations

- **RP ID**: set to the effective domain (e.g., `example.com`) — must match `BASE_URI` origin
- **User verification**: require `"preferred"` for auth, `"required"` for registration
- **Attestation**: use `"none"` conveyance — avoids needing to validate attestation certificates
- **Replay protection**: enforce monotonically increasing signature counter
- **Resident credentials**: support discoverable credentials (passkeys) by setting `requireResidentKey: true` in registration options — enables username-less sign-in
- **Challenge entropy**: 32 random bytes (same as existing token generation)
- **Cross-origin**: validate `clientDataJSON.origin` strictly against configured `BASE_URI`

## 11. Migration / Coexistence

- Email OTP and passkeys coexist — users can have both account types
- A user who registered via email can add a passkey later (via `registerOptions` while authenticated)
- `authOptions` without a username triggers a discoverable credential prompt (browser shows available passkeys)
- `authOptions` with a username returns `allowCredentials` filtered to that user's credentials

## 12. Implementation Order

1. CBOR decoder + thorough tests (pure function, easy to validate against known WebAuthn payloads)
2. COSE key parser + authenticator data parser + tests
3. Update `account.ts` with discriminated union schema and passkey-specific methods
4. Registration handlers
5. Authentication handlers
6. Wire into `api.ts` router
7. CDK changes (add `RP_ID` env var)
8. Update consumer-facing event types
9. Integration tests
