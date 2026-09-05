# Email Service Dashboard (@beesolve/email-service-dashboard)

## Status: Complete — all tasks (1–11) done

## Implementation Status & Deviations (updated this session)

> The design evolved substantially during implementation. The Architecture/Approach and Task sections below are the ORIGINAL plan and are partly superseded. This section is the source of truth for what was actually built and what remains.

### Progress

- **Task 1 — Scaffold: DONE & COMMITTED.** Package scaffold created and committed (`scaffold email-service-dashboard package skeleton`).
- **Task 2 — Messages model: DONE (uncommitted), redesigned & split.** `src/lib/server/messages.ts` implemented with a different data model than the plan (see Deviations). Split into: `schema.ts` (shared surface only), `messages.ts` (`Messages`: `upsert` + `messageManyByRecipient` + `messagesManyForMonth` + private `parseOne`/`toModel`), `stats.ts` (`GlobalStats.get`), `recipients.ts` (`Recipients.list` + `Recipients.getStats`). `EmailSentFailure` handling is a `// todo` stub in `eventConsumer.ts`. `tests/messages.test.ts` rewritten for the new model; `tests/stats.test.ts` + `tests/recipients.test.ts` added. `UpsertProps` is NOT exported — the test derives it via `Parameters<Messages["upsert"]>[0]`. `toModel`'s `logByRecipient` typed as `Record<string, Array<LogEntry>>`. All dashboard gates green (fmt/lint/type-check/14 tests).
- **Task 8 (partial) — `eventConsumer.ts`: DONE (uncommitted).** Plain `SQSEvent → SQSBatchResponse` handler (NOT `@beesolve/sqs-handler`, which is an RPC `{fn,args}` dispatcher — wrong shape for EventBridge→SQS). Parses each record with `parseEmailEvent`, maps every event variant to `messages.upsert(...)`, `EmailSentFailure` left as `// todo: implement`, returns `batchItemFailures`.
- **`@beesolve/email-service/events` change (uncommitted):** the seven `is*` guards now validate via `v.is(schema, event)` (real parsing, not `detail-type` casts); **`id: v.string()` (EventBridge event id) added to all seven event schemas** to serve as the idempotency key. `dist/events.*` rebuilt. This touches a published package → needs a changeset.

### Key deviations from the original plan

1. **Table layout replaced.** NOT `${timestamp}#${messageId}` pk + single reverse GSI. Instead:
   - Message record: `pk=messageId, sk="message"`.
   - Recipient-query record: `pk=email, sk="message#${createdAt}#${messageId}"` (list via `begins_with(sk,"message#")`, newest-first, then BatchGet by messageId).
   - Month-query record: `pk="YYYY-MM", sk="${createdAt}#${messageId}"` (list a month, newest-first, then BatchGet).
   - Recipient counter: `pk=email, sk="recipient"`. Global stats: `pk="stats", sk="global"`.
   - Reverse GSI used ONLY to list recipient-counter records (`sk="recipient"`).
   - Message located by `messageId` alone (SES events only carry `mail.messageId`).
2. **No status fold / `nextStatus` / `statusRank` / `queued`.** `messageStatuses = ["sent","delivered","bounced","complained","rejected"]` (+ `"requested"` as a log-entry-only status). `messageLog` is one flat String Set spanning all recipients; each member is `JSON.stringify(sortKeys({ recipient, ...eventData }))`. Current status derived on read in `toModel` = latest entry by event `timestamp`. `toModel` also builds `logByRecipient`.
3. **Event parsing lives in `eventConsumer.ts`, not the model.** `Messages` takes plain domain `UpsertProps` (`{ eventId, messageId, recipients, subject, sender, createdAt, data }`).
4. **Idempotency = EventBridge event `id`** in a dedicated `idempotencyKeys` String Set, gated on the whole `TransactWriteItems` via `not contains(#idempotencyKeys, :eventId)`. Detected via `error instanceof TransactionCanceledException` + `CancellationReasons[0].Code === "ConditionalCheckFailed"`.
5. **Relation + month + stats writes are IN the transaction** (durability — no post-transaction BatchWrite gap).
6. **48-recipient hard cap** enforced in `upsert` (transaction ≤ 100 items); throws on 0 recipients too.
7. **`sortKeys` helper** added for stable `JSON.stringify` of set members.
8. **`requestId` required** on the record (`"unknown"` placeholder when only SES events seen — our `EmailSentSuccess` was dropped).

### What's still missing / to do

- **Task 2 cleanup:** DONE — `tests/messages.test.ts` rewritten; `toModel`'s `logByRecipient` typed as `Record<string, Array<LogEntry>>`; `UpsertProps` kept private (test derives via `Parameters<Messages["upsert"]>[0]`). Remaining: the `// todo` on verifying inserted data via schemas in `upsert`.
- **Split Stats/Recipients into own files:** DONE — `stats.ts` (`GlobalStats.get`), `recipients.ts` (`Recipients.list` + `Recipients.getStats`), shared `schema.ts` (only `defaultLimit`, `emailSchema`, `countersSchema`, `recipientSchema`/`Recipient`, `statsSchema`/`Stats`, `encodeCursor`, `decodeCursor`). Writes/increments stay in `messages.ts`; no cross-references. `tests/stats.test.ts` + `tests/recipients.test.ts` added.
- **`EmailSentFailure`:** implement the `failed` global-stats `ADD` (currently `// todo` in `eventConsumer.ts`).
- **ADR for schema + transaction decisions (REQUIRED):** write an ADR capturing ALL schema/design decisions made this session — the table layout (message record / recipient-query / month-query / recipient-counter / global-stats), why `messageId` is the message `pk` (SES events only carry `mail.messageId`), the flat `messageLog` String Set + `sortKeys` stable stringify, status-by-latest-timestamp (no fold), the single `TransactWriteItems` with all writes (message + stats + relation + month records) applied atomically, idempotency via the dedicated `idempotencyKeys` set gated on the EventBridge event `id`, the 48-recipient cap, and `requestId` required (`"unknown"` placeholder). This is the `adr-002` (event-projection / transactions) work in Task 10 — make sure it covers the transaction rationale, not just the projection.
- **GSI projection (REQUIRED for Task 9):** the reverse GSI is used ONLY by `recipients.ts` to list recipient-counter records, so it must project ONLY the Recipient-related fields — NOT all message data. Projected attributes: `pk`, `sk`, `received`, `sent`, `delivered`, `bounced`, `complained`, `rejected`, `failed` (i.e. an `INCLUDE` projection of exactly the `Recipient` counters + keys). Do not use `ALL` — we don't want to duplicate message-record data into the index.
- **Task 3:** Users + Setup models (+ tests).
- **Task 4:** `hooks.server.ts` wiring + `app.d.ts` (services = `{ messages, globalStats, recipients, users, setup, authClient, email }` — `messages` = `Messages`, `globalStats` = `GlobalStats`, `recipients` = `Recipients`).
- **Task 5:** auth routes + first-admin setup + shared components.
- **Task 6:** dashboard views — overview (global stats), messages list (by month), message detail + `logByRecipient` timeline + on-demand body via `email.getMessage(requestId)`, recipients list, per-recipient history. Adjust to the new method names/model.
- **Task 7:** admin user management routes.
- **Task 8 (remainder):** `authConsumer.ts` (copy from dmarc-dashboard); `build.ts` (esmBuild `authConsumer` + `eventConsumer`); `tests/eventConsumer.test.ts`.
- **Task 9:** `cdk.ts` — table with the NEW key layout + the reverse GSI (recipient-counter listing only), site/auth wiring, `Emails`, auth consumer, event-ingest Lambda + rule. **Ensure the EventBridge→SQS target uses NO input transformer** so the top-level `id` survives to `record.body`.
- **Task 10:** ADRs (motivation + the redesigned event-projection ADR reflecting the new table layout, `idempotencyKeys`/EventBridge-`id` idempotency, 48-recipient cap, latest-timestamp status), README, changeset (dashboard + a changeset for the `@beesolve/email-service` events change), final green gates.
- **Changeset for `@beesolve/email-service`:** adding required `id` to the event schemas tightens the parse contract — needs its own changeset.

## Problem Statement

Clients using `@beesolve/email-service` currently have no way to see what their service is doing. The package sends transactional email through SES, writes a short-lived "sent log" to DynamoDB (keyed by requestId and by recipient), and emits EventBridge events for the full delivery lifecycle (`EmailSentSuccess`, `EmailSentFailure`, and SES `SES Message Sent` / `SES Delivery` / `SES Bounce` / `SES Complaint` / `SES Reject`). But there is no persisted delivery **status** and no UI. The motivation ADR of `service-email` explicitly names an email dashboard as intended future work.

This plan creates a new standalone package `email-service-dashboard`, a prebuilt kit-on-lambda SvelteKit app, built to the exact same template as `packages/dmarc-dashboard`. It exports a single CDK construct (`./cdk`) that provisions the SvelteKit SSR Lambda behind CloudFront, wires `@beesolve/auth-service` email-code auth, provisions its own `@beesolve/email-service` `Emails` construct (for sign-in OTP mail), and runs an **event-ingest Lambda** that consumes the email lifecycle events off EventBridge and projects them into the dashboard's own DynamoDB table so the UI has durable, queryable message + status + aggregate-stats data.

The reason a dedicated projection table is required (rather than reading `service-email`'s `EmailLog` table directly): `EmailLog` has no delivery status field, no GSI, and a short TTL (default 14 days). Delivery outcomes live **only** in EventBridge events. So the dashboard persists those events itself. The join key across everything is the SES `messageId` (linked to the SDK `requestId` via `EmailSentSuccess`).

## Architecture / Approach

### High-level shape

```
sendEmail (client's own app / SDK)
        │
        ▼
  email-service SQS handler ──► SES ──► ConfigurationSet EventBridge destination
        │                                        │
        └──► EmailSentSuccess/Failure ───────────┤ (source: beesolve.email.api / aws.ses)
                                                 ▼
                                        EventBridge default bus
                                                 │  Rule (source in
                                                 │   ["beesolve.email.api","aws.ses"])
                                                 ▼
                              dashboard event-ingest Lambda (SQS-buffered)
                                                 │  parseEmailEvent()  →  Messages.upsertFromEvent()
                                                 │  atomic ADD counters + SS messageLog append
                                                 ▼
                              Dashboard DynamoDB table (message + recipient + stats)
                                                 ▲
                                                 │  read (Query / BatchGet — never Scan/Filter)
                          SvelteKit SSR Lambda (dashboard UI) ◄── AuthGateway authorizer
                                                 │
                                                 └─ "request message body" → email.getMessage(requestId)
                                                        → request.html / request.text (from EmailLog, on demand)
```

### DynamoDB single-table design

Composite key `pk` + `sk`, plus ONE **reversed GSI** (`sk`→partition, `pk`→sort, key-only projection). Env var: `DASHBOARD_REVERSE_INDEX`.

Because the recipient-relation record's `sk = ${timestamp}#${messageId}` is identical to the message record's `pk`, this single reverse index serves BOTH access paths:

- "list all messages by time" — query GSI `sk = "message"`, sorted by `pk` (= `${timestamp}#${messageId}`), newest-first.
- "list a recipient's message keys" — query GSI `sk = ${emailAddress}`, sorted by `pk`.
- "list all recipients" — query GSI `sk = "stats"` (every recipient has one `pk:${email}, sk:"stats"` record).

Item families (all in one table, no `Scan`, no `FilterExpression` anywhere):

| Purpose                | pk                                         | sk                          | notes                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Message record**     | `${timestamp}#${messageId}`                | `"message"`                 | full projection: status (variant), recipients[], sender, subject, messageLog(SS), delivery detail. `messageId` and `timestamp` are parsed from `pk` — NOT stored separately.                                          |
| **Recipient relation** | `${emailAddress}` (normalized, lowercased) | `${timestamp}#${messageId}` | one per recipient per message. `sk` equals the message record's `pk`, so recipient listing → query reverse index by `sk=${emailAddress}` → BatchGet the message records using each returned `pk` as the message `pk`. |
| **Global stats**       | `"stats"`                                  | `"global"`                  | atomic `ADD` counters, one per event/status.                                                                                                                                                                          |
| **Recipient stats**    | `${emailAddress}`                          | `"stats"`                   | atomic `ADD` counters scoped to that recipient. Lives in the SAME partition as that recipient's relation records (pk = emailAddress), so recipient stats + recipient messages are colocated.                          |

**Why timestamp in `pk` (not `sk`):** unique primary key per message avoids a hot partition, and encoding timestamp gives time-ordered listing for free via the reverse index. Because the full `pk`+`sk` is always derivable, single-item `GetItem` and BatchGet always work.

**Recipient listing flow (query + batchGet, no Filter):**

1. Query reverse index: `sk = ${emailAddress}` (excluding the `"stats"` sk via `KeyConditionExpression` sort-key bound, or just skip the single stats row client-side after fetch — but prefer a begins-with / range that only matches `${timestamp}#...`), `Limit: 100`, `ScanIndexForward: false`, with `ExclusiveStartKey` cursor.
2. From the returned keys, take each item's `pk` (= `${timestamp}#${messageId}`) as the message record `pk` and `BatchGet` those message records (`pk = <that>`, `sk = "message"`).
3. Next page: repeat query with the cursor, then BatchGet. So 1 Query + 1 BatchGet per page.

### Types and Schemas

Status as a **variant** (not optional fields). Each terminal state carries its own detail. Plus a `messageLog` String Set capturing every observed status with timestamp (the `changeLog` pattern from `bewatr-reporting/packages/api/src/payment.ts` — `v.set(v.pipe(v.string(), v.parseJson(), entrySchema))`, written with `ADD messageLog :entrySet`, parsed back on read).

```ts
// packages/email-service-dashboard/src/lib/server/messages.ts

export const messageStatuses = [
  "queued", // EmailSentSuccess seen, no SES lifecycle event yet
  "sent", // SES Message Sent
  "delivered", // SES Delivery
  "bounced", // SES Bounce
  "complained", // SES Complaint
  "rejected", // SES Reject
] as const;
export type MessageStatus = (typeof messageStatuses)[number];
// note: "failed" (EmailSentFailure) is NOT a message status — failures are stats-only, no record.

// One messageLog member: minimal {status, timestamp} to avoid set-member collisions.
// Extra metadata (e.g. bounceType) MAY be included; keep timestamp to guarantee uniqueness.
const logEntrySchema = v.object({
  status: v.picklist(messageStatuses),
  timestamp: v.string(), // event timestamp (ISO) — dedupes set members
});

// Variant status detail. `pk`/`sk` carry timestamp+messageId; do not store them redundantly.
const statusVariant = v.variant("status", [
  v.object({ status: v.literal("queued") }),
  v.object({ status: v.literal("sent") }),
  v.object({
    status: v.literal("delivered"),
    deliveredAt: v.string(),
    deliveryMs: v.number(), // SES Delivery processingTimeMillis
  }),
  v.object({
    status: v.literal("bounced"),
    bounceType: v.picklist(["Permanent", "Transient", "Undetermined"]),
    bounceSubType: v.string(),
    bouncedRecipients: v.array(v.string()),
    diagnosticCode: v.optional(v.string()),
    at: v.string(),
  }),
  v.object({
    status: v.literal("complained"),
    complainedRecipients: v.array(v.string()),
    feedbackType: v.optional(v.string()),
    at: v.string(),
  }),
  v.object({
    status: v.literal("rejected"),
    reason: v.string(),
    at: v.string(),
  }),
]);

// Message record. messageId + timestamp are DERIVED from pk (parsed in `parseOne`), not stored.
export const messageSchema = v.pipe(
  v.object({
    pk: v.string(), // `${timestamp}#${messageId}` — transformed below
    sk: v.literal("message"),
    requestId: v.optional(v.string()),
    recipients: v.array(v.string()),
    sender: v.optional(v.string()),
    subject: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
    messageLog: v.set(v.pipe(v.string(), v.parseJson(), logEntrySchema)),
    // ...spread of statusVariant entries (status + its detail)
  }),
  // transform pk → { timestamp, messageId } while keeping the rest
);
export type Message = v.InferOutput<typeof messageSchema>;

// Recipient relation record (key-only content beyond keys).
export const recipientRelationSchema = v.object({
  pk: v.string(), // emailAddress (normalized, lowercased)
  sk: v.string(), // `${timestamp}#${messageId}` == message record pk
});

// Stats records (counters via atomic ADD; total derived on the fly by summing).
export const statsSchema = v.object({
  pk: v.string(), // "stats" (global) | emailAddress (per-recipient)
  sk: v.string(), // "global" | "stats"
  received: v.optional(v.number()), // EmailSentSuccess / SES Message Sent count
  sent: v.optional(v.number()),
  delivered: v.optional(v.number()),
  bounced: v.optional(v.number()),
  complained: v.optional(v.number()),
  rejected: v.optional(v.number()),
  failed: v.optional(v.number()), // EmailSentFailure count (stats-only)
});
export type Stats = v.InferOutput<typeof statsSchema>;
```

Counters are **incremented per event, never decremented** (`ADD` is atomic and avoids read-modify-write / hot-partition write conflicts). "Total messages processed" is derived on the fly by summing the relevant counters; if an exact non-double-counted total is needed later it can be computed by subtraction on the fly — not required now.

`Users` and `Setup` models are copied from dmarc-dashboard, with `domains` dropped from `Users` (no domain concept here).

### Status derivation (fold in the ingest handler)

For each parsed event, keyed by `messageId` (join key). The message record `pk` is `${eventTimestamp}#${messageId}` where the timestamp is the earliest known event time; because ingest may see events out of order, use the message's `mail.timestamp` when available so the `pk` is stable across the lifecycle. (Design detail to lock in Task 2: derive a single stable `timestamp` for the `pk` — prefer `mail.timestamp` from any SES event, falling back to first-seen event time; document the chosen rule.)

Per event:

- `EmailSentSuccess` → set `requestId`; status ≥ `queued`; `ADD` global+recipient `received`. Append `messageLog` `{status:"queued", timestamp}`.
- `SES Message Sent` → capture `sender`/`subject`/`recipients` from `mail.commonHeaders`/`mail.destination`; status → `sent` if not terminal; `ADD sent`; write recipient relation records (one per recipient) + recipient stats partitions; append log.
- `SES Delivery` → status `delivered` (+ `deliveredAt`, `deliveryMs`); `ADD delivered`; append log.
- `SES Bounce` → status `bounced` (+ variant detail); `ADD bounced`; append log.
- `SES Complaint` → status `complained` (+ variant detail); `ADD complained`; append log. (Complaint can arrive after delivery; complaint wins.)
- `SES Reject` → status `rejected` (+ reason); `ADD rejected`; append log.
- `EmailSentFailure` → **stats only**: `ADD failed` on global stats (no messageId available; no per-message record, no recipient stats). Append nothing.

Terminal precedence for the record's `status` field (no downgrades): `complained` > `bounced` / `rejected` > `delivered` > `sent` > `queued`. Pure helper `nextStatus(current, incoming)` — unit-tested.

Idempotency: events can be redelivered. The per-event idempotency key is the `messageLog` String Set member `JSON.stringify({ status, timestamp })`. The message-record update carries `ConditionExpression: "not contains(messageLog, :entry)"`; when it succeeds the event is new, and the stats counters must move exactly once. Two implementations, **default is the transactional one (Option B)** for crash-safety:

**Option A — conditional update, then follow-up stats `ADD` (two calls, gated):**

```
entry = JSON.stringify({ status, timestamp })
try {
  Update(message record):
    SET status = nextStatus(...), updatedAt, createdAt = if_not_exists(createdAt, now), <variant detail>
    ADD messageLog :entrySet
    ConditionExpression: not contains(messageLog, :entry)
} catch (ConditionalCheckFailedException) {
  return              // already applied → skip stats
}
Update(pk:"stats",  sk:"global") : ADD <status> :one
Update(pk:email,    sk:"stats")  : ADD <status> :one   // one per recipient
```

Exact under normal redelivery; but a crash between the record update and the stats `ADD` permanently under-counts that one event (the guard then blocks the retry). Cheapest.

**Option B — single `TransactWriteItems` (atomic, crash-safe) — DEFAULT:**

```
entry = JSON.stringify({ status, timestamp })
TransactWrite([
  Update(message record):
    SET status = nextStatus(...), updatedAt, createdAt = if_not_exists(createdAt, now), <variant detail>
    ADD messageLog :entrySet
    ConditionExpression: not contains(messageLog, :entry),   // the idempotency gate
  Update(pk:"stats", sk:"global") : ADD <status> :one,
  Update(pk:email,   sk:"stats")  : ADD <status> :one,       // one per recipient of this event
])
// condition fails → whole transaction rejected (TransactionCanceledException,
// CancellationReasons[0]=ConditionalCheckFailed) → treat as already-applied, return.
// Either all writes happen or none: counters can never drift.
```

Trade-offs: ~2x WCU, 100-item / 4MB transaction cap. Our transaction is `message record + global + N recipient-stats` items for one event; N is small for transactional email, well under the cap. If a single message ever exceeds ~30 recipients, split the recipient writes across transactions (document; edge case). The recipient-relation records may be written in the same transaction or a preceding idempotent `BatchWrite` (they're keyed deterministically, so re-writing them is harmless).

`EmailSentFailure` has no `messageId` and no message record, so it has no `messageLog` anchor — its `failed` counter is a plain `ADD` on global stats and stays approximate (key a small seen-set by `requestId` if exactness is needed later; not required now).

### Message body inspection (on demand, nothing stored)

The dashboard does NOT persist message bodies and adds no new SDK method. It reuses the existing `email.getMessage(requestId)` from `@beesolve/email-service/sdk`, which returns `{ requestId, messageId, request, expiresAt }` where `request.html` and `request.text` are the sent body. Our message record stores `requestId` (captured from `EmailSentSuccess`), so the message detail page's "request message body" action calls `locals.services.email.getMessage(requestId)` on demand and renders `request.html` / `request.text`. Nothing is stored in the dashboard; no S3 bucket is provisioned.

Caveats (surface gracefully in the UI):

- Works only while the source `EmailLog` record still exists — that record has its own TTL (`messagesRetentionDays`, default 14 days), and if `service-email` was configured with `messagesRetentionDays: 0` the body is never persisted. `getMessage` throws `EmailServiceError("message_not_found")` in those cases → show "message body no longer available".
- Requires `requestId` on our record, i.e. we observed `EmailSentSuccess`. If only SES events were seen (no `EmailSentSuccess`), there is no `requestId` and the body cannot be fetched → hide/disable the action.

### Public API Surface

Only the CDK construct is exported (SvelteKit app ships as the prebuilt `dist/build` bundle):

```ts
// packages/email-service-dashboard/cdk.ts  → "@beesolve/email-service-dashboard/cdk"
export interface EmailServiceDashboardProps {
  readonly auth: AuthGateway; // @beesolve/auth-service/cdk
  readonly emailSender: { readonly name: string; readonly emailAddress: string };
  /** Event bus the email-service emits to. @default "default" */
  readonly eventBusName?: string;
  readonly isProd?: boolean;
  readonly removalPolicy?: RemovalPolicy;
}
export class EmailServiceDashboard extends Construct {
  readonly distribution: Distribution;
}
```

No `consumer` prop (dmarc-dashboard needed one for DMARC data; here the dashboard owns its table).

### Cross-Package Dependencies

Same set as dmarc-dashboard minus the DMARC packages:

- `workspace:^`: `@beesolve/auth-service`, `@beesolve/cdk-constructs`, `@beesolve/email-service`, `@beesolve/lambda-fetch-api`
- `catalog:`: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `valibot`
- external: `@drop-in/graffiti`, `kit-on-lambda ^0.8.1`
- dev: `@sveltejs/kit`, `@sveltejs/vite-plugin-svelte`, `svelte 5`, `svelte-check`, `vite 8`, `aws-cdk-lib` (catalog), `constructs` (catalog), `typescript ~6.0.3`, `@types/aws-lambda` (catalog), `@types/bun`, `@types/node`
- peer (optional): `aws-cdk-lib`, `constructs`

`@beesolve/email-service` is used for `/cdk` (`Emails` — OTP mail), `/events` (parser in the ingest Lambda), `/sdk` (`Email` — OTP send + `getMessage` for on-demand body inspection).

### CDK Constructs

`EmailServiceDashboard` (`cdk.ts`) provisions:

1. **Dashboard DynamoDB `TableV2`** — composite `pk`+`sk`, on-demand billing, AWS-managed encryption, optional `ttl`, PITR when `isProd`, `removalPolicy` from props, and ONE reverse GSI (`sk`→partition, `pk`→sort, key-only projection). Inject `DASHBOARD_TABLE_NAME` + `DASHBOARD_REVERSE_INDEX`.
2. **`SvelteKit` `Site`** (`kit-on-lambda/cdk`, `runtime:"node"`, `InvokeMode.BUFFERED`, `buildDirectory=<dir>build`). In `toDefaultOrigin({ handler })`: `auth.addAuthorizedEndpoint({ lambda: handler, path: "/{proxy+}" })`, `auth.grantSdkAccess(handler)`, grant handler table read/write + inject table env vars, return `HttpOrigin(Fn.parseDomainName(auth.api.url))`.
3. **CloudFront wiring** — `ensureCookieFunction` override + `/auth/*` behavior (copy verbatim from dmarc-dashboard).
4. **`Emails`** (`@beesolve/email-service/cdk`) for OTP mail: `new Emails(this,"Emails",{ defaultSender: props.emailSender, eventBusName })`; `emails.grantAccess(site.handler)` (this also injects `BEESOLVE_EMAILS_*` env, enabling `email.getMessage` for body inspection).
5. **Auth-events consumer Lambda** + `Rule` on `source:["beesolve.auth.api"]`, `detailType:["EmailCodeAuth","UnsuccessfulAuth"]` — copied verbatim; `emails.grantAccess(authConsumer)`.
6. **Email-events ingest Lambda** — `Nodejs24Function` (`entry:<dir>eventConsumer/`) fronted by `SqsWithDlq.asLambdaInput`; grant table read/write + inject table env vars; `Rule` on `source:["beesolve.email.api","aws.ses"]` with an SQS target feeding the queue (EventBridge → SQS → Lambda, per `service-email/docs/eventbridge-events.md`).

`build.ts` produces both prebuilt bundles via `esmBuild`: `dist/authConsumer` and `dist/eventConsumer`.

### hooks.server.ts

Same template as dmarc-dashboard. **The `build` script keeps the placeholder env vars** — env is parsed eagerly at module load (`const env = v.parse(envSchema, process.env)`), and `vite build` imports `hooks.server.ts` during SSR analysis, so required `v.string()` vars must be present or the build throws. (Confirmed against dmarc-dashboard; no change to that behavior.)

- env schema: `DASHBOARD_TABLE_NAME`, `DASHBOARD_REVERSE_INDEX` (both `v.string()`).
- one `DynamoDBDocumentClient` with marshall options.
- instantiate `Messages`, `Users`, `Setup`, `AuthClient`, `Email` once; attach to `event.locals.services`.
- `createSessionHandle` + `authGuard`; `publicPaths = {"/sign-in","/sign-in/verify","/setup"}`; dev `fallbackSession` from `DEV_USER_EMAIL`.
- `app.d.ts` types `App.Locals`.

### Routes / What the dashboard displays

- `/` — **Overview**: global stats via the `"stats"/"global"` record — totals for received/sent/delivered/bounced/complained/rejected/failed, delivery rate, bounce rate & complaint rate (highlight SES's 5% / 0.1% thresholds), total messages processed (summed on the fly), avg delivery latency; plus a recent-messages list (reverse index `sk="message"`, newest-first).
- `/messages` — **Sent messages list**: paginated newest-first via reverse index `sk="message"` (cursor via `ExclusiveStartKey`), columns time/recipients/subject/status badge. Recipient search box → `/recipients/[email]`. No Filter — status shown from the record; if a status filter is offered, it is done client-side on the page, not via DynamoDB FilterExpression.
- `/messages/[messageId]` — **Message detail / timeline**: `Get` the message record (`pk=${timestamp}#${messageId}` — the full `pk` comes from the list row / route param). Render the `messageLog` timeline, variant status detail (bounce diagnostics, complaint feedback, reject reason, delivery latency), and a **"Request message body"** action that calls `email.getMessage(requestId)` and renders `request.html`/`request.text`. Disable the action when `requestId` is absent; show "no longer available" when `getMessage` throws `message_not_found`.l(messageId)` → open presigned URL.
- `/recipients` — **Recipients list**: query the reverse index with `sk="stats"`. Every recipient has exactly one `pk:${email}, sk:"stats"` record, so this lists all recipient email addresses (sorted by `pk`). No directory item and no Scan needed. (The global stats record is `pk:"stats", sk:"global"` — different `sk`, so it never collides with this query.)
- `/recipients/[email]` — **Per-recipient history + stats**: recipient stats (`pk=${email}, sk="stats"`) + the query+BatchGet message listing described above (query reverse index `sk=${email}` for `${timestamp}#${messageId}` keys, then BatchGet message records). Newest-first, paginated 100.
- `/users`, `/users/invite`, `/users/[email]/edit` — admin user management (copied, `domains` removed).
- `/setup` — first-admin-on-fresh-deploy (copied verbatim, `users.create` without `domains`).
- `/sign-in`, `/sign-in/verify` — copied verbatim.

### Key Design Decisions

- **Own projection table with atomic-`ADD` stats + variant status + `messageLog` set.** Status/aggregates live only in events; the dashboard is the projection. Documented in `adr-001-motivation.md` + `adr-002-event-projection.md`.
- **Timestamp encoded in `pk` (`${timestamp}#${messageId}`), unique per message** — no hot partition, free time-ordering, full key always derivable for Get/BatchGet.
- **Single reverse GSI (`sk`/`pk`, key-only)** serves both message-by-time listing and recipient-key listing, because the recipient relation `sk` equals the message `pk`.
- **Recipient stats + recipient relation records colocated** in the `pk=${emailAddress}` partition.
- **Stats counters increment-only per event** (atomic `ADD`, no decrements), made **exact under redelivery** via a single `TransactWriteItems` that writes the message record (gated by `not contains(messageLog, :entry)`) together with the global + recipient counter `ADD`s — all-or-nothing; totals derived on the fly. (`EmailSentFailure`'s `failed` counter is the one approximate counter — no per-message anchor.)
- **`messageId` and `timestamp` are parsed from `pk`, not stored**; no `message#` prefix.
- **Failures are stats-only** — `EmailSentFailure` increments a `failed` counter; no per-message record.
- **Message body on demand via `email.getMessage(requestId)`** — renders `request.html`/`request.text` from `EmailLog`; nothing stored in Dynamo, no new SDK method, no body bucket.
- **No Scan, no FilterExpression** — every access path is a `Query`/`Get`/`BatchGet` on the key schema.
- **No open/click metrics** (not tracked by `service-email` / no schema in `events.ts`) — deliberate out-of-scope gap, noted in ADR + README.
- **Reused dmarc-dashboard gotchas verbatim:** `ssr.external:["@beesolve/lambda-fetch-api"]`; `paths.relative=false`; placeholder env in the `build` script (`DASHBOARD_TABLE_NAME=build-placeholder DASHBOARD_REVERSE_INDEX=build-placeholder vite build`); `prepublishOnly` runs `bun build.ts` first; lightningcss target pinning.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task. After each task the user reviews the changes and signals "continue".

**Workflow rules (from workspace steering):**

- Start with `git pull --rebase origin main` before the first change.
- Never `git push` without explicit user approval.
- No commits — leave changes uncommitted for review after each task.

**Check gates (run after every task):**

1. `bun run fmt:check` (oxfmt) — or `bun run fmt` to auto-fix
2. `bun run lint` (oxlint)
3. `bun run type-check`
4. `bun test`

The dashboard's own `type-check` runs `svelte-kit sync` first, and `bun run build` inside the package must succeed with the placeholder env vars.

**Rules for subagents:**

- Each task is self-contained; follow the referenced dmarc-dashboard files as the template and copy their structure/style exactly.
- Follow `.kiro/steering` TypeScript conventions (2-space, double quotes, `import type`, `== null`, `v.picklist` for string unions, `v.variant` for mixed-shape unions, DynamoDB marshall options, `attribute_not_exists(pk) AND attribute_not_exists(sk)` on composite-key create guards, atomic `ADD` for counters).
- This package exposes ONLY `./cdk` — no `index.ts` barrel.
- `workspace:^` for intra-monorepo deps, `catalog:` for shared external deps.
- Run `bun install` after editing `package.json`, then `bun run recalculate-dependencies` after changing intra-monorepo deps.
- npm name is `@beesolve/email-service-dashboard` (differs from dir) — read `package.json` `name` before changesets.
- If check gates fail on pre-existing unrelated issues, note them but do not fix.

**Operational notes:**

- Prebuilt Lambda bundles use `esmBuild` from `@beesolve/cdk-constructs` (see dmarc-dashboard `build.ts`).
- Every package needs `docs/adr-001-motivation.md` (mandatory).
- Reference for the `messageLog`/`changeLog` set pattern: `../bewatr-reporting/packages/api/src/payment.ts` (`v.set(v.pipe(v.string(), v.parseJson(), changeSchema))`, written via `ADD`, parsed back on read).

## Tasks

### Task 1: Scaffold the package (SvelteKit + kit-on-lambda skeleton) — [x] DONE

Create `packages/email-service-dashboard/` as a copy of the dmarc-dashboard skeleton, wired for this package's names, no domain logic yet.

- [ ] `package.json` — name `@beesolve/email-service-dashboard`, version `0.0.0`, `type:module`, `files:["dist"]`, `exports` with only `./cdk` and `./package.json`. Scripts identical to dmarc-dashboard except `build` uses `DASHBOARD_TABLE_NAME=build-placeholder DASHBOARD_REVERSE_INDEX=build-placeholder vite build`. Deps per "Cross-Package Dependencies" (drop all `@beesolve/dmarc-*`).
- [ ] `svelte.config.js` — copy verbatim (`kit-on-lambda` adapter `out:"dist/build"`, `paths.relative=false`).
- [ ] `vite.config.ts` — copy verbatim incl. `ssr.external:["@beesolve/lambda-fetch-api"]` and lightningcss target pinning.
- [ ] `tsconfig.json`, `tsconfig.cdk.json`, `.env.local.example`, `src/app.html`, `src/ambient.d.ts` — copy, adjusting env var names.
- [ ] `src/app.d.ts` — minimal `App.Locals` (expanded in Task 4).
- [ ] Minimal `src/hooks.server.ts` + placeholder `src/routes/+page.svelte` so `bun run build` succeeds.
- [ ] `bun install`; `bun run recalculate-dependencies`.

**Files:** `packages/email-service-dashboard/{package.json,svelte.config.js,vite.config.ts,tsconfig.json,tsconfig.cdk.json,.env.local.example}`, `src/{app.html,app.d.ts,ambient.d.ts,hooks.server.ts}`, `src/routes/+page.svelte`

**Acceptance criteria:** `bun install` resolves; `cd packages/email-service-dashboard && bun run build` succeeds; root `bun run type-check` passes for the new package.

---

### Task 2: Messages model — records, stats, messageLog, status fold (with tests) — [~] PARTIAL (redesigned; tests stale — see Implementation Status)

Create the projection model, atomic stats, the `messageLog` set pattern, and the pure status helper.

- [ ] `src/lib/server/messages.ts` — `Messages` class (constructor `{ dynamo, tableName, reverseIndexName }`), plus `messageStatuses`/`MessageStatus`, `logEntrySchema`, the `statusVariant`, `messageSchema` (with `pk` → `{timestamp, messageId}` transform on read), `recipientRelationSchema`, `statsSchema`.
- [ ] Implement (all Query/Get/BatchGet/Update — never Scan/Filter):
  - `upsertFromEvent(event: EmailEvent): Promise<void>` — folds one event: `UpdateCommand` on the message record (`if_not_exists(createdAt)`, monotonic `status` via `nextStatus`, `SET` variant detail, `ADD messageLog :entrySet`), writes recipient relation records + a recipient-directory item on first sighting, and issues atomic `ADD` on global + recipient stats. `EmailSentFailure` → only `ADD failed` on global stats. Determine and document the stable `pk` timestamp rule (prefer `mail.timestamp`, fallback first-seen).
  - `getByKey({ pk }): Promise<Message | null>` — `Get` `pk` + `sk:"message"`.
  - `listRecent({ limit, cursor }): Promise<{ messages: Message[]; cursor?: string }>` — Query reverse index `sk="message"`, `ScanIndexForward:false`.
  - `listByRecipient({ email, limit, cursor })` — Query reverse index `sk=${email}` for `${timestamp}#${messageId}` keys (range-bound to exclude the `"stats"`/directory rows), then `BatchGet` those message records. Return messages + cursor.
  - `listRecipients({ limit, cursor })` — Query reverse index `sk="stats"` (lists all recipient partitions by `pk`=email); newest/alphabetical by `pk`.
  - `getGlobalStats(): Promise<Stats>` and `getRecipientStats({ email }): Promise<Stats>` — `Get`; return zero-filled counters when absent.
- [ ] Export pure `nextStatus(current: MessageStatus | null, incoming: MessageStatus): MessageStatus` — precedence `complained` > `bounced`/`rejected` > `delivered` > `sent` > `queued`.
- [ ] Idempotency/exact counters: apply each event via a single `TransactWriteItems` containing (1) the message-record `UpdateCommand` gated by `ConditionExpression: "not contains(messageLog, :entry)"` (the `{status,timestamp}` member is the per-event key, added via `ADD messageLog :entrySet`), (2) the global stats `ADD`, and (3) the per-recipient stats `ADD`(s). On `TransactionCanceledException` whose first cancellation reason is `ConditionalCheckFailed`, treat as already-applied and return (no drift). Document the ~2x WCU / 100-item cap and that messages with very many recipients must split recipient writes. `EmailSentFailure` is a plain `ADD failed` on global stats (no record anchor, stays approximate). (Option A — conditional update then separate stats `ADD`s — is documented in the plan as the cheaper, non-crash-safe alternative; default to the transaction.)
- [ ] Tests: `tests/messages.test.ts` — `nextStatus` full precedence table (incl. no-downgrade); event-fold test with out-of-order + duplicate events asserting converged record, that duplicate deliveries add no duplicate `messageLog` member (same `{status,timestamp}`) AND issue no stats `ADD` (guarded by `not contains`), that a genuinely new event issues the `TransactWriteItems` with correct `ADD` increments on global + recipient stats, that `listRecipients` queries the reverse index by `sk="stats"`, and that `EmailSentFailure` writes only the global `failed` counter. Use a fake `dynamo` (`Pick<DynamoDBDocumentClient,"send">`) capturing commands (and simulating `TransactionCanceledException` with `CancellationReasons[0].Code = "ConditionalCheckFailed"` for the duplicate case), matching dmarc-dashboard model-test style and the `bewatr-reporting` changeLog approach.

**Files:** `packages/email-service-dashboard/src/lib/server/messages.ts`, `tests/messages.test.ts`

**Acceptance criteria:** `bun test` passes `tests/messages.test.ts`; no Scan/Filter used; `messageLog` set dedupes duplicates; stats use atomic `ADD`; `EmailSentFailure` is stats-only.

---

### Task 3: Users + Setup models (with tests) — [x] DONE

- [ ] `src/lib/server/users.ts` — copy `Users` from dmarc-dashboard; DROP `domains` field + `updateDomains`; keep `getByEmail`, `create`, `hasAnyUsers`, `listAll`, `updateType`, `delete`, and the error classes. `userTypes=["admin","user"] as const`.
- [ ] `src/lib/server/setup.ts` — copy verbatim (`isComplete`, `markComplete` with composite-key guard).
- [ ] Tests: `tests/users.test.ts`, `tests/setup.test.ts` — mirror dmarc-dashboard model tests (create/duplicate-throws, `hasAnyUsers` via reverse index, setup set-once). Fake `dynamo`.

**Files:** `packages/email-service-dashboard/src/lib/server/{users.ts,setup.ts}`, `tests/{users.test.ts,setup.test.ts}`

**Acceptance criteria:** `bun test` passes; composite-key guards present; no `domains` references remain.

---

### Task 4: hooks.server.ts wiring + app.d.ts + auth guard — [x] DONE

- [ ] `src/hooks.server.ts` — env schema (`DASHBOARD_TABLE_NAME`, `DASHBOARD_REVERSE_INDEX`); single `DynamoDBDocumentClient` with marshall options; instantiate `Messages`, `Users`, `Setup`, `AuthClient` (`/sdk`), `Email` (`/sdk`) once; `createSessionHandle` + `authGuard`; `publicPaths={"/sign-in","/sign-in/verify","/setup"}`; dev `fallbackSession` from `DEV_USER_EMAIL`; attach all to `event.locals.services`. Keep eager `v.parse` at module load (placeholder build env stays).
- [ ] `src/app.d.ts` — finalize `App.Locals`: `services` = `{ messages, users, setup, authClient, email }`, `user: { email; type:"admin"|"user" } | null`.

**Files:** `packages/email-service-dashboard/src/{hooks.server.ts,app.d.ts}`

**Acceptance criteria:** `bun run type-check` passes; `bun run build` still succeeds with placeholder env; auth guard redirects unauthenticated non-public requests to `/sign-in`.

---

### Task 5: Auth routes + first-admin setup (copied from dmarc-dashboard) — [x] DONE

- [ ] `src/routes/setup/{+page.server.ts,+page.svelte}` — copy verbatim; `users.create` without `domains`.
- [ ] `src/routes/sign-in/{+layout.server.ts,+page.svelte}`, `sign-in/verify/{+page.ts,+page.svelte}` — copy verbatim.
- [ ] `src/routes/+layout.server.ts` (`return { user: locals.user }`), `+layout.svelte` (nav shell + theme switcher; hide admin-only links for non-admins).
- [ ] Copy shared components (theme switcher, status badge, summary card) from dmarc-dashboard `src/lib/components`. NOTE: `rawJsonModal.svelte` and `calendar.svelte` were NOT copied (rawJsonModal unused/removed per review; calendar is DMARC `/domains`-coupled dead code). A `monthPicker` component (year+month select, default = current month, prev/next gated by current date) is introduced in Task 6.

**Files:** `packages/email-service-dashboard/src/routes/{setup/*,sign-in/**,+layout.server.ts,+layout.svelte}`, `src/lib/components/*`

**Acceptance criteria:** `bun run build` + `bun run type-check` pass; `/setup` shows create-admin on fresh deploy and redirects to `/sign-in` once complete.

---

### Task 6: Dashboard views (overview, messages list, message detail + per-recipient timelines, recipients, recipient history) — [x] DONE

Server load functions only read `locals.services`; never construct clients. No FilterExpression.

**Reconciled with the actual (redesigned) model API — supersedes the original method names.** The read-side API is:

- `locals.services.globalStats.get()` → `{ received, sent, delivered, bounced, complained, rejected, failed, total }`.
- `locals.services.recipients.list({ limit?, cursor? })` → `{ items: Recipient[], cursor? }` (reverse GSI `sk="recipient"`).
- `locals.services.recipients.getStats({ email })` → `{ stats: {...counters, total}, email }`.
- `locals.services.messages.messagesManyForMonth({ month: { year, month }, limit?, cursor? })` → `{ items: MessageModel[], cursor? }` (single-month partition `pk="YYYY-MM"`, newest-first).
- `locals.services.messages.messageManyByRecipient({ email, limit?, cursor? })` → `{ items: MessageModel[], cursor? }`.
- `MessageModel` = `{ id (=messageId), recipients, logByRecipient: Record<email, LogEntry[]>, messageLog: LogEntry[] (sorted by timestamp), status, requestId, sender, subject, createdAt, updatedAt }`.
- `defaultLimit = 100`.

**Model gap to close in this task:** `Messages` has NO get-by-id yet. Add `Messages.getById({ messageId }): Promise<MessageModel | null>` — a single `GetCommand` on `pk=messageId, sk="message"`, returning `toModel(...)` or `null` when absent (add a small unit test for it in `tests/messages.test.ts`).

**Pagination pattern (all lists):** cursor-based "Load more" — server load reads `?cursor=` (and month lists read `?year=&month=`), calls the model, returns `{ items, cursor }`. The page shows a **"Load more" button** only when `cursor != null`; clicking it navigates with the new cursor (append semantics via a client-held list or `goto` with accumulated results — pick the simplest that keeps SSR-first). Absent cursor → hide the button (end of data). No auto-fetch-on-scroll. Default page size 100 (`defaultLimit`), except the overview recent list which requests `limit: 30`.

**Month selector:** a shared `src/lib/components/monthPicker.svelte` — two selects (year + month), default = current year/month, "prev"/"next" buttons, with **next disabled when at/after the current month** (no future months). Emits the chosen `{ year, month }` by navigating (`?year=&month=`), so the server load re-queries. Used by the messages list and the per-recipient history.

- [ ] `src/lib/components/monthPicker.svelte` — as above.
- [ ] `src/routes/{+page.server.ts,+page.svelte}` — **Overview**: `globalStats.get()` (totals + delivery/bounce/complaint rates with SES 5% / 0.1% threshold highlights + `total`) and the **30 latest messages for the current month** via `messages.messagesManyForMonth({ month: currentMonth, limit: 30 })`. (Avg delivery latency: only if `deliveryMs` is readily available on the model; otherwise omit and note it — the model currently keeps `deliveryMs` inside `messageLog` delivered entries, so compute from `logByRecipient` if cheap, else skip.)
- [ ] `src/routes/messages/{+page.server.ts,+page.svelte}` — **Messages list**: month-based via `messages.messagesManyForMonth({ month, limit, cursor })`, newest-first, with the `monthPicker` and the "Load more" button. Columns: time / recipients / subject / status badge. A recipient search box → navigates to `/recipients/[email]`.
- [ ] `src/routes/messages/[messageId]/{+page.server.ts,+page.svelte}` — **Message detail**: route param is just `messageId` (model keys by messageId alone). Load via `messages.getById({ messageId })`; 404 when null. Render **per-recipient timelines** from `logByRecipient` (one timeline per recipient, entries sorted by timestamp; show variant detail: delivery latency, bounce type/subtype/diagnostic, complaint feedback, reject reason). Each recipient row links to `/recipients/[email]`. Add a **default form action** `requestBody` that calls `locals.services.email.getMessage(requestId)` and renders `request.html`/`request.text`. Use the default action / encode `/` per sveltekit-lambda steering. Disable the action when `requestId` is absent or `"unknown"`; on `EmailServiceError` code `message_not_found`, show "message body no longer available".
- [ ] `src/routes/recipients/{+page.server.ts,+page.svelte}` — **Recipients list**: `recipients.list({ limit, cursor })` (reverse GSI `sk="recipient"`) with "Load more". Each row links to `/recipients/[email]` and can show that recipient's counters.
- [ ] `src/routes/recipients/[email]/{+page.server.ts,+page.svelte}` — **Per-recipient view**: `recipients.getStats({ email })` (counters + total) + month-based history via `messages.messageManyByRecipient({ email, limit, cursor })` with the `monthPicker` and "Load more". Newest-first.

**Files:** `packages/email-service-dashboard/src/routes/{+page.server.ts,+page.svelte,messages/**,recipients/**}`, `src/lib/components/monthPicker.svelte`, `src/lib/server/messages.ts` (add `getById`), `tests/messages.test.ts` (add `getById` test)

**Acceptance criteria:** `bun run build` + `bun run type-check` + `bun test` pass; loads use only `locals.services`; no Scan/Filter; message list + recipient history are month-scoped via `monthPicker` (default current month, no future months) with a manual "Load more" button that disappears when the model returns no `cursor`; message detail renders per-recipient timelines and the on-demand body via `email.getMessage(requestId)`, degrading gracefully when unavailable.

---

### Task 7: Admin user management routes (copied + simplified) — [x] DONE

- [ ] `src/routes/users/{+page.server.ts,+page.svelte}` — list users; delete action `authClient.invoke({type:"deleteAllSessions",...})` then `users.delete()`; cannot delete self; admin-only.
- [ ] `src/routes/users/invite/{+page.server.ts,+page.svelte}` — validate email, `authClient.invoke({type:"newEmailAccount",...})`, `users.create({type:"user"})`, send invite via `email.sendEmail`; admin-only; no domain selection.
- [ ] `src/routes/users/[email]/edit/{+page.server.ts,+page.svelte}` — edit user type; no domain editing.
- [ ] Guard all three: `error(403)`/redirect for non-admins.

**Files:** `packages/email-service-dashboard/src/routes/users/**`

**Acceptance criteria:** `bun run build` + `bun run type-check` pass; non-admins blocked; invite creates auth account + user + sends email.

---

### Task 8: Prebuilt Lambda bundles — auth OTP consumer + email-events ingest consumer (with test) — [x] DONE

- [ ] `src/authConsumer.ts` — copy verbatim from dmarc-dashboard.
- [ ] `src/eventConsumer.ts` — SQS handler. For each record: `parseEmailEvent(record.body)`; if non-null, `messages.upsertFromEvent(event)`. Instantiate `DynamoDBDocumentClient` (marshall options) + `Messages` once at module scope from env (`DASHBOARD_TABLE_NAME`, `DASHBOARD_REVERSE_INDEX`). Return `batchItemFailures` for retryable errors (partial-batch response). Check whether `@beesolve/sqs-handler` is the standard consumer wrapper (as in `service-email` consumers) and use it if so.
- [ ] `build.ts` — `esmBuild` BOTH `./src/authConsumer.ts` → `dist/authConsumer` and `./src/eventConsumer.ts` → `dist/eventConsumer` (rm each first).
- [ ] Tests: `tests/eventConsumer.test.ts` — feed SQS records with a full lifecycle for one messageId + a duplicate + an unparseable body; assert projection converges, stats `ADD`s issued, duplicates don't grow `messageLog`, unparseable bodies skipped without failing the batch.

**Files:** `packages/email-service-dashboard/src/{authConsumer.ts,eventConsumer.ts}`, `build.ts`, `tests/eventConsumer.test.ts`

**Acceptance criteria:** `bun build.ts` produces both bundles; `bun test` passes `tests/eventConsumer.test.ts`; unparseable bodies ignored.

---

### Task 9: CDK construct (`cdk.ts`) — table, site, auth wiring, both consumers, event rule — [x] DONE

- [ ] `cdk.ts` — `EmailServiceDashboard` + `EmailServiceDashboardProps` (`auth`, `emailSender`, `eventBusName?`, `isProd?`, `removalPolicy?`). Copy dmarc-dashboard structure.
- [ ] Provision dashboard `TableV2` (composite key, on-demand, AWS-managed encryption, optional `ttl`, PITR when `isProd`, `removalPolicy` from props) with ONE reverse GSI (`sk`→partition, `pk`→sort). **Projection: `INCLUDE` of exactly `received, sent, delivered, bounced, complained, rejected, failed`** (plus the keys `pk`/`sk` which are always projected) — the GSI is used ONLY to list recipient-counter records in `recipients.ts`, so it must NOT project message data. Export the index name.
- [ ] `SvelteKit` `Site` + `toDefaultOrigin`: `auth.addAuthorizedEndpoint`, `auth.grantSdkAccess`, grant SSR handler table read/write + inject `DASHBOARD_TABLE_NAME`/`DASHBOARD_REVERSE_INDEX`, return `HttpOrigin(...)`.
- [ ] CloudFront `ensureCookieFunction` override + `/auth/*` behavior (verbatim).
- [ ] `new Emails(this,"Emails",{ defaultSender: props.emailSender, eventBusName })`; `emails.grantAccess(site.handler)`; auth consumer Lambda + `emails.grantAccess` + auth `Rule`.
- [ ] Event-ingest: `SqsWithDlq.asLambdaInput` around a `Nodejs24Function` (`entry:<dir>eventConsumer/`, handler `eventConsumer.handler`); grant table read/write + inject table env; `Rule` on `source:["beesolve.email.api","aws.ses"]` with SQS target. Verify wiring against `service-email/docs/eventbridge-events.md`.
- [ ] Expose `this.distribution`. `tsconfig.cdk.json` covers `cdk.ts`.

**Files:** `packages/email-service-dashboard/{cdk.ts,tsconfig.cdk.json}`

**Acceptance criteria:** `bun run type-check` passes for `cdk.ts`; `bun run build` still succeeds; construct compiles against catalog `aws-cdk-lib`. Optionally add a synth check if a sample stack exists.

---

### Task 10: Docs (ADRs + README), changeset, final verification — [x] DONE

- [ ] `docs/adr-001-motivation.md` (mandatory) — why the package exists, why a dashboard-owned projection (vs reading `EmailLog`), responsibility boundaries.
- [ ] `docs/adr-002-event-projection.md` — single-table key design (`${timestamp}#${messageId}`/`message`, recipient relation, colocated recipient stats, single reverse GSI, recipients listed via `sk="stats"`), atomic-`ADD` increment-only stats made exact via a `TransactWriteItems` gated on `not contains(messageLog, :entry)` + on-the-fly totals, `messageLog` set pattern, variant status + `nextStatus` precedence, on-demand body via `email.getMessage(requestId)`, the one approximate counter (`EmailSentFailure`/`failed`), and the deliberate no-open/click gap. This ADR MUST include:
  - a **"Decision: transactional stats" section with Rationale + Alternatives Considered** — why we chose `TransactWriteItems` (message-record idempotency gate + counter `ADD`s applied atomically → counters can never drift under EventBridge/SQS redelivery, even across a mid-write crash) over Option A (conditional update followed by separate `ADD`s, which is cheaper but permanently under-counts one event if the process dies between the record update and the counter write). Note the accepted trade-offs: ~2x WCU, the 100-item / 4MB transaction cap, and the >~30-recipient split.
  - a **"Consequences: approximate failure counter" note** — `EmailSentFailure` carries no `messageId` and produces no message record, so it has no `messageLog` anchor to gate on; its `failed` counter is a plain `ADD` and may double-count under redelivery. This is an accepted, documented trade-off (failure volume is a low-stakes indicator; a `requestId`-keyed seen-set is the future option if exactness is ever needed).
- [ ] `README.md` — overview, how a stack instantiates `EmailServiceDashboard` (AuthGateway setup, `emailSender`, `eventBusName`), first-deploy `FRONTEND_URI` chicken-and-egg workflow, env vars, sveltekit-lambda gotchas.
- [ ] Changeset — read `package.json` `name` first (`@beesolve/email-service-dashboard`); initial changeset.
- [ ] Final: root `bun run fmt:check`, `bun run lint`, `bun run type-check`, `bun test`, `bun run build` all green; `bun run recalculate-dependencies` clean.

**Files:** `packages/email-service-dashboard/docs/{adr-001-motivation.md,adr-002-event-projection.md}`, `README.md`, `.changeset/<name>.md`

**Acceptance criteria:** root check gates pass; ADR-001 present; changeset uses correct npm name; README documents stack usage + first-deploy workflow.

---

### Task 11: Rename directory `email-service-dashboard` → `service-email-dashboard` — [x] DONE

The repo convention is that the directory name uses the `service-<domain>` pattern while the npm package name stays `<domain>-service` (e.g. `packages/service-email/` → `@beesolve/email-service`). This package must follow that convention: rename the **folder** only — the npm package name stays `@beesolve/email-service-dashboard`.

- [ ] `git mv packages/email-service-dashboard packages/service-email-dashboard` (preserve history).
- [ ] Do NOT change the `name` field in `package.json` — it stays `@beesolve/email-service-dashboard`.
- [ ] Update any path references to the old directory name across the repo: root `package.json`/workspace globs (if they enumerate paths rather than a `packages/*` glob), `bunup.config.ts`, `dependencies.json`, `scripts/publish.ts`, `tsconfig` references, `.changeset` files, docs, and any CI workflow paths. Search the whole repo for `email-service-dashboard/` (path form) and `packages/email-service-dashboard` and fix directory references while leaving the npm name `@beesolve/email-service-dashboard` intact.
- [ ] Re-run `bun install` and `bun run recalculate-dependencies` to refresh any path-derived metadata/lockfile entries.
- [ ] Update the `## Known mappings` list in the workspace TypeScript steering (`.kiro/steering`) to add `packages/service-email-dashboard/` → `@beesolve/email-service-dashboard`.
- [ ] Update this plan file's `**Files:**` paths from `packages/email-service-dashboard/...` to `packages/service-email-dashboard/...`.

**Files:** the whole `packages/email-service-dashboard/` directory (renamed), plus any repo files referencing the old path, and `.kiro/steering` known-mappings.

**Acceptance criteria:** directory is `packages/service-email-dashboard/`; `package.json` `name` is still `@beesolve/email-service-dashboard`; no stale `packages/email-service-dashboard` path references remain (grep clean); root `bun run fmt:check`, `bun run lint`, `bun run type-check`, `bun test`, and `bun run build` (inside the renamed package) all green; `bun run recalculate-dependencies` clean.

---

## Future Work (out of scope)

- **Open / click engagement metrics** — needs `OPEN`/`CLICK` in `eventsToTrack` on `Emails` AND new schemas/guards in `@beesolve/email-service/events`. Not available today.
- **Exact `EmailSentFailure` counter** — the `failed` counter is currently approximate (no per-message anchor to guard on). Key a small seen-set by `requestId` if exactness there becomes a concern; other counters are already exact via the `not contains(messageLog)` guard.
- **Durable/longer-lived message-body inspection** — body inspection currently reuses `email.getMessage(requestId)`, so it's bounded by `service-email`'s `messagesRetentionDays` TTL and unavailable when persistence is `0`. If longer retention or `messageId`-keyed lookup is needed, `service-email` could optionally persist bodies to S3 (`${messageId}.json`, configurable lifecycle) and add a presigning SDK method. (service-email-side; not required for the current feature.)
- **Full-text search** over subject/body — current search is recipient-exact only (no Scan/Filter by design).
- **Suppression-list management** (auto-suppress hard bounces/complaints) — natural follow-up now that bounce/complaint data is projected.
- **CSV export / scheduled deliverability digest emails.**
- **Multi-tenant / per-sender scoping** if multiple apps share one dashboard.
