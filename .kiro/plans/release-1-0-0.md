# Release 1.0.0 - Stabilize and Clean Up

## Status: Not Started

## Problem Statement

All `@beesolve/*` packages are currently on `0.x` versions, a deliberate choice made during rapid development when breaking changes were frequent and acceptable. The APIs are now considered stable, and the owner is the only consumer, so promoting every package to `1.0.0` is low-risk. From `1.0.0` onward the contract changes: no breaking changes without a major-version bump.

Before cutting `1.0.0`, we want to clean up outstanding loose ends - but **without adding any new features**. Specifically:

1. Resolve or formally accept the 5 `// todo:` markers in the codebase.
2. Resolve or formally accept the 3 open bug documents.
3. Bump every published package to `1.0.0` via changesets.

This plan does NOT add features. Where a `// todo:` describes an unbuilt feature, the resolution is to remove the dead placeholder (so we are not freezing a half-built surface at 1.0), not to build it. Where a bug is an upstream/infrastructure limitation outside our packages' public API, the resolution is to formalize it as an accepted known-issue, not to chase an upstream fix as a 1.0 blocker.

## Architecture / Approach

### Inventory of outstanding work

**The 5 `// todo:` markers** (from `grep -rn "todo"` across `packages/**/*.ts`, excluding samples):

| #   | Location                                                          | Current comment                                                                                    | Nature                                                   | 1.0 resolution                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/service-auth/src/handlers/passkeyAuthOptions.ts:34`     | `// todo: get rid of ternary here`                                                                 | Trivial readability cleanup                              | Refactor the ternary to an early-return / clearer form; remove the comment. No behavior change.                                                                                                               |
| 2   | `packages/service-email/src/handler.ts:116`                       | `// todo: test this properly`                                                                      | Missing test coverage for attachment ArrayBuffer slicing | Add a focused unit test for the `transformToByteArray` -> `ArrayBuffer` slice logic; remove the comment. No API change.                                                                                       |
| 3   | `packages/service-email-dashboard/src/lib/server/messages.ts:175` | `// todo: we need to verify all the inserted data before we insert them (through valibot schemas)` | Input-validation hardening at a storage boundary         | Validate the `upsert` input with a Valibot schema before writing (steering requires validating external input at boundaries). This is hardening of existing behavior, not a new feature. Remove the comment.  |
| 4   | `packages/service-email-dashboard/src/lib/server/messages.ts:416` | `// todo: here we could create algorithm which will go through multiple "months" in PK ...`        | A speculative pagination enhancement (new feature)       | Do NOT implement (it is a feature). Remove the speculative comment and, if the limitation is worth recording, capture it in the package's docs as a known limitation / future-work note.                      |
| 5   | `packages/cdk-constructs/src/staticWebsite.ts:62`                 | `// todo: add errors if multipage application` + commented-out `// readonly errors: string[]`      | An unbuilt construct prop (new feature)                  | Do NOT implement (it is a feature, and it would freeze a new prop at 1.0). Remove the dead comment and the commented-out prop line. If worth recording, note the limitation in the construct's how-to/README. |

**The 3 open bug documents** - all are upstream (AWS CDK / SvelteKit / `kit-on-lambda`) or live-infrastructure issues, none are a design flaw in our packages' public APIs:

| Bug                     | File                                                                        | Status                          | Nature                                                       | 1.0 resolution                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| service-auth BUG-001    | `packages/service-auth/docs/bugs/001-edge-function-cross-region-race.md`    | Open, workaround documented     | AWS CDK `experimental.EdgeFunction` cross-region deploy race | Accept as a documented known-issue. Does not affect the public API. Confirm the workaround note is current; set status to "Accepted (known limitation, upstream CDK)".                                                                   |
| dmarc-dashboard BUG-001 | `packages/dmarc-dashboard/docs/bugs/001-sveltekit-typescript7-types.md`     | Open, TS pinned to 6            | SvelteKit type-gen incompatible with TypeScript 7            | Accept as a documented known-issue. The TS pin is the resolution for now; set status to "Accepted (version-locked, upstream SvelteKit)".                                                                                                 |
| dmarc-dashboard BUG-002 | `packages/dmarc-dashboard/docs/bugs/002-cloudfront-module-import-failed.md` | Open, investigation not started | CloudFront/S3 asset-serving via `kit-on-lambda`              | Does NOT block 1.0 (deployment issue, not an API issue). Decision point for the owner: either (a) leave as an open known-issue and proceed, or (b) run the documented manual investigation first. Default: leave open, proceed with 1.0. |

### Decision: tier handling is dropped

The earlier analysis suggested promoting only "stable leaf" packages. The owner has decided all packages go to `1.0.0` together since they are the sole consumer. Packages already past 1.0 (`lambda-fetch-api` at `2.1.1`, `lambda-keep-active` at `2.1.5`) are left as-is and are not bumped by this plan.

### Packages bumped to 1.0.0 (15)

All publishable `0.x` packages:

`action-tokens`, `cdk-constructs`, `cdk-email-alarms`, `dmarc-consumer`, `dmarc-dashboard`, `dmarc-parser`, `dmarc-reports`, `helpers`, `helpers-dynamo`, `hmac`, `lint-config`, `service-auth`, `service-email`, `service-email-dashboard`, `sqs-handler`.

NOT bumped (already >= 1.0): `lambda-fetch-api`, `lambda-keep-active`.

### Key Design Decisions

- **No new features.** Todos that describe unbuilt features (#4 pagination, #5 construct `errors` prop) are resolved by removing the dead placeholder, not by building the feature. This keeps the 1.0 surface honest - we do not freeze half-built APIs.
- **Hardening is allowed.** Todo #3 (Valibot validation at a storage boundary) is hardening of existing behavior and aligns with the repo's "validate external input at boundaries" rule, so it is in scope.
- **Bugs are not 1.0 blockers.** All 3 open bugs are upstream or infra issues outside our packages' public API contracts. The 1.0 action is to formalize them as accepted known-issues, not to fix upstream software.
- **1.0.0 via a single `major` changeset per package.** Changesets drives the version bump and CHANGELOG. The commit message / changeset summary should state "Promote to 1.0.0: API considered stable." No code change accompanies the version bump itself.
- **Changeset names use npm names, not dir names.** `service-auth` -> `@beesolve/auth-service`, `service-email` -> `@beesolve/email-service`, `service-email-dashboard` -> `@beesolve/email-service-dashboard`, `helpers-dynamo` -> `@beesolve/dynamo-helpers`. Always read `package.json` `name` before writing a changeset.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check` (tsc per workspace package)
3. `bun test` (tests across all packages)

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
- There is a known pre-existing format failure in `.kiro/plans/dmarc-dashboard-improvements.md` unrelated to this work; do not fix it and do not let `bun run fmt` reformat it (revert it if the formatter touches it)
- Run `bun run fmt` to realign markdown tables if `bun run check` reports format issues, then re-verify

## Tasks

### Task 1: Clean up the passkey ternary (todo #1)

Resolve the readability todo in `packages/service-auth/src/handlers/passkeyAuthOptions.ts` around line 34.

- [ ] Read the function containing `// todo: get rid of ternary here` and the surrounding `allowCredentials` assignment
- [ ] Refactor the ternary into a clearer form (early return or an explicit `if`), preserving exact behavior
- [ ] Remove the `// todo:` comment
- [ ] Confirm no public API or behavior change - this is purely internal readability

**Files:** `packages/service-auth/src/handlers/passkeyAuthOptions.ts`

**Acceptance criteria:**

- The `// todo: get rid of ternary here` comment is gone
- Behavior is unchanged (same `allowCredentials` result for the same inputs)
- `bun run check`, `bun run type-check`, and `bun test` pass

---

### Task 2: Add attachment ArrayBuffer test and remove todo (todo #2)

Resolve the missing-test todo in `packages/service-email/src/handler.ts` around line 116 (`// todo: test this properly`), which covers converting a `transformToByteArray()` result into a correctly-sliced `ArrayBuffer`.

- [ ] Read the attachment-handling block in `packages/service-email/src/handler.ts` to understand the `byteArray.buffer.slice(byteOffset, byteOffset + byteLength)` logic
- [ ] If the slice logic is inlined and hard to test directly, extract it into a small pure helper (internal, not exported) so it can be unit tested - this is a refactor, not an API change
- [ ] Add a focused test under `packages/service-email/tests/` asserting the ArrayBuffer slice returns the exact bytes for a `Uint8Array` with a non-zero `byteOffset` (e.g. a view into a larger buffer) and for a zero-offset case
- [ ] Remove the `// todo: test this properly` comment

**Files:** `packages/service-email/src/handler.ts`, `packages/service-email/tests/<new-or-existing>.test.ts`

**Acceptance criteria:**

- A test exists that would fail if the offset/length slice were wrong
- The `// todo: test this properly` comment is gone
- No change to the package's public API
- `bun run check`, `bun run type-check`, and `bun test` pass

---

### Task 3: Validate dashboard message upsert input with Valibot (todo #3)

Resolve the input-validation todo in `packages/service-email-dashboard/src/lib/server/messages.ts` around line 175 (`// todo: we need to verify all the inserted data before we insert them (through valibot schemas)`).

- [ ] Read the `upsert` method and the shape of the data it writes to DynamoDB
- [ ] Define a Valibot schema matching the record it persists (follow repo Valibot conventions: `v.picklist` with `as const` for string-literal unions, `v.union` only for mixed types)
- [ ] Parse/validate the input with the schema before the write; throw a plain `Error` with a descriptive message on invalid input (per steering)
- [ ] Keep this to validating what `upsert` already writes - do NOT add new fields or new behavior
- [ ] Remove the `// todo:` comment
- [ ] Add a test under the dashboard's `tests/` (or extend an existing one) covering: valid input passes, and at least one malformed input is rejected

**Files:** `packages/service-email-dashboard/src/lib/server/messages.ts`, dashboard `tests/` file

**Acceptance criteria:**

- `upsert` rejects malformed input with a descriptive error before writing
- The `// todo:` comment is gone
- A test covers both the accept and reject paths
- `bun run check`, `bun run type-check`, and `bun test` pass

---

### Task 4: Remove speculative/feature todos (todos #4 and #5, no new features)

Remove the two todos that describe unbuilt features. Do NOT implement the features - the 1.0 goal is an honest, settled surface.

- [ ] `packages/service-email-dashboard/src/lib/server/messages.ts` ~line 416: remove the `// todo: here we could create algorithm ...` speculative pagination comment. If the current single-month pagination limit is worth recording, add a one-line "Known limitation" note to the dashboard's docs (README or a how-to), not a code comment.
- [ ] `packages/cdk-constructs/src/staticWebsite.ts` ~line 62: remove both the `// todo: add errors if multipage application` comment and the commented-out `// readonly errors: string []` prop line. If worth recording, note "multi-page custom error pages are not currently supported" in the cdk-constructs `static-website.md` how-to.
- [ ] Confirm no exported type or construct prop changes as a result (removing a commented-out line must not change the real `StaticWebsiteProps` surface)

**Files:** `packages/service-email-dashboard/src/lib/server/messages.ts`, `packages/cdk-constructs/src/staticWebsite.ts`, optionally `packages/cdk-constructs/docs/how-to/static-website.md` and a dmarc/email dashboard doc

**Acceptance criteria:**

- Both todo comments and the commented-out prop line are gone
- No change to any exported type or construct prop
- Any removed limitation is captured in docs (not a code comment) if deemed worth keeping
- `bun run check`, `bun run type-check`, and `bun test` pass

---

### Task 5: Formalize the 3 open bugs as accepted known-issues

Update the status of the 3 bug docs to reflect the 1.0 decision. These are upstream/infra issues, not API blockers.

- [ ] `packages/service-auth/docs/bugs/001-edge-function-cross-region-race.md`: change `## Status` to `Accepted (known limitation - upstream AWS CDK experimental.EdgeFunction)`. Verify the "deploy twice with --no-rollback" workaround is still accurate. Keep the "when to retry" monitoring section.
- [ ] `packages/dmarc-dashboard/docs/bugs/001-sveltekit-typescript7-types.md`: change `## Status` to `Accepted (version-locked to TypeScript 6 - upstream SvelteKit/TS7)`. Verify the TS6 pin is still in place in the relevant `package.json`.
- [ ] `packages/dmarc-dashboard/docs/bugs/002-cloudfront-module-import-failed.md`: this one is an uninvestigated deployment issue. Add a short note at the top stating it does not affect the published package API and is not a 1.0 blocker. Leave status Open (owner decides separately whether to investigate). Do NOT make speculative CDK changes.
- [ ] These are docs-only edits; no code changes

**Files:** the 3 bug markdown files listed above

**Acceptance criteria:**

- All 3 bug docs have an explicit, current status reflecting the 1.0 decision
- No code changes in this task
- `bun run check` passes (markdown formats cleanly; run `bun run fmt` then revert the unrelated `.kiro/plans/dmarc-dashboard-improvements.md` if touched)

---

### Task 6: Create 1.0.0 changesets for all 15 packages

Create changesets that bump every `0.x` publishable package to `1.0.0`.

- [ ] For each of the 15 packages, read its `package.json` `name` field (names differ from directory names)
- [ ] Create one or more changeset files under `.changeset/` marking each of the 15 packages as a `major` bump. A single changeset file may list all 15 packages, or group them - either is fine as long as every package gets a `major` entry
- [ ] Changeset summary text: "Promote to 1.0.0. The API is considered stable; from this release on, breaking changes require a major version bump." Adjust per-package wording only if a package needs a specific note
- [ ] Do NOT include `lambda-fetch-api` or `lambda-keep-active` (already >= 1.0)
- [ ] Do NOT run `bunx changeset version` (that is done later, on merge, by the Changesets flow) - only create the changeset files
- [ ] Verify the changeset frontmatter uses the correct npm package names (e.g. `"@beesolve/auth-service": major`, not `service-auth`)

**Files:** one or more new files under `.changeset/*.md`

**Acceptance criteria:**

- A changeset exists marking all 15 packages as `major`
- Every entry uses the correct npm name from `package.json`
- `lambda-fetch-api` and `lambda-keep-active` are not included
- `bunx changeset status` (if available) shows the 15 packages slated for a major bump
- `bun run check` passes

---

### Task 7: Final verification pass

Confirm the repo is clean and ready for the 1.0 release.

- [ ] `grep -rn "todo" packages/**/*.ts` (excluding `packages/samples/`) returns no matches in non-sample package source (the 5 todos are resolved)
- [ ] All 3 bug docs have an updated status
- [ ] The changeset(s) list exactly the 15 target packages as `major`
- [ ] `bun run check`, `bun run type-check`, and `bun test` all pass
- [ ] `bun run build` succeeds for all packages
- [ ] Report a summary: todos resolved, bugs formalized, packages queued for 1.0.0

**Files:** none created - verification only

**Acceptance criteria:**

- No `// todo:` remains in non-sample package source
- All check gates and the build pass
- The 1.0.0 changeset set is complete and correct

---

## Future Work (out of scope)

- **Implement multi-month pagination** in the email dashboard message listing (todo #4) - a real feature, deferred.
- **Add multi-page custom error pages** to the `StaticWebsite` construct (todo #5) - a real feature, deferred. Would be a `minor` after 1.0.
- **Investigate dmarc-dashboard BUG-002** (CloudFront `/_app/*` asset serving) - requires live-infra investigation; not an API concern.
- **Upstream fixes** for the CDK EdgeFunction race and SvelteKit/TS7 incompatibility - track upstream, retest per each bug doc's "when to retry" section.
- **CI guard** that fails if a `0.x`->`1.x` package later introduces a breaking change without a major bump (e.g. an API-diff check). Worth considering now that packages are at 1.0.
