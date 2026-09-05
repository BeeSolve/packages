# ADR-002: Event Projection & Single-Table Layout

## Status

Accepted

## Context

The dashboard consumes the email delivery lifecycle off EventBridge (source `beesolve.email.api` from the service, `aws.ses` from SES) and must project it into a durable, queryable store. The events arrive independently, out of order, and can be **redelivered** (EventBridge at-least-once delivery, plus the SQS buffer in front of the ingest Lambda). The projection has to serve, without `Scan` or `FilterExpression`:

- a single message by id, with its full per-recipient timeline,
- messages for a given month, newest-first, paginated,
- messages for a given recipient, newest-first, paginated,
- global aggregate counters and per-recipient aggregate counters,
- a list of all recipients.

Because events are redelivered, the aggregate counters are the hard part: a naive "increment on every event" over-counts, and a naive "check-then-increment" can under-count if the process crashes between the check and the increment.

> This ADR documents the design as actually built in `src/lib/server/messages.ts`, `stats.ts`, and `recipients.ts`. It supersedes the original plan's projection design, which used a `${timestamp}#${messageId}` message `pk`, a status _fold_ with a `nextStatus`/`statusRank` precedence helper, and a `messageLog` keyed on `{status, timestamp}`. None of that was built — see the "Status by latest timestamp" and "Single transaction" sections.

## Decision

### Single-table key layout

One DynamoDB table, composite `pk` + `sk`, on-demand billing, plus one reverse GSI. Five item families:

| Family            | pk          | sk                                    | purpose                                           |
| ----------------- | ----------- | ------------------------------------- | ------------------------------------------------- |
| Message record    | `messageId` | `"message"`                           | the message + its flat `messageLog` + idempotency |
| Recipient-query   | `email`     | `"message#${createdAt}#${messageId}"` | list a recipient's messages, newest-first         |
| Month-query       | `"YYYY-MM"` | `"${createdAt}#${messageId}"`         | list a calendar month, newest-first               |
| Recipient counter | `email`     | `"recipient"`                         | per-recipient aggregate counters                  |
| Global stats      | `"stats"`   | `"global"`                            | global aggregate counters                         |

**Why `messageId` is the message `pk`.** SES lifecycle events (`SES Delivery` / `Bounce` / `Complaint` / `Reject` / `Message Sent`) only carry `mail.messageId` — there is no timestamp available at the join point that is stable across the whole lifecycle. Keying the message record on `messageId` alone means every event can locate its message with a single-key `GetItem`/`Update` regardless of arrival order, and the join is deterministic. (The original plan's `${timestamp}#${messageId}` pk was abandoned precisely because no such stable timestamp is carried by all events.)

**Listing is query + BatchGet, never Scan.** The recipient-query and month-query records are thin key-only rows whose `sk` sorts by `createdAt`. To list, we `Query` the relevant partition `ScanIndexForward: false` (newest-first) with a `Limit` and an `ExclusiveStartKey` cursor, projecting only `pk`/`sk`, then `BatchGet` the referenced message records (`pk=messageId, sk="message"`) in chunks of 100. One `Query` + one `BatchGet` per page.

### The flat `messageLog` String Set

Each message record holds one **flat** String Set, `messageLog`, spanning **all** recipients. Every observed event contributes one member per affected recipient:

```
JSON.stringify(sortKeys({ recipient, ...eventData }))
```

`sortKeys` recursively sorts object keys before stringifying so the serialization is stable — the same logical entry always produces the same string, so DynamoDB set semantics dedupe redelivered entries naturally and `ADD` is idempotent for the log itself. On read, `toModel` parses each member, sorts by event `timestamp`, and groups into `logByRecipient` (`Record<email, LogEntry[]>`).

The log statuses are `messageStatuses = ["sent","delivered","bounced","complained","rejected"]`, plus `"requested"` which is a **log-entry-only** status (recorded from `EmailSentSuccess`, never a terminal message status).

### Status by latest timestamp (no fold)

The message's current `status` is **derived on read**, not stored and not folded. `toModel` sorts the log by event `timestamp` and takes the last entry's status (`log.at(-1)?.status ?? "requested"`). There is no `nextStatus`, no `statusRank`, and no terminal-precedence table. This deliberately replaces the original plan's status-fold: latest-by-timestamp is simpler, needs no precedence rules, and is naturally consistent under out-of-order/duplicate delivery because ordering is recomputed from the (deduped) log on every read.

Trade-off: "latest wins" is not the same as "worst outcome wins" — e.g. a late `delivered` timestamp could display over an earlier `complained`. In practice SES lifecycle timestamps order sensibly, and the full per-recipient timeline is always shown, so the derived headline status is a convenience, not the source of truth.

### Reverse GSI — recipient counters only

The reverse GSI (`sk` → partition, `pk` → sort) exists for exactly one query: `Recipients.list()` does `KeyConditionExpression: "#sk = :sk"` with `:sk = "recipient"` to enumerate all recipient-counter records. To avoid duplicating message data into the index, its projection is `INCLUDE` of exactly the seven counters — `received, sent, delivered, bounced, complained, rejected, failed` — plus the keys. **Not** `ALL`.

### Message body on demand

The dashboard stores no message bodies. The message detail view calls `email.getMessage(requestId)` from `@beesolve/email-service/sdk` on demand and renders `request.html` / `request.text`. This is bounded by `service-email`'s `EmailLog` TTL (`messagesRetentionDays`); when the source record is gone, `getMessage` throws and the UI shows "no longer available". `requestId` is only known when an `EmailSentSuccess` event was seen; when only SES events were observed it is the placeholder `"unknown"` and the body action is unavailable.

### No open / click tracking

Opens and clicks are deliberately out of scope. SES engagement tracking is not consumed; the projection covers send/delivery/bounce/complaint/reject only.

## Rationale

### Decision: single transaction

Every write for one event goes into **one** `TransactWriteItems`:

1. the **message record** `Update` — `SET` the fields, `ADD` the new `messageLog` members and the event id into `idempotencyKeys`, gated by `ConditionExpression: "not contains(#idempotencyKeys, :eventId)"`;
2. the **global stats** `ADD #<status> :1`;
3. one **recipient counter** `ADD #<status> :1` per affected recipient;
4. one **recipient-query** `Put` per recipient (`sk = "message#${createdAt}#${messageId}"`);
5. one **month-query** `Put` (`pk = "YYYY-MM"`, `sk = "${createdAt}#${messageId}"`).

The idempotency key is the **EventBridge event `id`**, accumulated in a dedicated `idempotencyKeys` String Set on the message record. If the event was already applied, the condition on item (1) fails and DynamoDB cancels the **entire** transaction; we detect this as `error instanceof TransactionCanceledException` with `CancellationReasons[0].Code === "ConditionalCheckFailed"` and treat it as already-applied (return, no-op). Because the condition and the counter `ADD`s are in the same atomic unit, counters advance **exactly once** per event — they cannot drift under redelivery, and cannot half-apply across a mid-write crash (the whole transaction is all-or-nothing).

### Alternatives Considered

**Conditional update, then separate stats `ADD`s (two calls).** Do the gated message-record update first; if it succeeds, fire the counter `ADD`s afterward. Cheaper (roughly half the write cost, no transaction). Rejected as the default: a crash between the message update and the follow-up `ADD`s permanently **under-counts** that event, because the idempotency guard then blocks the retry from re-applying it. The transaction removes that window.

**Fold status + precedence table (original plan).** Rejected in favor of derive-on-read latest-by-timestamp — no precedence rules to maintain, and correct under duplicate/out-of-order delivery.

## Consequences

### Accepted trade-offs of the transaction

- **~2× write cost** vs. the two-call approach (transactional writes are billed at double).
- **The 100-item / 4 MB transaction cap.** One event's transaction is `message + global + N recipient-counters + N recipient-query puts + 1 month-query put`, i.e. roughly `3 + 2N` items.
- **A hard 48-recipient cap.** `upsert` throws above 48 recipients (keeps `3 + 2N` under the 100-item limit) and also throws on **0** recipients. Messages fanned out to more than 48 recipients are not supported by this projection.

### Consequences: approximate failure counter

`EmailSentFailure` carries **no `messageId`**. It therefore produces no message record, has no `messageLog`, and has no `idempotencyKeys` anchor to gate against. Its `failed` counter is a plain, un-gated `ADD failed :1` on the global stats record (`GlobalStats.addFailure`), so under EventBridge/SQS redelivery it **may double-count**. This is an accepted trade-off; if exactness is needed later, a `requestId`-keyed seen-set on the global stats record is the future option. Note `failed` is a stats-only counter — it is never a message status.

## References

- `src/lib/server/messages.ts` — `Messages.upsert` (the transaction), `toModel` (status/log derivation), `sortKeys`, the query methods.
- `src/lib/server/stats.ts` — `GlobalStats.get` / `addFailure`.
- `src/lib/server/recipients.ts` — `Recipients.list` (reverse GSI) / `getStats`.
- `src/eventConsumer.ts` — event → `upsert` mapping and `EmailSentFailure → addFailure`.
- ADR-001 — why the package owns its own projection.
