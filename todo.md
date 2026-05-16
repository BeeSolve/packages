# TODO: @beesolve/packages improvements

Tracks progress against PLAN.md. See REVIEW.md for full context on each item.

---

## Security

- [x] **cdk-constructs** — Fix credential injection in `StaticWebsite` basic auth CloudFront function (`src/staticWebsite.ts`) — _commit 3b7ed5d_

---

## Correctness (silent failures & data loss)

- [x] **email-service** — Chunk DynamoDB `batchWrite` into ≤25-item groups using `splitArrayToChunks` from `@beesolve/helpers` (`src/handler.ts`)
- [x] **sqs-handler** — Throw on unknown function name instead of silently returning `undefined` (`index.ts`)
- [x] **lambda-fetch-api** — Fix content-type regex to correctly anchor `application/json` match (`src/util.ts`)
- [x] **email-service** — Add `v.email()` validation to sender `emailAddress` field (`src/validation.ts`)

---

## Error handling

- [x] **email-service** — Log (or re-throw) EventBridge `putEvents()` failures (`src/events.ts`)
- [x] **email-service** — Fix typo `labmda` → `lambda` in error messages (`src/handler.ts`)
- [x] **sqs-handler** — Remove unused `SQSClient` import (`index.ts`)

---

## Tooling

- [ ] **root** — Add Biome for linting + formatting (`package.json`, `biome.json`)
- [ ] **root** — Add `bun run lint` step to CI (`ci.yml`)

---

## Documentation

- [ ] **sqs-handler** — Fix README example: `queueUrl` → `queueUrls` (`README.md`)

---

## Code quality

- [ ] **email-service** — Consolidate `AttachmentValidationError` / `AttachmentFetchError` / `AttachmentUploadError` into a single `EmailServiceError` class (`sdk.ts`)
- [ ] **cdk-email-alarms** — Scope CloudWatch alarm construct IDs per resource to prevent duplicate ID errors (`index.ts`)

---

## Security hardening (lower priority)

- [ ] **email-service** — Restrict SES IAM policy from `"*"` to specific identity ARNs (`cdk.ts`)
- [ ] **email-service** — Add timeout + size cap to public attachment URL fetching (`src/handler.ts`)

---

## Tests (future — tracked separately)

- [ ] Set up `bun:test` at the monorepo root
- [ ] `@beesolve/helpers` — unit tests for `stringifiable.ts` round-trips and UUID edge cases
- [ ] `@beesolve/lambda-fetch-api` — unit tests for request/response transformations
- [ ] `@beesolve/sqs-handler` — unit tests for message routing and FIFO dedup logic
- [ ] `@beesolve/cdk-constructs` — CDK assertion tests (`aws-cdk-lib/assertions`)
- [ ] `@beesolve/email-service` — handler unit tests (batch write chunking, attachment paths)
