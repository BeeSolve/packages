# Release 1.0.0 - Stabilize and Clean Up

## Status: In Progress

## Problem Statement

All `@beesolve/*` packages except two are on `0.x` versions, a deliberate choice made during rapid development when breaking changes were frequent and acceptable. The APIs are now considered stable, and the owner is the only consumer, so promoting the packages to `1.0.0` is low-risk. From `1.0.0` onward the contract changes: no breaking changes without a major-version bump.

Before cutting `1.0.0`, we want to clean up outstanding loose ends - but **without adding any new features**. Specifically:

1. Resolve the 4 remaining `// todo:` markers in the codebase.
2. Formally accept the 3 open bug documents.
3. Remove the pre-1.0 stability banner from every promoted package's README.
4. Bump the 20 promoted packages to `1.0.0` via changesets.

This plan does NOT add features. Where a `// todo:` describes an unbuilt feature, the resolution is to remove the dead placeholder (so we are not freezing a half-built surface at 1.0), not to build it. Where a bug is an upstream/infrastructure limitation outside our packages' public API, the resolution is to formalize it as an accepted known-issue, not to chase an upstream fix as a 1.0 blocker.

## Architecture / Approach

### Inventory of outstanding work

**The 4 `// todo:` markers** (verified with `grep -rniE "//\s*todo" packages --include='*.ts' --include='*.svelte' --exclude-dir=node_modules`):

| #   | Location                                                          | Current comment                                                                                     | Nature                                                   | 1.0 resolution                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `packages/service-auth/src/handlers/passkeyAuthOptions.ts:34`     | `// todo: get rid of ternary here`                                                                  | Trivial readability cleanup                              | Move the lookup into a small helper with an early return (`if (userId == null) return [];`); remove the comment. No behavior change.                                                                         |
| 2   | `packages/service-email/src/handler.ts:116`                       | `// todo: test this properly`                                                                       | Missing test coverage for attachment ArrayBuffer slicing | Extract the slice into a small internal pure helper, add a focused unit test, remove the comment. No API change.                                                                                             |
| 3   | `packages/service-email-dashboard/src/lib/server/messages.ts:175` | `// todo: we need to verify all the inserted data before we instert them (through valibot schemas)` | Input-validation hardening at a storage boundary         | Validate the `upsert` input with a Valibot schema before writing (steering requires validating external input at boundaries). This is hardening of existing behavior, not a new feature. Remove the comment. |
| 4   | `packages/service-email-dashboard/src/lib/server/messages.ts:416` | `// todo: here we could create algorithm which will go through multiple "months" in PK ...`         | A speculative pagination enhancement (new feature)       | Do NOT implement (it is a feature). Remove the speculative comment and record the single-month limitation in the package's docs as a known limitation.                                                       |

A fifth todo (`packages/cdk-constructs/src/staticWebsite.ts`, "add errors if multipage application") was already resolved by commit `0937ad2` ("real 404 error pages for MPA static sites") and no longer exists. No action is needed for it.

**The 3 open bug documents** - all are upstream (AWS CDK / SvelteKit / `kit-on-lambda`) or live-infrastructure issues, none are a design flaw in our packages' public APIs. Each file has a single-line status of the form `## Status: <value>`:

| Bug                     | File                                                                        | Current status                                       | Nature                                                       | 1.0 resolution                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| service-auth BUG-001    | `packages/service-auth/docs/bugs/001-edge-function-cross-region-race.md`    | `Open (workaround: deploy twice with --no-rollback)` | AWS CDK `experimental.EdgeFunction` cross-region deploy race | Accept as a documented known-issue. Does not affect the public API. Confirm the workaround note is current; set status to `Accepted (known limitation - upstream AWS CDK experimental.EdgeFunction)`.                                    |
| dmarc-dashboard BUG-001 | `packages/dmarc-dashboard/docs/bugs/001-sveltekit-typescript7-types.md`     | `Open (version locked to TypeScript 6)`              | SvelteKit type-gen incompatible with TypeScript 7            | Accept as a documented known-issue. The TS pin (`~6.0.3` in `packages/dmarc-dashboard/package.json`) is the resolution for now; set status to `Accepted (version-locked to TypeScript 6 - upstream SvelteKit/TS7)`.                      |
| dmarc-dashboard BUG-002 | `packages/dmarc-dashboard/docs/bugs/002-cloudfront-module-import-failed.md` | `Open (investigation not started)`                   | CloudFront/S3 asset-serving via `kit-on-lambda`              | Does NOT block 1.0 (deployment issue, not an API issue). Decision point for the owner: either (a) leave as an open known-issue and proceed, or (b) run the documented manual investigation first. Default: leave open, proceed with 1.0. |

### Package inventory and 1.0 suitability review

There are 21 publishable packages on `0.x` and 2 already past 1.0 (`lambda-fetch-api` 2.1.3, `lambda-keep-active` 2.1.14). `samples` is private and excluded.

**Original 15 (owner decision: all go to 1.0.0 together):** `action-tokens`, `cdk-constructs`, `cdk-email-alarms`, `dmarc-consumer`, `dmarc-dashboard`, `dmarc-parser`, `dmarc-reports`, `helpers`, `helpers-dynamo`, `hmac`, `lint-config`, `service-auth`, `service-email`, `service-email-dashboard`, `sqs-handler`.

**6 packages missing from the first draft, reviewed for suitability.** Evidence: version/CHANGELOG history, public surface, tests, ADRs, open todos, recent churn.

| Package                          | Version | Tests | ADRs | Public surface                                                                                                                     | Verdict                       | Notes                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ------- | ----- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ip-info`                        | 0.3.1   | 1     | 1    | Small: `IpInfoCache`, `IpInfo`, cache record helpers                                                                               | **Ready**                     | Small, focused, no todos. Re-exported wholesale by `analytics-processor` (`export * from "@beesolve/ip-info"`), so it must be promoted together with it.                                                                                                                                                                                                                                   |
| `lambda-function-url-protection` | 0.2.1   | 1     | 2    | Small: `protectedFunctionUrlOrigin`, `ProtectedFunctionUrlOriginProps`, runtime `protectFetch`/`protectHandler`                    | **Ready**                     | Last behavior change (opt-in enforcement, ADR-002) is settled and documented. `package.json` has `description: null`; add a one-line description as part of Task 6 (metadata only, no API change).                                                                                                                                                                                         |
| `analytics-dashboard`            | 0.8.3   | 2     | 2    | Only `./cdk` is exported; the app itself is consumed as a deployed construct                                                       | **Ready**                     | 23 releases, mostly patch/dependency updates. Depends on `auth-service`, `analytics-processor` and `lambda-keep-active`; promote with them.                                                                                                                                                                                                                                                |
| `analytics-processor`            | 0.10.0  | 23    | 10   | Large: `index.ts` is `export *` of 16 modules, plus `./cdk` and `./sdk`. The DynamoDB key schema is a persisted contract (ADR-002) | **Ready after export audit**  | Best-tested of the six. Risks: (1) `export *` freezes every internal helper at 1.0; (2) 0.10.0 only just changed the key namespaces (three-tier totals). Task 7 audits the `export *` surface and the key schema before promotion. ADR-008 (scheduled v2 compaction) is `Proposed - deferred`; that is a feature decision, not a blocker, but update its status to `Deferred` for clarity. |
| `aws-env-loader`                 | 0.7.1   | 9     | 7    | Library (`.`, `./cdk`) plus a CLI that requires Bun                                                                                | **Ready, with a known limit** | Renamed (breaking) at 0.7.0 on the same day as the latest release, so the rename has had little soak time, but the API itself is unchanged. The macOS-only secure cache is an accepted decision (ADR-007); adding Linux/Windows backends later is a `minor`, so it is not a blocker. Keep the macOS note in the README when the banner is removed.                                         |
| `helpers-dsql` (`dsql-helpers`)  | 0.1.0   | 2     | 2    | CDK construct (`DsqlCluster`), access reconciler, Drizzle factory, admin entry point; four entry points with optional peers        | **Defer (stays 0.x)**         | First release is 0.1.0 and has had no soak: one CHANGELOG entry, no follow-up fixes, 2 test files for ~1200 lines. It peer-depends on `@aws/aurora-dsql-drizzle` and `drizzle-orm`, both young upstream APIs. Promoting it would freeze an unproven surface. Re-evaluate after real use.                                                                                                   |

**Decision recorded by this plan:** 5 of the 6 are promoted; `dsql-helpers` is deferred. To promote it as well, add `@beesolve/dsql-helpers` to Task 6 and Task 8, remove its exclusion in Task 9, and change the counts from 20 to 21.

### Packages bumped to 1.0.0 (20)

The original 15 plus `ip-info`, `lambda-function-url-protection`, `analytics-dashboard`, `analytics-processor`, `aws-env-loader`.

Npm names (names differ from directory names; always read `package.json` `name` before writing a changeset):

| Directory                        | npm name                                   |
| -------------------------------- | ------------------------------------------ |
| `action-tokens`                  | `@beesolve/action-tokens`                  |
| `analytics-dashboard`            | `@beesolve/analytics-dashboard`            |
| `analytics-processor`            | `@beesolve/analytics-processor`            |
| `aws-env-loader`                 | `@beesolve/aws-env-loader`                 |
| `cdk-constructs`                 | `@beesolve/cdk-constructs`                 |
| `cdk-email-alarms`               | `@beesolve/cdk-email-alarms`               |
| `dmarc-consumer`                 | `@beesolve/dmarc-consumer`                 |
| `dmarc-dashboard`                | `@beesolve/dmarc-dashboard`                |
| `dmarc-parser`                   | `@beesolve/dmarc-parser`                   |
| `dmarc-reports`                  | `@beesolve/dmarc-reports`                  |
| `helpers`                        | `@beesolve/helpers`                        |
| `helpers-dynamo`                 | `@beesolve/dynamo-helpers`                 |
| `hmac`                           | `@beesolve/hmac`                           |
| `ip-info`                        | `@beesolve/ip-info`                        |
| `lambda-function-url-protection` | `@beesolve/lambda-function-url-protection` |
| `lint-config`                    | `@beesolve/lint-config`                    |
| `service-auth`                   | `@beesolve/auth-service`                   |
| `service-email`                  | `@beesolve/email-service`                  |
| `service-email-dashboard`        | `@beesolve/email-service-dashboard`        |
| `sqs-handler`                    | `@beesolve/sqs-handler`                    |

NOT bumped:

- Already >= 1.0: `lambda-fetch-api`, `lambda-keep-active`.
- Deferred, stays `0.x` and keeps its README banner: `helpers-dsql` (`@beesolve/dsql-helpers`).
- Private: `samples`.

### Key Design Decisions

- **No new features.** Todo #4 (pagination) is resolved by removing the dead placeholder, not by building the feature. This keeps the 1.0 surface honest - we do not freeze half-built APIs.
- **Hardening is allowed.** Todo #3 (Valibot validation at a storage boundary) is hardening of existing behavior and aligns with the repo's "validate external input at boundaries" rule, so it is in scope.
- **Bugs are not 1.0 blockers.** All 3 open bugs are upstream or infra issues outside our packages' public API contracts. The 1.0 action is to formalize them as accepted known-issues, not to fix upstream software.
- **Banner removal ships with the major changeset.** The `versioning` convention requires removing the pre-1.0 README banner in the same change that cuts 1.0.0, so Task 6 and Task 8 land together.
- **1.0.0 via a single `major` changeset per package.** Changesets drives the version bump and CHANGELOG. No internal package lists another `@beesolve/*` package in `peerDependencies`, so a major bump does not cascade into unwanted major bumps of dependents (`updateInternalDependencies` is `patch`, so dependents get a patch bump, which `lambda-fetch-api` and `lambda-keep-active` may receive).
- **Deferral over inclusion for unproven packages.** A package with no soak time (`dsql-helpers`) stays `0.x`. Promotion is cheap later; a premature 1.0 costs a major bump on every correction.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check` (tsc per workspace package)
3. `bun test` (builds, then runs tests across all packages)

**Rules for subagents:**

- Each task must be self-contained
- No commits - leave changes uncommitted for review
- Follow the project's code style (see `.kiro/steering/`)
- If check gates fail on unrelated existing issues, note them but don't fix
- No new features - if a todo describes an unbuilt feature, remove the placeholder rather than implementing it
- Run `bun install` only if dependencies change (none expected in this plan)

**Operational notes:**

- Build tool is bunup - `bun run build` builds all packages
- Package names differ from directory names - always read `package.json` before creating changesets
- There is a known pre-existing format failure in `.kiro/plans/dmarc-dashboard-improvements.md` unrelated to this work. `bun run check` will report it on every run. Treat it as the expected baseline: a gate run is clean when that file is the ONLY format failure. Do not fix it, and do not let `bun run fmt` reformat it (revert it if the formatter touches it)
- Run `bun run fmt` to realign markdown tables if `bun run check` reports format issues in files you edited, then re-verify
- Use hyphens, never em dashes, in anything you write
- Todo search command (zsh-safe, recursive): `grep -rniE "//\s*todo" packages --include='*.ts' --include='*.svelte' --exclude-dir=node_modules --exclude-dir=dist`

## Tasks

### Task 1: Clean up the passkey ternary (todo #1)

Resolve the readability todo in `packages/service-auth/src/handlers/passkeyAuthOptions.ts` around line 34.

- [x] Read the function containing `// todo: get rid of ternary here` and the surrounding `allowCredentials` assignment
- [x] Extract a small helper (internal, not exported) that returns `[]` early when `userId == null`, otherwise maps `accounts.getPasskeysByUserId(userId)` to the `{ id, type, transports }` shape. Preserve exact behavior
- [x] Remove the `// todo:` comment
- [x] Confirm no public API or behavior change - this is purely internal readability

**Files:** `packages/service-auth/src/handlers/passkeyAuthOptions.ts`

**Acceptance criteria:**

- The `// todo: get rid of ternary here` comment is gone
- Behavior is unchanged (same `allowCredentials` result for the same inputs)
- `bun run check`, `bun run type-check`, and `bun test` pass

---

### Task 2: Add attachment ArrayBuffer test and remove todo (todo #2)

Resolve the missing-test todo in `packages/service-email/src/handler.ts` around line 116 (`// todo: test this properly`), which covers converting a `transformToByteArray()` result into a correctly-sliced `ArrayBuffer`.

- [x] Read the attachment-handling block in `packages/service-email/src/handler.ts` to understand the `byteArray.buffer.slice(byteOffset, byteOffset + byteLength)` logic
- [x] Extract the slice into a small pure helper (internal, not exported from the package barrel) so it can be unit tested. Keep the slice semantics; do not replace it with a different conversion
- [x] Add a focused test under `packages/service-email/tests/` asserting the ArrayBuffer slice returns the exact bytes for a `Uint8Array` with a non-zero `byteOffset` (a view into a larger buffer) and for a zero-offset case
- [x] Remove the `// todo: test this properly` comment

**Files:** `packages/service-email/src/handler.ts`, `packages/service-email/tests/<new-or-existing>.test.ts`

**Acceptance criteria:**

- A test exists that would fail if the offset/length slice were wrong
- The `// todo: test this properly` comment is gone
- No change to the package's public API
- `bun run check`, `bun run type-check`, and `bun test` pass

---

### Task 3: Validate dashboard message upsert input with Valibot (todo #3)

Resolve the input-validation todo in `packages/service-email-dashboard/src/lib/server/messages.ts` around line 175.

- [x] Read the `upsert` method, the six event types in its `data` union (`RequestEvent`, `SendEvent`, `DeliveryEvent`, `BounceEvent`, `ComplaintEvent`, `RejectEvent`), and the existing fixtures in `packages/service-email-dashboard/tests/messages.test.ts`
- [x] Define a Valibot schema matching what `upsert` already accepts and persists. Follow repo Valibot conventions: `v.picklist` with an `as const` array for string-literal unions, `v.union` only for different types. Where practical derive the TypeScript types from the schema (`v.InferOutput`) so schema and types cannot drift; do not change the exported type shapes
- [x] Parse the input with the schema at the start of `upsert`; throw a plain `Error` with a descriptive message on invalid input
- [x] Keep the existing recipient checks (`> 48`, `=== 0`) and their exact error messages, so existing tests keep passing
- [x] Do NOT add new fields or new behavior
- [x] Remove the `// todo:` comment
- [x] Add tests (extend `messages.test.ts`) covering: valid input of each status passes, and at least one malformed input is rejected before any write

**Files:** `packages/service-email-dashboard/src/lib/server/messages.ts`, `packages/service-email-dashboard/tests/messages.test.ts`

**Acceptance criteria:**

- `upsert` rejects malformed input with a descriptive error before writing
- The `// todo:` comment is gone
- Existing tests pass unmodified apart from additions; a test covers both the accept and reject paths
- `bun run check`, `bun run type-check`, and `bun test` pass

---

### Task 4: Remove the speculative pagination todo (todo #4, no new features)

Remove the todo that describes an unbuilt feature. Do NOT implement it - the 1.0 goal is an honest, settled surface.

- [x] `packages/service-email-dashboard/src/lib/server/messages.ts` ~line 416: remove the `// todo: here we could create algorithm ...` comment
- [x] Record the limitation in the package docs (README or a how-to under `packages/service-email-dashboard/docs/how-to/`) as a one-line "Known limitation: message listing paginates within a single month partition", not as a code comment
- [x] Confirm no exported type or method signature changes

**Files:** `packages/service-email-dashboard/src/lib/server/messages.ts`, a doc file in `packages/service-email-dashboard/`

**Acceptance criteria:**

- The todo comment is gone
- No change to any exported type or signature
- The limitation is captured in docs
- `bun run check`, `bun run type-check`, and `bun test` pass

---

### Task 5: Formalize the 3 open bugs as accepted known-issues

Update the status of the 3 bug docs to reflect the 1.0 decision. These are upstream/infra issues, not API blockers. Each file's status is a single line `## Status: <value>`; replace the value only.

- [x] `packages/service-auth/docs/bugs/001-edge-function-cross-region-race.md`: set the line to `## Status: Accepted (known limitation - upstream AWS CDK experimental.EdgeFunction)`. Verify the "deploy twice with --no-rollback" workaround is still accurate. Keep the "when to retry" monitoring section
- [x] `packages/dmarc-dashboard/docs/bugs/001-sveltekit-typescript7-types.md`: set the line to `## Status: Accepted (version-locked to TypeScript 6 - upstream SvelteKit/TS7)`. Verify the TS6 pin (`"typescript": "~6.0.3"`) is still in `packages/dmarc-dashboard/package.json`
- [x] `packages/dmarc-dashboard/docs/bugs/002-cloudfront-module-import-failed.md`: add a short note under the status stating it does not affect the published package API and is not a 1.0 blocker. Leave the status `Open (investigation not started)` (owner decides separately whether to investigate). Do NOT make speculative CDK changes
- [x] Docs-only edits; no code changes

**Files:** the 3 bug markdown files listed above

**Acceptance criteria:**

- All 3 bug docs have an explicit, current status reflecting the 1.0 decision
- No code changes in this task
- `bun run check` shows no new failures (run `bun run fmt` then revert the unrelated `.kiro/plans/dmarc-dashboard-improvements.md` if touched)

---

### Task 6: Pre-promotion fixes for the newly added packages

Small, no-feature fixes found during the suitability review.

- [x] `packages/lambda-function-url-protection/package.json`: replace `"description": null` with a one-line description (for example "Fail-closed origin-token protection for a Lambda Function URL behind CloudFront"). Metadata only
- [x] `packages/analytics-processor/docs/adr-008-scheduled-v2-compaction-deferred.md`: change `## Status` from `Proposed - deferred, not built` to `Deferred` (keep the body). Follow the ADR format in `.kiro/steering`
- [x] Confirm each of the 20 promoted packages has `docs/adr-001-motivation.md` (ADR convention). Report any missing; do not invent content without asking

**Files:** `packages/lambda-function-url-protection/package.json`, `packages/analytics-processor/docs/adr-008-scheduled-v2-compaction-deferred.md`

**Acceptance criteria:**

- `description` is a non-empty string
- ADR-008 status reads `Deferred`
- Every promoted package has ADR-001, or the gap is reported
- `bun run check`, `bun run type-check`, and `bun test` pass

---

### Task 6b: Write missing motivation ADRs

Task 6 found 6 promoted packages without `docs/adr-001-motivation.md`, which the ADR convention requires. Docs only.

- [x] `helpers`, `lint-config`, `cdk-email-alarms`, `dmarc-parser`: create `docs/adr-001-motivation.md`
- [x] `cdk-constructs` and `dmarc-reports`: `adr-001-*` is already taken by a different ADR, so create the motivation ADR with the next free number (`adr-002-motivation.md`) and do not renumber existing ADRs
- [x] Draft each from the package's README, `package.json` and source, following the ADR format in `.kiro/steering` (Status, Context, Decision, Rationale, Consequences, Alternatives Considered). Answer: what problem the package solves, why it is a standalone package, and what its boundaries are. Do not invent history; state only what the code and docs support
- [x] Hyphens only, no em dashes

**Files:** 6 new files under `packages/{helpers,lint-config,cdk-email-alarms,dmarc-parser,cdk-constructs,dmarc-reports}/docs/`

**Acceptance criteria:**

- All 20 promoted packages have a motivation ADR
- `bun run check` shows no new failures

---

### Task 7: Audit the `analytics-processor` public surface before freezing it

`packages/analytics-processor/index.ts` re-exports 16 modules with `export *` plus `@beesolve/ip-info`, and the DynamoDB key schema is a persisted contract. Freezing everything at 1.0 would freeze internals. This task is an audit, not a feature.

- [ ] List every symbol exported from `index.ts`, `sdk.ts` and `cdk.ts`, and for each, whether it is used outside the package (other packages in the workspace, samples, `analytics-dashboard`)
- [ ] Report symbols that are only internal helpers. Do NOT narrow or remove exports unless the user approves the specific list after reviewing the report, because narrowing is itself a breaking change (acceptable now, at 0.x)
- [ ] Confirm the key schema documented in ADR-002 matches `src/keys.ts` and the `all`/`real`/`watch` namespaces from 0.10.0
- [ ] If the user approves narrowing, apply it and update `DOCS.md` / how-tos accordingly (`sync-package-docs` skill)

**Files:** read-only by default; `packages/analytics-processor/index.ts` and docs only if the user approves narrowing

**Acceptance criteria:**

- A report of exported symbols with usage exists and the user has decided what to keep
- ADR-002 and `keys.ts` agree
- `bun run check`, `bun run type-check`, and `bun test` pass

---

### Task 8: Remove stability banners and create 1.0.0 changesets for all 20 packages

Per the `versioning` convention, the banner is removed in the same change that cuts 1.0.0.

**Banner removal:**

- [ ] For each of the 20 promoted packages, remove the `> [!WARNING]` block that starts with `**Pre-1.0` (the em dash and hyphen variants both exist, for example `aws-env-loader` uses a hyphen) from `packages/<dir>/README.md`
- [ ] Keep any other notes in the README (for example the `aws-env-loader` macOS-only and "Using Linux or Windows?" notes)
- [ ] Leave `dsql-helpers`, `lambda-fetch-api` and `lambda-keep-active` READMEs untouched
- [ ] Search each promoted package's `DOCS.md` and `docs/how-to/` for pre-1.0 / `0.x` wording that is now stale. Known hit: `packages/cdk-constructs/docs/how-to/migrate-v1-to-v2-logging.md:120` says "Because the library is 0.x and internal-only"; reword so it stays true (for example "Because the library had a single internal consumer")

**Changesets:**

- [ ] For each of the 20 packages, read its `package.json` `name` field (use the table above)
- [ ] Create one or more files under `.changeset/` marking each of the 20 packages as `major`. A single file may list all 20, or group them; every package needs a `major` entry
- [ ] Changeset summary: "Promote to 1.0.0. The API is considered stable; from this release on, breaking changes require a major version bump." Adjust per-package wording only if a package needs a specific note (for example `aws-env-loader` can note that secure caching remains macOS-only)
- [ ] Do NOT include `lambda-fetch-api`, `lambda-keep-active`, `dsql-helpers` or `samples`
- [ ] Do NOT run `bunx changeset version` - only create the changeset files
- [ ] Verify the frontmatter uses the correct npm names (for example `"@beesolve/auth-service": major`, not `service-auth`)

**Files:** 20 `packages/*/README.md`, a few docs files, new `.changeset/*.md`

**Acceptance criteria:**

- No `Pre-1.0` banner remains in any of the 20 promoted READMEs; it remains in `dsql-helpers`
- A changeset exists marking all 20 packages as `major`, with correct npm names
- The 4 excluded packages are not in any changeset
- `bunx changeset status` (if available) shows the 20 packages slated for a major bump, and lists any dependent patch bumps
- `bun run check` shows no new failures

---

### Task 9: Final verification pass

Confirm the repo is clean and ready for the 1.0 release.

- [ ] The todo search command (see Operational notes) returns no matches in non-sample package source
- [ ] All 3 bug docs have an updated status
- [ ] The changeset(s) list exactly the 20 target packages as `major`; `dsql-helpers`, `lambda-fetch-api`, `lambda-keep-active` and `samples` are absent
- [ ] `grep -rln "Pre-1.0" packages/*/README.md` lists only `dsql-helpers`
- [ ] `bun run check` (only the known baseline failure), `bun run type-check`, and `bun test` pass
- [ ] `bun run build` succeeds for all packages
- [ ] Report a summary: todos resolved, bugs formalized, banners removed, packages queued for 1.0.0, packages deliberately not promoted

**Files:** none created - verification only

**Acceptance criteria:**

- No `// todo:` remains in non-sample package source
- All check gates and the build pass
- The 1.0.0 changeset set is complete and correct

---

## Future Work (out of scope)

- **Implement multi-month pagination** in the email dashboard message listing (todo #4) - a real feature, deferred.
- **Promote `dsql-helpers`** once it has soaked in real use and has broader test coverage.
- **Linux/Windows secure-cache backends** for `aws-env-loader` (ADR-007) - a `minor` after 1.0.
- **Scheduled v2 compaction** for `analytics-processor` (ADR-008) - a real feature, deferred.
- **Investigate dmarc-dashboard BUG-002** (CloudFront `/_app/*` asset serving) - requires live-infra investigation; not an API concern.
- **Upstream fixes** for the CDK EdgeFunction race and SvelteKit/TS7 incompatibility - track upstream, retest per each bug doc's "when to retry" section.
- **CI guard** that fails if a package introduces a breaking change without a major bump (for example an API-diff check). Worth considering now that packages are at 1.0.
