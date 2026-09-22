# Unregistered Sign-In Notification (no email enumeration)

## Status: Not Started

## Problem Statement

When `signInComplete` runs with `allowSignUp = false` and the submitted email address is not registered, the handler currently emits an `UnsuccessfulAuth` event with `reason: "Email not registered."` and throws `BadRequestError("Email not registered.")`, which surfaces the literal text to the client as an HTTP 400. This leaks whether an email address exists in the system, enabling account-enumeration by an attacker who guesses addresses.

We want two behavioural changes:

1. **Stop leaking enumeration signal to the client.** When sign-up is disallowed and the email is unknown, the client should receive a response indistinguishable from a successful sign-in flow — no "Email not registered." message and no distinguishing status code — so an attacker cannot tell registered from unregistered addresses. No session is created for the unknown address.
2. **Notify the real owner of the address.** React to the event by sending an email to the attempted address, informing them that someone tried to sign in with their email but it is not present in the system, and that they should contact an administrator. This is done in the dashboards' `authConsumer` (the existing auth-event consumer), matching the established pattern for `EmailCodeAuth`.

To make the consumer able to reliably distinguish "email not registered" from every other `UnsuccessfulAuth` reason (currently only a free-text `reason` string exists, which is fragile to match on), we add a machine-readable discriminator `code` field to the `UnsuccessfulAuth` event detail.

## Architecture / Approach

### Event flow (unchanged transport)

Producer (`Events.putEvents` in `service-auth`) → EventBridge custom bus (`EVENT_BUS_ARN`, source `EVENT_SOURCE`) → `AuthEventsRule` (already filters `detailType: ["EmailCodeAuth", "UnsuccessfulAuth"]`) → `authConsumer` Lambda in each dashboard → `email.sendEmail(...)` → email-service SQS → SES.

No CDK rule change is required: `UnsuccessfulAuth` is already subscribed in both `packages/dmarc-dashboard/cdk.ts` and `packages/service-email-dashboard/cdk.ts`, and `emails.grantAccess(authConsumer)` already wires the email SDK env vars.

### Types and Schemas

Turn `UnsuccessfulAuth.detail` into a **discriminated union on `code`** so consumers branch on a stable, required discriminator (never parse the free-text `reason`), and so each code carries exactly the fields it can meaningfully provide. `invalidToken` has no address to report (the token is invalid/expired/used-up); `emailNotRegistered` always carries the submitted address. Modelling this as a variant makes the types honest: no nullable `emailAddress`, no empty-string placeholder.

The two branches:

- `invalidToken` → `code` (required), `reason` (required)
- `emailNotRegistered` → `code` (required), `emailAddress` (required), `reason` (required)

Producer side — `packages/service-auth/src/events.ts`, replace the `UnsuccessfulAuth` interface with a discriminated-union detail:

```ts
interface UnsuccessfulAuth {
  readonly type: "UnsuccessfulAuth";
  readonly detail:
    | { readonly code: "invalidToken"; readonly reason: string }
    | {
        readonly code: "emailNotRegistered";
        readonly emailAddress: string;
        readonly reason: string;
      };
}
```

Consumer side — `packages/service-auth/events.ts`, replace `unsuccessfulAuthSchema` with a `v.variant` on `detail.code` (the outer object stays a plain `v.object`, so it remains a member of the top-level `authEventSchema = v.variant("detail-type", [...])`):

```ts
const unsuccessfulAuthSchema = v.object({
  "detail-type": v.literal("UnsuccessfulAuth"),
  source: v.string(),
  detail: v.variant("code", [
    v.object({
      code: v.literal("invalidToken"),
      reason: v.string(),
    }),
    v.object({
      code: v.literal("emailNotRegistered"),
      emailAddress: v.string(),
      reason: v.string(),
    }),
  ]),
});
```

> Follow the TypeScript steering: use `v.variant` for a union of _different_ object shapes (this is its intended use — not `v.union` of literals, and not `v.picklist` here since the branches differ in fields). No separate `as const` codes array is needed — the codes live as `v.literal` per branch.

### Public API Surface (consumer-facing, `@beesolve/auth-service/events`)

- `UnsuccessfulAuthEvent` / `UnsuccessfulAuthDetail` — now a **discriminated union** on `code`. `UnsuccessfulAuthDetail` narrows to `{ code: "emailNotRegistered"; emailAddress: string; reason: string }` when `code === "emailNotRegistered"`.
- Optionally export `UnsuccessfulAuthCode = UnsuccessfulAuthDetail["code"]` (derived from the schema, not a hand-maintained array) if a bare code union is useful to consumers.
- Existing `isUnsuccessfulAuth` guard unchanged in signature; after it narrows, consumers further narrow on `event.detail.code`.
- **Migration note (for consumers):** `detail.code` is now always present, and `detail.emailAddress` only exists on the `emailNotRegistered` branch. Consumers that previously read `detail.emailAddress` unconditionally must first narrow on `code === "emailNotRegistered"`. Captured in the changeset/commit migration guide (Task 5).

### signInComplete behaviour change — `packages/service-auth/src/handlers/signInComplete.ts`

In `upsertAccount`, the current unknown-email + `!allowSignUp` branch emits the event then throws `BadRequestError`. Change it to:

1. Emit `UnsuccessfulAuth` with `{ code: "emailNotRegistered", emailAddress: props.emailAddress, reason: "Email not registered." }` (`reason` kept for logs).
2. **Do not** throw. Instead signal upward that no account exists so the handler can return a non-leaking response.

The cleanest non-leaking response is to return the same shape a successful sign-in returns (303 redirect for form posts, or `{ redirectTo }` JSON for `Accept: application/json`) **without** setting a session cookie. That keeps status codes and body identical to the success path from an attacker's perspective while never creating a session.

Implementation approach: have `upsertAccount` return a sentinel (e.g. `null`) when the address is unknown and sign-up is disallowed, rather than throwing. In `signInComplete`, when `account == null`, build and return the success-shaped response with **no** `Set-Cookie` (reuse the existing response-builder branches, but skip `addSetCookies`). Extract the response construction into a small local helper `buildResponse({ session, redirectTo, wantsJson })` where `session` may be `undefined` (no cookie) to avoid duplicating the JSON/303 branches.

Also update the existing token-failure `UnsuccessfulAuth` emission (the `.catch` block) to `{ code: "invalidToken", reason: error.message }` — `code` is now required, so this site must set it and no longer carries `emailAddress`.

Result: unknown address + `!allowSignUp` → event emitted, notification email sent by consumer, client gets a normal-looking 303/200 with no session. Known address → unchanged. Unknown address + `allowSignUp` → unchanged (account created).

> Security note to preserve in code review: the anti-enumeration guarantee holds only if timing and response bytes are close enough between the two paths. Emitting an event + skipping session creation is fast; do not add artificial branches that change the response body or headers between the two cases.

### authConsumer change — both dashboards

`packages/dmarc-dashboard/src/authConsumer.ts` and `packages/service-email-dashboard/src/authConsumer.ts` are currently identical. Update the `isUnsuccessfulAuth(event)` branch:

```ts
if (isUnsuccessfulAuth(event)) {
  const { detail } = event;
  console.log(`[UnsuccessfulAuth] ${detail.code}: ${detail.reason}`);

  if (detail.code === "emailNotRegistered") {
    await email.sendEmail({
      recipients: [detail.emailAddress],
      subject: "Sign-in attempt to an unrecognised account",
      html: `
        <h2>Sign-in attempt</h2>
        <p>Someone tried to sign in using this email address, but it is not registered in our system.</p>
        <p>If this was you, please contact your administrator to request access.</p>
        <p>If this was not you, you can safely ignore this message.</p>
      `,
      text: [
        "Someone tried to sign in using this email address, but it is not registered in our system.",
        "If this was you, please contact your administrator to request access.",
        "If this was not you, you can safely ignore this message.",
      ].join("\n"),
    });
  }
}
```

Keep the two dashboard consumers identical (as they are today).

### Cross-Package Dependencies

None added. `authConsumer` already depends on `@beesolve/auth-service/events` and `@beesolve/email-service/sdk`.

### CDK Constructs

None changed. `UnsuccessfulAuth` is already in both `AuthEventsRule` `detailType` lists and `emails.grantAccess(authConsumer)` is already present.

### Key Design Decisions

- **Model `UnsuccessfulAuth.detail` as a discriminated union on required `code`, not string-matching `reason`.** `reason` is free text meant for logs/humans; matching on `"Email not registered."` in a consumer would break on any wording change. A `v.variant("code", ...)` also lets each code declare exactly its fields — `emailNotRegistered` guarantees a non-null `emailAddress`, `invalidToken` has none — so the consumer narrows on `code` and gets `emailAddress: string` with no null-check.
- **Return a success-shaped, session-less response instead of throwing 400.** This is the standard defence against account enumeration; the client cannot distinguish registered from unregistered addresses by status, body, or the presence/absence of a redirect. The only difference is no session cookie, which is not observable as a distinguishing signal at the auth-response boundary (an attacker without the code cannot complete a session anyway).
- **Notification email lives in the dashboards' `authConsumer`, not in `service-auth`.** `service-auth` is a pure producer; sending email is a consumer concern already established for `EmailCodeAuth`.
- **No null-check needed in the consumer.** Narrowing on `code === "emailNotRegistered"` gives the consumer `emailAddress: string` directly, so there is no nullable field to guard and no risk of sending to an empty address.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check`
3. `bun test`

**Rules for subagents:**

- Each task must be self-contained.
- No commits — leave changes uncommitted for review.
- Follow the workspace TypeScript steering: no explanatory comments, `== null`/`!= null` checks, `as const` unions (no enums), `v.picklist` for string-literal sets, `import type` for type-only imports, descriptive variable names in array callbacks.
- Do not skip commit signing; do not push.
- Keep the two dashboard `authConsumer.ts` files identical.
- If check gates fail on unrelated existing issues, note them but don't fix.

**Operational notes:**

- Build tool is bunup. Barrel/entrypoint exports matter — `@beesolve/auth-service/events` maps to `packages/service-auth/events.ts`.
- Package name for `service-auth` is `@beesolve/auth-service` — read `package.json` before writing a changeset.
- ADRs live in `packages/<name>/docs/`. This change is a behavioural/security change to `service-auth`'s public event contract and client response — it warrants an ADR in `packages/service-auth/docs/`.

## Tasks

### Task 1: Make `UnsuccessfulAuth` a discriminated union on `code`

- [ ] In `packages/service-auth/events.ts` replace `unsuccessfulAuthSchema` with a `v.variant("code", [...])` on `detail`, keeping the outer `v.object` (so it stays a member of the top-level `authEventSchema`):
  - branch `v.object({ code: v.literal("invalidToken"), reason: v.string() })`
  - branch `v.object({ code: v.literal("emailNotRegistered"), emailAddress: v.string(), reason: v.string() })`
- [ ] Optionally add `export type UnsuccessfulAuthCode = UnsuccessfulAuthDetail["code"];` (derived — do not hand-maintain an `as const` array).
- [ ] In `packages/service-auth/src/events.ts` replace the `UnsuccessfulAuth` interface `detail` with the discriminated union: `{ code: "invalidToken"; reason: string } | { code: "emailNotRegistered"; emailAddress: string; reason: string }` (all `readonly`).
- [ ] Confirm `UnsuccessfulAuthEvent` / `UnsuccessfulAuthDetail` now infer as a discriminated union and narrow `emailAddress` into the `emailNotRegistered` branch only.

**Files:** `packages/service-auth/events.ts`, `packages/service-auth/src/events.ts`

**Acceptance criteria:** `bun run type-check` passes for `service-auth`; `bun run check` clean; narrowing `UnsuccessfulAuthDetail` on `code === "emailNotRegistered"` yields `emailAddress: string` with no null.

---

### Task 2: Change `signInComplete` to notify-instead-of-leak

- [ ] In `packages/service-auth/src/handlers/signInComplete.ts`, in `upsertAccount`, change the `!props.allowSignUp` unknown-email branch to:
  - emit `UnsuccessfulAuth` with `{ code: "emailNotRegistered", emailAddress: props.emailAddress, reason: "Email not registered." }`
  - return a sentinel indicating no account (do not throw `BadRequestError`). Recommended: change `upsertAccount` return type to `Promise<Account | null>` and return `null` here.
- [ ] Update the existing token-failure `UnsuccessfulAuth` emission (the `.catch` block at the top) to `{ code: "invalidToken", reason: error.message }` — `code` is now required and this branch no longer carries `emailAddress`.
- [ ] In `signInComplete`, after `upsertAccount(...)`, when the returned account is `null`, return a response identical in shape to the success path but WITHOUT a session cookie:
  - if `Accept` includes `application/json`: `200` with `{ redirectTo: redirectTo ?? "/" }`, headers `Cache-Control: no-store`, `Content-Type: application/json`, and NO `Set-Cookie`.
  - otherwise: `303` with `Location: redirectTo ?? "/"`, `Cache-Control: no-store`, and NO `Set-Cookie`.
  - Extract a local helper to build the success/no-leak responses so the JSON/303 branches are not duplicated; the helper takes an optional session and only calls `addSetCookies` when a session is present.
- [ ] Only create the session (`sessions.createOne`) when the account is non-null.
- [ ] Ensure no behavioural change for known addresses or for the `allowSignUp` sign-up path.

**Files:** `packages/service-auth/src/handlers/signInComplete.ts`

**Acceptance criteria:** `bun run type-check` + `bun run check` clean. Behaviour: unknown email + `allowSignUp=false` → event emitted with `code: "emailNotRegistered"`, no session created, response shape matches success path (no `Set-Cookie`, no "Email not registered." text, not a 400); known email → session created as before.

---

### Task 3: Tests for `signInComplete`

- [ ] Create `packages/service-auth/tests/signInComplete.test.ts` using `bun:test`, following the mock/deps style of `packages/service-auth/tests/signInRequest.test.ts`.
- [ ] Build a `createDeps` helper mocking: `actionTokens.use` (returns `{ data: { emailAddress } }`), `sessions.createOne`, `accounts.getOne`/`accounts.createNew`, `events.putEvents`, plus `headers`, `requestBody` (valid `{ code, token }`), `allowSignUp`, `dataToken`.
- [ ] Test cases:
  - known email + `allowSignUp=false`: creates a session, response has `Set-Cookie`, status 303 (or 200 for JSON accept). No `UnsuccessfulAuth` emitted.
  - unknown email + `allowSignUp=false`: emits `UnsuccessfulAuth` with `detail.code === "emailNotRegistered"` and `detail.emailAddress` set; does NOT call `sessions.createOne`; response status equals the success status (303 default / 200 with `Accept: application/json`); response has NO `Set-Cookie`; body/message contains no "Email not registered." text.
  - unknown email + `allowSignUp=true`: calls `accounts.createNew`, creates session, emits `EmailAddressVerified`.
  - invalid token (`actionTokens.use` rejects with `TokenInvalidError`): emits `UnsuccessfulAuth` with `code: "invalidToken"` and rethrows.
- [ ] Assert on `events.putEvents` mock call args for the event `type`/`detail.code`.

**Files:** `packages/service-auth/tests/signInComplete.test.ts`

**Acceptance criteria:** `bun test` passes in `service-auth` including the new file; all four cases green.

---

### Task 4: Send notification email in both dashboards' `authConsumer`

- [ ] Update `packages/dmarc-dashboard/src/authConsumer.ts` `isUnsuccessfulAuth` branch to narrow on `detail.code`; when `detail.code === "emailNotRegistered"`, call `email.sendEmail(...)` with `recipients: [detail.emailAddress]` and the unrecognised-account notification (subject/html/text as in the plan's "authConsumer change" section). No `emailAddress != null` guard is needed — narrowing on `code` guarantees `emailAddress: string`. Keep a `console.log` of `detail.code` + `detail.reason`.
- [ ] Apply the identical change to `packages/service-email-dashboard/src/authConsumer.ts` so the two files remain identical.
- [ ] Do not change CDK — `UnsuccessfulAuth` is already subscribed and `emails.grantAccess(authConsumer)` is already present. (Verify both `cdk.ts` files still list `"UnsuccessfulAuth"` in `AuthEventsRule.detailType`; if for any reason one does not, add it.)

**Files:** `packages/dmarc-dashboard/src/authConsumer.ts`, `packages/service-email-dashboard/src/authConsumer.ts`

**Acceptance criteria:** `bun run type-check` + `bun run check` clean for both dashboards; both `authConsumer.ts` files are byte-identical; the email is sent only in the `code === "emailNotRegistered"` branch.

---

### Task 5: ADR + changeset + README

- [ ] Add `packages/service-auth/docs/adr-NNN-unregistered-sign-in-notification.md` (next free number) following the repo ADR format: Status Accepted; Context (enumeration leak + desire to notify address owner); Decision (make `UnsuccessfulAuth.detail` a discriminated union on required `code`, return success-shaped session-less response, notify via consumer); Rationale (anti-enumeration, stable discriminator vs free-text reason, variant makes per-code fields honest — `emailNotRegistered` guarantees a non-null `emailAddress`, producer/consumer separation); Consequences (unknown-address sign-in now returns success-shaped response, no 400; owner receives an email; `UnsuccessfulAuth` event contract changed — `code` now required, `emailAddress` only on the `emailNotRegistered` branch); Alternatives Considered (optional `code` + nullable `emailAddress`; single object with `v.picklist`; string-match `reason`; keep throwing 400; send email from `service-auth` directly).
- [ ] Add a changeset: read `packages/service-auth/package.json` name (`@beesolve/auth-service`) first. Per the user's direction this is a `minor` bump despite the event-contract change; include a short **migration guide** in the changeset/commit body: consumers of `@beesolve/auth-service/events` must now branch on `detail.code` (always present) and read `detail.emailAddress` only within the `emailNotRegistered` branch. Dashboards are private apps (confirm `private: true` in their `package.json`); only include them in the changeset if they are published.
- [ ] Update `packages/service-auth/README.md` where `UnsuccessfulAuth` and/or the sign-in flow are documented: describe the discriminated `code` field (`invalidToken` vs `emailNotRegistered`), that `emailAddress` is present only on `emailNotRegistered`, and the anti-enumeration response behaviour when `allowSignUp` is false.

**Files:** `packages/service-auth/docs/adr-NNN-unregistered-sign-in-notification.md`, `.changeset/<name>.md`, `packages/service-auth/README.md`

**Acceptance criteria:** ADR follows the required format; changeset targets `@beesolve/auth-service` with a `minor` bump and includes the migration note; README reflects the discriminated `code` field and behaviour; `bun run check` clean.

---

### Task 6: Full verification

- [ ] Run `bun run check`, `bun run type-check`, and `bun test` across the workspace.
- [ ] Confirm no leftover references to throwing `BadRequestError("Email not registered.")` in `signInComplete`.
- [ ] Confirm both dashboard `authConsumer.ts` files are identical.
- [ ] Summarise how to observe the behaviour in the dmarc/email dashboards: deploy, attempt sign-in with an unregistered address while `ALLOW_SIGN_UP=false`, and confirm (a) the client gets a normal-looking response with no session, and (b) the notification email arrives at the attempted address.

**Files:** none (verification only)

**Acceptance criteria:** all three gates green workspace-wide; manual observation steps documented.

---

## Future Work (out of scope)

- Localising the notification email via the `@beesolve/email-service/templating` templates instead of inline HTML (the existing `EmailCodeAuth` consumer also inlines HTML today).
- Extending the `UnsuccessfulAuthCode` union to cover other failure reasons and driving consumer behaviour off it more broadly.
