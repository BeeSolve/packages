# Code Review: @beesolve/packages

**Reviewed:** 2026-05-16  
**Packages:** 6 (`helpers`, `cdk-constructs`, `cdk-email-alarms`, `lambda-fetch-api`, `sqs-handler`, `email-service`)

---

## Executive Summary

The monorepo is well-structured for a small, focused AWS infrastructure library set. The tooling choices are modern and sensible: Bun workspaces, catalog-pinned dependencies, Changesets for versioning, OIDC-based publishing with no stored secrets, and strict TypeScript. The packages are concise and follow a consistent ESM-only style.

**What's consistently good:**
- Strict TypeScript with `isolatedDeclarations` (mostly) and `verbatimModuleSyntax`
- Valibot for runtime validation where it matters most
- Opinionated CDK constructs that reduce boilerplate at the call site
- The `add-package` script and topological publish ordering are genuinely useful automation

**Top three concerns across the whole codebase:**
1. **Zero tests** — not a single test file in any package. Correctness is validated only by TypeScript and manual deploys.
2. **One security flaw** — credentials are injected raw into CloudFront function JavaScript (`cdk-constructs`).
3. **Silent failures** — several places swallow errors or return `undefined` when they should throw.

---

## Monorepo Setup

### What's good
- Bun workspaces with catalog version pinning keeps all packages on the same dependency versions without manual coordination.
- Changesets + GitHub Actions OIDC publish is clean — no long-lived secrets.
- `scripts/recalculate-dependencies.ts` using Kahn's algorithm for topological sort is a smart solution for ordered publishing.
- `scripts/add-package.ts` scaffolding reduces the setup cost of a new package and auto-updates `bunup.config.ts`.
- TypeScript 6.x, Node 24, ES2023 — the stack is current.

### What's missing / wrong
| Gap | Impact |
|-----|--------|
| No test runner configured (vitest, bun:test, etc.) | Regressions go undetected |
| No linter (ESLint, Biome, oxlint) | Style drift, unused imports, and easy-to-catch bugs accumulate silently |
| No pre-commit hooks (husky, lefthook) | Nothing prevents broken types or obvious issues from reaching CI |
| No `CLAUDE.md` | No codebase documentation for AI assistants or new contributors |
| CI only type-checks and builds — no test step | CI gives false confidence |
| `bun.lock` is binary | Diff-unreadable; fine for Bun, but worth noting |

**Recommendation:** Add Biome (handles both linting and formatting in one tool, zero config overhead) and `bun:test` for a test runner. Both integrate with Bun without extra dependencies.

---

## @beesolve/helpers (v0.1.4)

### What's good
- The utility surface is small and well-typed. No bloat.
- UUIDv7 is the right choice for sortable, time-ordered IDs. The base36 encoding for shorter strings is a nice touch.
- `bun.ts` wrapping `parseArgs` with Valibot validation is elegant — type-safe CLI arg parsing in a few lines.
- `stringifiable.ts` solving the JSON-serialization gap for `FormData`, `Date`, `Blob`, etc. is genuinely useful.

### Issues

**`src/uuid.ts` — byte assignments without bounds checking**  
Lines 17-22 do direct byte assignments like `bytes[0] = timestamp / 2 ** 40`. JavaScript doesn't enforce `Uint8Array` bounds on assignment — out-of-range values silently wrap. If the clock skew or system time is unusual, you can get a structurally invalid UUID with no error. Add a `& 0xFF` mask or an assertion.

**`src/stringifiable.ts` — FormData round-trip is unvalidated**  
Lines 61 and 107 call `JSON.parse()` on the stored string and reconstruct `FormData` without validating the structure. If a message is malformed or tampered with, reconstruction silently produces an incorrect object.

**`index.ts` — `call()` has unclear purpose**  
```ts
export const call = <T>(fn: () => T): T => fn()
```
This is just an IIFE helper. It's not wrong but it's unexplained and the name collides with common mental models (e.g. `.call()` on functions). Either document why it exists or remove it.

**`toRecordByProperty` — implicit `any` in value**  
The value type is inferred as `any` when the object properties aren't constrained. Adding a bound like `T extends Record<K, unknown>` would give stricter inference.

### Missing
- No tests for `stringifiable.ts` round-trips (especially `FormData`, `Blob`, nested structures)
- No tests for UUID edge cases (max clock sequence, uuid7ToDate recovery)
- No README explaining the intended use of `bun.ts` vs `index.ts`

---

## @beesolve/cdk-constructs (v0.1.28)

### What's good
- `sqsWithDlq.ts` is clean: sensible defaults, DLQ wired automatically, Lambda event source returned as a helper.
- `esbuildBuild.ts` handles the ESM/CJS interop problem thoughtfully — the banner polyfill for `__dirname`/`require` is necessary for Lambda and correctly handled.
- `nodejsFunction.ts` integrating esbuild bundling directly into CDK synthesis is a good pattern.
- `cloudFrontAccessLoggingSettings.ts` automating the Glue/Athena setup for CloudFront logs is non-trivial and valuable.

### Issues

**`staticWebsite.ts` L160-180 — credential injection into CloudFront JS (security)**  
Username and password from props are template-literal interpolated directly into a CloudFront Functions JavaScript string:
```ts
`const expected = "Basic " + btoa("${props.basicHttpAuthentication.username}:${props.basicHttpAuthentication.password}");`
```
If either value contains `"`, `'`, `;`, or `\`, the generated function is syntactically broken or the credentials leak into code comments. An attacker controlling the props (e.g. via IaC injection) could execute arbitrary JS in the edge function.

**Fix:** Base64-encode the combined credential at synth time and embed only the encoded string, or escape both values with `JSON.stringify()`.

**`sqsWithDlq.ts` — dead-letter queue prop merge order**  
The spread `{ ...deadLetterQueueProps, deadLetterQueue }` overwrites any user-provided `deadLetterQueue` inside `deadLetterQueueProps`. The internal DLQ configuration should come last to ensure the construct's intent wins.

**`nodejsFunction.ts` — temp directory never cleaned up**  
Line 86 creates a `tmpdir()` path for each build but never removes it. Multiple CDK `cdk synth` invocations accumulate orphaned directories.

**`cloudFrontAccessLoggingSettings.ts` L52 — unsafe column lookup**  
`columnDefinitionByKey[column]` can return `undefined` for an unknown column name. The code proceeds without error, silently dropping the column from the Glue table.

**`staticWebsite.ts` — `StaticWebsite` does too much**  
One construct handles: S3 origin, CloudFront distribution, certificate, DNS records, CSP headers, basic auth, redirect rules, access logging, bucket deployment. This makes it very hard to reuse parts of it or override specific behaviors.

**`staticWebsite.ts` — CSP has hardcoded opinionated defaults**  
The `csp()` function bakes in `fonts.googleapis.com`, `'none'` for most directives, and no way to inherit from or merge with an external policy.

### Missing
- No tests (CDK construct testing is done with `aws-cdk-lib/assertions` — no setup here)
- No README examples for any construct
- No JSDoc on public props interfaces

---

## @beesolve/cdk-email-alarms (v0.1.3)

### What's good
- Focused single-responsibility construct. Does one thing well.
- The separation between `addLambdaAlarms()` and `addQueueAlarms()` is clear.
- Emitting both OK and ALARM state changes is correct — you want to know when things recover, not just when they break.

### Issues

**CloudWatch alarm names are not scoped per resource**  
Construct IDs `"NoMessagesAlarm"` and `"NoConsumersAlarm"` are hardcoded strings. When `EmailAlarms` is used on two different queues in the same stack, CDK will throw a duplicate construct ID error. They should include the queue or function name.

**Alarm thresholds are hardcoded**  
`threshold: 1` and `evaluationPeriods: 1` are not customizable. Different teams have different SLA requirements. Expose these as optional props with the current values as defaults.

**`emailSubscription` stored unnecessarily as instance property**  
It's created in the constructor and only used in `addLambdaAlarms()` / `addQueueAlarms()`. It's not needed on the public API. Can be a local variable.

### Missing
- No README or JSDoc on the alarm behavior, thresholds, or what the email format looks like
- No snapshot tests or assertion tests

---

## @beesolve/lambda-fetch-api (v0.1.6)

### What's good
- The adapter pattern is well-chosen — consuming code works with `Request`/`Response` and never touches AWS event shapes directly.
- Supporting all three handler modes (v1 REST API, v2 HTTP API, response streaming) in one package is valuable.
- Base64 body decoding is handled correctly.
- The `aws-event` / `aws-context` header injection into the Request is a clean way to pass Lambda metadata without polluting the fetch API.

### Issues

**`src/util.ts` — content-type regex doesn't match `application/json`**  
The current regex:
```ts
/^text\/|\/(javascript|json|xml)|utf-?8/i
```
The second alternative requires a `/` immediately before the type word. For `application/json`, that matches. But for `application/json; charset=utf-8` it also works. Let me be more precise: the issue is that `/(javascript|json|xml)` without anchoring would also match `not-json`, `myjsonfile`, etc. The original concern was that it is overly permissive and could match things it shouldn't while still missing edge cases. Better to write it explicitly:
```ts
/^text\/|^application\/(json|xml|javascript)|utf-?8/i
```

**Multi-value headers in API Gateway v1 are silently dropped**  
`awsEventHeaders()` flattens `headers` from `Record<string, string>`. API Gateway v1 also provides `multiValueHeaders` for headers that appear multiple times. Only cookies get the array treatment — any other repeated headers are lost.

**No body size limit**  
`toBuffer()` reads the entire `ReadableStream` into memory. A large response body from the handler could cause Lambda OOM. Add an optional `maxBodyBytes` cap.

**Shallow type guards in `src/runtime.ts`**  
`isAPIGatewayProxyEvent` checks one field (`requestContext.resourceId`). A malformed event with just that field would pass the guard.

**`TODO.md` items are unaddressed**  
The file references authorizer helpers and a local testing adapter — neither is implemented. Either implement them or remove the TODO to avoid misleading users.

### Missing
- No tests (this is one of the most testable packages — pure function transformations)
- No README with usage examples
- Valibot validation of `toAwsEvent()` (acknowledged in a TODO comment in the source)

---

## @beesolve/sqs-handler (v0.1.20)

### What's good
- The type-safe queue proxy (`queued.functionName(args)`) is the best API in the monorepo — ergonomic and catches wrong call sites at compile time.
- FIFO queue support with message deduplication and group IDs is thoughtfully included.
- Valibot validation of the incoming SQS message format catches malformed messages early.
- The local invocation path (`if (isLocal)`) enables development without a real SQS queue.

### Issues

**`index.ts` L59 — missing function silently returns `undefined`**  
```ts
props.functions[fn]?.()
```
If a message arrives with an unknown `fn` name, the optional chain silently returns `undefined`. The handler then processes the `undefined` result as if it succeeded. This masks routing errors — a typo in a queue message or a stale message format will be silently ACK'd.

**Fix:**
```ts
if (!(fn in props.functions)) throw new Error(`Unknown function: ${fn}`)
const result = props.functions[fn](...)
```

**`SQSClient` imported but not used**  
`index.ts` imports `SQSClient` but only `SendMessageCommand` is used. Dead import — will trigger any linter.

**`any[]` for function arguments loses type safety**  
Function args are typed as `any[]` through the serialization/deserialization boundary. The proxy captures the argument types at call time, but at the handler side all type information is gone. This is a fundamental limitation of the pattern, but worth documenting.

**`README.md` example uses wrong parameter name**  
The README shows `queueUrl` (singular) but the actual type uses `queueUrls` (plural, a `Record`). The example will not compile against the real API.

**Magic string `"main"` scattered in `cdk.ts`**  
The default queue label is hardcoded in multiple places. A `const MAIN_QUEUE_LABEL = "main"` at the top of the file would make it refactorable.

### Missing
- Tests for message routing, FIFO dedup, and error cases
- Documentation on the JSON wire format `{fn, args}` so consumers know what they're sending
- README fix for `queueUrl` → `queueUrls`

---

## @beesolve/email-service (v0.1.19)

### What's good
- The most complete package — CDK infra, SDK client, Lambda handler, and React Email templating all in one cohesive unit.
- Valibot schema in `validation.ts` is thorough and correct for recipients.
- React Email is the right choice for cross-client HTML emails.
- EventBridge success/failure events provide good observability hooks.
- DynamoDB TTL for email metadata is a sensible retention strategy.

### Issues

**`handler.ts` L10/L13 — typo in error message**  
`"labmda"` should be `"lambda"`. Small but unprofessional in error logs.

**`handler.ts` — DynamoDB `batchWrite` exceeds AWS 25-item limit**  
`batchWrite` at lines 163-191 writes `recipients.length * 2` items (one for the email record, one per recipient). AWS enforces a hard limit of 25 items per `BatchWriteItemCommand`. For an email with 13+ recipients this call will throw. Chunk the writes into groups of 25.

**`handler.ts` L86 — unvalidated public URL fetch for attachments**  
Arbitrary URLs from the email request body are fetched with no timeout, no size cap, and no origin allowlist. This could be used to:
- Trigger SSRF against internal metadata endpoints
- Cause Lambda OOM by streaming a large file
- Slow the handler to timeout

**`cdk.ts` — SES IAM policy allows `*` resource**  
```ts
actions: ["ses:SendEmail", "ses:SendRawEmail"],
resources: ["*"],
```
Should be scoped to the specific SES identity ARN(s) used by the service.

**`sdk.ts` — three nearly-identical error classes**  
`AttachmentValidationError`, `AttachmentFetchError`, and `AttachmentUploadError` each repeat the same constructor and `stringified` getter. Consolidate into a single `EmailServiceError` with a `code: string` field.

**`sdk.ts` L106 — "todo: test this properly" on a code path in production**  
The `Buffer` → `ArrayBuffer` conversion path has a comment acknowledging it's untested. This is a real path hit when uploading binary attachments.

**`validation.ts` — sender `emailAddress` has no format validation**  
Recipients are validated with `v.email()`, but the sender's `emailAddress` field is just a `v.string()`. An invalid sender address will fail at SES send time rather than at schema validation time.

**`events.ts` — EventBridge failures silently swallowed**  
`putEvents()` is called with no error handling. If EventBridge is unavailable or the event fails, the handler continues as if the event was emitted. At minimum, log the failure.

**`cdk.ts` L165 — fragile handler.zip path resolution**  
```ts
fileURLToPath(new URL(".", import.meta.url))
```
This resolves relative to the compiled file's location at runtime. If the package is bundled differently (e.g. with a different output structure), `handler.zip` won't be found. Consider embedding the path as a build-time constant or validating it at construct init time with a clear error.

**`handler.ts` — split-brain risk: email sent but not recorded**  
SES `sendEmail` succeeds on line ~130, then DynamoDB write happens after. If DynamoDB fails, the email was sent but there's no record of it. The success event won't be emitted either. Consider writing a "pending" record before sending, then updating it after.

### Missing
- Tests for handler (message parsing, attachment paths, batch write edge cases)
- Email format validation on the sender address
- Attachment fetch timeout and size cap
- Chunking for DynamoDB batch writes

---

## Cross-Cutting Summary

| Concern | Status | Priority |
|---|---|---|
| Tests | None in any package | Critical |
| Linting (Biome/ESLint) | Not configured | High |
| Pre-commit hooks | Not configured | Medium |
| `CLAUDE.md` | Missing | Low |
| Error handling | Inconsistent (throw vs swallow vs log) | High |
| `isolatedDeclarations` | `service-email` disables it; others enable | Medium |
| README accuracy | Outdated in `sqs-handler`, missing in most | Medium |
| Credential injection in CloudFront | Security flaw in `cdk-constructs` | Critical |
| DynamoDB 25-item batch limit | Silent failure risk in `email-service` | High |

---

## Priority Action List

| Priority | Action | Package | File |
|---|---|---|---|
| Critical | Escape/base64 credentials before embedding in CloudFront JS | `cdk-constructs` | `src/staticWebsite.ts` |
| Critical | Add tests — start with `helpers` and `sqs-handler` | all | — |
| High | Guard DynamoDB batchWrite against >25 items | `email-service` | `src/handler.ts` |
| High | Fix content-type regex to correctly match `application/json` | `lambda-fetch-api` | `src/util.ts` |
| High | Add Biome to the monorepo root | root | `package.json` |
| High | Throw on unknown function name in SQS handler | `sqs-handler` | `index.ts` |
| Medium | Fix README example (`queueUrl` → `queueUrls`) | `sqs-handler` | `README.md` |
| Medium | Add timeout + size cap to attachment URL fetching | `email-service` | `src/handler.ts` |
| Medium | Restrict SES IAM policy to specific identity ARNs | `email-service` | `cdk.ts` |
| Medium | Scope CloudWatch alarm construct IDs per resource | `cdk-email-alarms` | `index.ts` |
| Medium | Consolidate three error classes into one | `email-service` | `sdk.ts` |
| Low | Fix typo `labmda` → `lambda` | `email-service` | `src/handler.ts` |
| Low | Remove unused `SQSClient` import | `sqs-handler` | `index.ts` |
| Low | Add `CLAUDE.md` documenting monorepo conventions | root | — |
