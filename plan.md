# Improvement Plan: @beesolve/packages

Derived from REVIEW.md (2026-05-16). Items are grouped by theme and ordered by impact.

---

## 1. Security fixes

### 1.1 Credential injection in `StaticWebsite` basic auth — DONE
Pre-compute the `Basic <base64>` string at CDK synth time so no user-controlled input
touches the generated CloudFront function source. Use `JSON.stringify` for the prefixes
array. See commit `3b7ed5d`.

**File:** `packages/cdk-constructs/src/staticWebsite.ts`

---

## 2. Correctness fixes (silent failures & data loss)

### 2.1 DynamoDB batch write chunking — `email-service`
`BatchWriteItemCommand` has a hard AWS limit of 25 items. The handler writes
`recipients.length * 2` items in one call, so any email with 13+ recipients will throw.

**Approach:** Use `splitArrayToChunks(items, 25)` from `@beesolve/helpers` to split the
write items, then `await Promise.all` the resulting batch calls.

**File:** `packages/service-email/src/handler.ts` (lines ~163-191)

### 2.2 Throw on unknown SQS function name — `sqs-handler`
`props.functions[fn]?.()` silently returns `undefined` for unknown function names,
causing the message to be ACK'd without processing.

**Approach:** Replace optional chain with an explicit presence check and `throw`.

**File:** `packages/sqs-handler/index.ts` (line ~59)

### 2.3 Content-type regex in `lambda-fetch-api`
The current regex `/^text\/|\/(javascript|json|xml)|utf-?8/i` is unanchored on the second
alternative — it can match unintended strings. Rewrite as:
`/^text\/|^application\/(json|xml|javascript)|utf-?8/i`

**File:** `packages/lambda-fetch-api/src/util.ts` (line ~191)

### 2.4 Sender email address validation — `email-service`
`validation.ts` validates recipient addresses with `v.email()` but the sender
`emailAddress` field is a bare `v.string()`. An invalid sender will fail at SES send time.

**Approach:** Add `v.email()` pipe to the sender `emailAddress` field.

**File:** `packages/service-email/src/validation.ts`

---

## 3. Error handling improvements

### 3.1 Log EventBridge failures — `email-service`
`events.ts` calls `putEvents()` with no error handling. Failures are silently swallowed.

**Approach:** Wrap in try/catch and log the error. Decide whether to re-throw (strict) or
just log (lenient) based on whether event emission is considered critical.

**File:** `packages/service-email/src/events.ts`

### 3.2 Remove unused `SQSClient` import — `sqs-handler`
Dead import; triggers any linter.

**File:** `packages/sqs-handler/index.ts`

### 3.3 Fix typo in error messages — `email-service`
`"labmda"` → `"lambda"` at lines 10 and 13.

**File:** `packages/service-email/src/handler.ts`

---

## 4. Tooling — linting & formatting

### 4.1 Add Biome to the monorepo root
Biome handles both linting and formatting in a single tool with near-zero config.
It integrates with Bun and runs fast.

**Approach:**
1. `bun add -d @biomejs/biome` at the root
2. `bunx biome init` to generate `biome.json`
3. Configure to match existing style (tabs vs spaces, quote style, etc.)
4. Add `"lint": "biome check ."` and `"format": "biome format --write ."` to root scripts
5. Add a `bun run lint` step to `ci.yml`

**Files:** `package.json`, `biome.json`, `.github/workflows/ci.yml`

---

## 5. Documentation fixes

### 5.1 Fix `sqs-handler` README example
The README uses `queueUrl` (singular) but the actual API uses `queueUrls` (plural, a
`Record<string, string>`). The example will not compile.

**File:** `packages/sqs-handler/README.md`

---

## 6. Minor code quality

### 6.1 Consolidate error classes in `email-service` SDK
`AttachmentValidationError`, `AttachmentFetchError`, and `AttachmentUploadError` are
near-identical. Replace with a single `EmailServiceError` class that takes a `code` string.

**File:** `packages/service-email/sdk.ts`

### 6.2 Scope CloudWatch alarm construct IDs — `cdk-email-alarms`
`"NoMessagesAlarm"` and `"NoConsumersAlarm"` are hardcoded, causing duplicate construct ID
errors when the construct is used on multiple queues in the same stack. Include the queue or
function logical ID in the construct ID.

**File:** `packages/cdk-email-alarms/index.ts`

---

## 7. Tests (future work — tracked separately)

No package has any tests. Highest-value starting points:
- `@beesolve/helpers` — pure functions, easy to test with `bun:test`
- `@beesolve/lambda-fetch-api` — pure request/response transformations
- `@beesolve/sqs-handler` — message routing logic

CDK packages use `aws-cdk-lib/assertions` for snapshot and fine-grained assertion testing.

---

## 8. Security hardening (lower priority)

### 8.1 Restrict SES IAM policy — `email-service`
The CDK construct grants `ses:SendEmail` and `ses:SendRawEmail` on `"*"`. Scope to the
specific SES identity ARN(s) configured for the service.

**File:** `packages/service-email/cdk.ts`

### 8.2 Attachment URL fetch safety — `email-service`
Public URLs are fetched with no timeout, no size cap, and no origin allowlist. Add an
`AbortSignal.timeout()` and a max-bytes guard to the fetch call.

**File:** `packages/service-email/src/handler.ts` (line ~86)
