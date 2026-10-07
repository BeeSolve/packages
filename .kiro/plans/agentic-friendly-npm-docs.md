# Agentic-Friendly NPM Documentation

## Status: In Progress

## Problem Statement

AI coding agents (Cursor, Copilot, Kiro, etc.) increasingly read package documentation directly from `node_modules` to understand how to use a library. Today, `@beesolve/*` packages publish only `dist/` (compiled JS + `.d.ts`) plus the auto-included `README.md` and `CHANGELOG.md`. The rich how-to guides in `docs/how-to/` and the real-world examples in `packages/samples/` never reach npm consumers.

This plan adds a lightweight `docs/` folder to the packages **we want external users to consume** containing:

1. **How-to guides** - concise, self-contained guides with small inline code samples that agents can read and act on directly from `node_modules`.
2. **GitHub cross-references** - each guide links back to the public repository for full working examples in `packages/samples/` and deeper ADR context.
3. **A `DOCS.md` index** - a single entry point file at the package root that lists all available documentation, making it trivial for agents to discover what's available.

The `docs/` folder already exists in each package for ADRs, but ADRs are internal maintainer documentation and should NOT be published. Only the `how-to/` subfolder (and the root `DOCS.md`) should ship to npm.

## Architecture / Approach

### What gets published

Today each package has `"files": ["dist"]`. After this work:

```json
"files": ["dist", "docs/how-to", "DOCS.md"]
```

This publishes:

- `dist/` - compiled code (unchanged)
- `docs/how-to/*.md` - how-to guides (new)
- `DOCS.md` - documentation index (new)

ADRs (`docs/adr-*.md`), bugs (`docs/bugs/`), and other internal docs stay unpublished because they are not in the allowlist.

### Documentation structure per package

```
packages/<name>/
  DOCS.md                          # index of all docs, links to GitHub
  docs/
    how-to/
      getting-started.md           # install, minimal setup, first call
      <topic>.md                   # one file per how-to topic
    adr-001-motivation.md          # NOT published (not in files allowlist)
    ...
```

### DOCS.md format

Each package gets a `DOCS.md` at its root (auto-included by npm alongside README.md). This is the agent entry point.

**Two mandatory elements derived from the Remix 3 agent-doc approach:**

1. **Keywords line** - a single grep-friendly line of comma-separated keywords (task verbs, exported symbol names, domain terms) right under the title. Remix relies on `grep -i '<term>' node_modules/<pkg>/INDEX.md` for discovery; this line gives an agent the same keyword-search entry point in our per-package `DOCS.md`.
2. **Canonical-docs directive** - a short blockquote telling agents to trust this installed documentation over prior/training knowledge, because it is version-locked to the installed package. This mirrors Remix's "treat the installed documentation as canonical" instruction.

**No placeholders.** Never write a "Coming soon" row or link to a guide/sample that does not exist. A dangling link tells an agent content exists when it does not, which is worse than no link. Only list guides and samples that actually exist on disk. If a package genuinely has no how-to guides, omit the How-To Guides table entirely and replace it with a plain statement (see the "no guides" variant below). Same rule for Working Examples: omit the table and state there is no dedicated sample when none maps to the package.

**Full template (package has at least one how-to guide):**

```markdown
# @beesolve/<name> - Documentation

**Keywords:** <verb-or-topic>, <exported-symbol>, <domain-term>, ...

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source, examples, and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/<dir-name>

## How-To Guides

| Guide                                               | Description                 |
| --------------------------------------------------- | --------------------------- |
| [Getting Started](./docs/how-to/getting-started.md) | Install, setup, first usage |
| [Topic X](./docs/how-to/topic-x.md)                 | Description                 |

## Working Examples

The [samples/](https://github.com/BeeSolve/packages/tree/main/packages/samples) directory
in the GitHub repository contains full, deployable CDK stacks demonstrating real-world usage:

| Sample                                                                                             | What it shows |
| -------------------------------------------------------------------------------------------------- | ------------- |
| [authEmailSimple](https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailSimple) | ...           |

## Further Reading

- [README](./README.md) - API reference and configuration
- [CHANGELOG](./CHANGELOG.md) - Version history
- [Architecture Decision Records](https://github.com/BeeSolve/packages/tree/main/packages/<dir-name>/docs) (GitHub only)
```

**"No guides" variant (package ships no how-to guides - internal plumbing, or a package where none have been written):**

```markdown
# @beesolve/<name> - Documentation

**Keywords:** <exported-symbol>, <domain-term>, ...

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/<dir-name>

This package does not ship how-to guides. See the [README](./README.md) for the API
reference and usage, and the GitHub repository for source and examples.

## Further Reading

- [README](./README.md) - API reference and usage
- [CHANGELOG](./CHANGELOG.md) - Version history
```

When no sample maps to a package but the package does have how-to guides, keep the How-To Guides table and replace the Working Examples table with a single sentence: "No dedicated sample exists for this package yet; see the how-to guides above."

### How-to guide format

Each how-to is a focused, self-contained markdown file:

```markdown
# How to: <Title>

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/<sample-dir>

## Prerequisites

- list what's needed

## Steps

### 1. Install

\`\`\`sh
bun add @beesolve/<name>
\`\`\`

### 2. <Step>

\`\`\`ts
// small, focused code sample
\`\`\`

## Common Pitfalls

- pitfall and how to avoid it

## See Also

- [Other guide](./other-guide.md)
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/...)
```

### Which packages get documentation

The focus is packages **we want external users to consume** - not internal plumbing. The monorepo splits into three groups:

**User-facing packages** - developers deliberately install and use these. These get the full agentic-doc treatment.

**Shared/internal plumbing** - published but primarily consumed by other `@beesolve/*` packages, not something an external user reaches for directly: `@beesolve/helpers`, `@beesolve/dynamo-helpers`, `@beesolve/lint-config`. These get a minimal `DOCS.md` (pointing to README + GitHub) but **no how-to guides** - writing agent guides for internal utilities is wasted effort.

Within the user-facing group, prioritize by complexity and consumer impact:

**Tier 1 - full treatment (DOCS.md + multiple how-to guides + sample links):**

- `service-auth` (`@beesolve/auth-service`) - most complex, most consumers, already has 5 how-to drafts in `docs/how-to/`
- `action-tokens` (`@beesolve/action-tokens`) - widely used building block
- `sqs-handler` (`@beesolve/sqs-handler`) - infrastructure pattern every consumer uses
- `lambda-fetch-api` (`@beesolve/lambda-fetch-api`) - core runtime pattern
- `cdk-constructs` (`@beesolve/cdk-constructs`) - shared CDK construct library

**Tier 2 - DOCS.md + a single getting-started guide:**

- `service-email` (`@beesolve/email-service`) - transactional email service
- `service-email-dashboard` (`@beesolve/email-service-dashboard`) - deployable SvelteKit app
- `dmarc-reports` (`@beesolve/dmarc-reports`) - DMARC ingestion pipeline
- `dmarc-consumer` (`@beesolve/dmarc-consumer`) - DMARC persistence + query model
- `dmarc-parser` (`@beesolve/dmarc-parser`) - standalone DMARC XML parser
- `dmarc-dashboard` (`@beesolve/dmarc-dashboard`) - deployable SvelteKit app
- `lambda-keep-active` (`@beesolve/lambda-keep-active`) - Lambda warm-up construct
- `hmac` (`@beesolve/hmac`) - standalone HMAC signing utility
- `cdk-email-alarms` (`@beesolve/cdk-email-alarms`) - small CDK construct

**Minimal - DOCS.md only (internal plumbing, no how-to):**

- `helpers` (`@beesolve/helpers`) - shared utilities, dep of almost everything
- `helpers-dynamo` (`@beesolve/dynamo-helpers`) - shared DynamoDB helpers
- `lint-config` (`@beesolve/lint-config`) - dev tooling / lint config

### Key Design Decisions

- **DOCS.md at package root, not in docs/**: npm auto-includes root markdown files. An agent scanning `node_modules/@beesolve/action-tokens/` sees `DOCS.md` immediately alongside `README.md`. No need to guess that `docs/` exists.
- **Separate DOCS.md from README.md**: The README is already rich with API reference, props tables, and troubleshooting. DOCS.md serves as a navigation hub specifically for agents and discovery - it links to everything without duplicating content.
- **`docs/how-to/` subfolder, not root `docs/`**: Keeps how-to guides separate from ADRs. The `files` allowlist `"docs/how-to"` publishes only guides, not internal ADRs. This preserves the existing ADR convention without change.
- **GitHub links use absolute URLs**: Agents running locally have `node_modules` but not the git repo. Linking to `https://github.com/BeeSolve/packages/tree/main/...` ensures samples and ADRs are always reachable.
- **service-auth how-to guides already exist**: The `docs/how-to/` folder in service-auth has 5 guides. These need light editing (add GitHub links, standardize format) rather than writing from scratch.
- **No build step for docs**: Markdown files are copied as-is by npm pack. No tooling changes needed.

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
- Use `workspace:^` for intra-monorepo dependencies
- Use `catalog:` for shared external dependencies
- Run `bun install` after adding dependencies
- Run `bun run recalculate-dependencies` after changing intra-monorepo deps

**Documentation writing rules:**

- Keep code samples small (under 30 lines) - just enough to show the pattern
- Every how-to guide must link to a full working example on GitHub where one exists
- Use `bun add` for install commands (not `npm install`) as the primary, but mention npm as an alternative
- No explanatory comments in code samples that restate what the code does
- Each guide must be self-contained - an agent should be able to follow it without reading other files
- **Never write "Coming soon" or link to a file/sample that does not exist.** A dangling link misleads agents. List only real, on-disk guides and samples. If a package has no guides, use the "no guides" DOCS.md variant from the Architecture section.
- **Every `DOCS.md` must include the `**Keywords:**` line and the canonical-docs directive blockquote** from the Architecture section. Keywords are grep targets: real exported symbol names, task verbs, and domain terms for that package.

**Operational notes:**

- Build tool is bunup - `bun run build` builds all packages
- Barrel exports (`index.ts`) are used for package public APIs
- ADRs live in `packages/<name>/docs/` - create one for significant decisions
- Package names differ from directory names - always read `package.json` before creating changesets

## Tasks

### Task 1: Update `files` field and create DOCS.md for all user-facing packages

Update every user-facing package's `package.json` to include documentation in the npm tarball, and create the `DOCS.md` index file.

**User-facing packages (Tier 1 + Tier 2 - 14 packages):**

For each of these 14 packages, do:

1. Add `"docs/how-to"` and `"DOCS.md"` to the `"files"` array in `package.json`.

2. Create a `DOCS.md` file at the package root following the format from the Architecture section. The content must be customized per package:
   - Package name and description from `package.json`
   - `**Keywords:**` line: real exported symbol names, task verbs, and domain terms for grep-based discovery
   - Canonical-docs directive blockquote (verbatim from the Architecture template)
   - GitHub link uses the actual directory name (not the npm scope name). Key mappings: `packages/service-auth` -> `@beesolve/auth-service`, `packages/service-email` -> `@beesolve/email-service`, `packages/service-email-dashboard` -> `@beesolve/email-service-dashboard`, `packages/helpers-dynamo` -> `@beesolve/dynamo-helpers`
   - How-To Guides table: **list only guides that actually exist on disk.** For `service-auth`, list the 5 existing how-to files (cloudfront.md, consuming-events.md, data-token.md, local-development-with-kit-on-lambda.md, waf.md). For every other package (whose guides are written in Tasks 3-7), the guide does not exist yet at Task 1 time, so **use the "no guides" DOCS.md variant** - do NOT write a "Coming soon" row. The content tasks (2-7) will rewrite these DOCS.md files to add the How-To Guides table once the guides exist.
   - Working Examples table: include it only when a real sample maps to the package. Link to relevant sample directories from `packages/samples/` by reading each sample directory's code/README (e.g. `authEmailSimple` relates to `service-auth`, `dmarcReports` relates to `dmarc-reports`/`dmarc-consumer`/`dmarc-dashboard`, `emailVerify` relates to `action-tokens`). If no sample maps, omit the table (do not write "Coming soon").
   - Further Reading section with links to README, CHANGELOG, and GitHub-only ADRs (omit the ADR link if the package has no `docs/` folder)

3. Create an empty `docs/how-to/` directory (with a `.gitkeep` file) for packages that don't have one yet. `service-auth` already has `docs/how-to/` with content - do not modify it in this task.

**Minimal packages (internal plumbing - 3 packages: helpers, helpers-dynamo, lint-config):**

For these 3 packages:

1. Add only `"DOCS.md"` to the `"files"` array (no `docs/how-to` - they won't have guides). For `lint-config`, which has a custom files list (`["oxfmt.json", "presets", "plugins", "scripts"]`), append `"DOCS.md"` to that list.
2. Create a minimal `DOCS.md` using the "no guides" variant: package name, `**Keywords:**` line, canonical-docs directive, GitHub link, the "does not ship how-to guides" sentence, and a Further Reading section pointing to README + GitHub ADRs. No How-To Guides table, no Working Examples table.

**Note on current state:** Task 1 has already been partially executed and produced "Coming soon" placeholder rows in 13 DOCS.md files. Those placeholders violate the no-placeholder rule and must be removed: rewrite each affected DOCS.md to the "no guides" variant (the content tasks will later add real tables). The fix subagent for this task must replace every "Coming soon" row across all `packages/*/DOCS.md`.

**Files:** 17x `packages/*/package.json`, 17x `packages/*/DOCS.md`, 14x `packages/*/docs/how-to/.gitkeep` (where the dir doesn't exist, user-facing packages only)

**Acceptance criteria:**

- No `DOCS.md` contains the string "Coming soon" or any link to a non-existent file
- Every `DOCS.md` contains the `**Keywords:**` line and the canonical-docs directive
- `bun pm pack` in any user-facing package includes `DOCS.md` and `docs/how-to/` in the tarball
- `bun pm pack` in a minimal package includes `DOCS.md` but NOT `docs/how-to/`
- All 17 publishable packages have a `DOCS.md` file
- `bun run check` and `bun run type-check` pass

---

### Task 2: Standardize existing service-auth how-to guides

`packages/service-auth/docs/how-to/` already has 5 guides. Standardize them to the how-to format described in the Architecture section:

1. Read all 5 existing guides: `cloudfront.md`, `consuming-events.md`, `data-token.md`, `local-development-with-kit-on-lambda.md`, `waf.md`
2. For each guide:
   - Add a GitHub cross-reference link at the top pointing to the relevant sample directory (e.g., consuming-events.md links to `packages/samples/authWithEmail` or `authEmailSimple`)
   - Add a "See Also" section at the bottom with links to related guides and GitHub samples
   - Ensure code samples are concise (trim if over 30 lines, keep the essential pattern)
   - Add a "Common Pitfalls" section if the guide covers known gotchas (pull from ADRs where relevant, e.g. ADR-006 for event isolation relates to consuming-events.md)
3. Add a `getting-started.md` guide covering: install, CDK setup (AuthGateway minimal config), SvelteKit integration (createSessionHandle), and first deployment. Keep it under 80 lines. Link to the `authEmailSimple` sample for the full example.
4. Update `packages/service-auth/DOCS.md` (created in Task 1) to list all 6 how-to guides with descriptions.

**Files:** `packages/service-auth/docs/how-to/*.md`, `packages/service-auth/DOCS.md`

**Acceptance criteria:**

- Every how-to file has a GitHub link at the top and a "See Also" section
- `getting-started.md` exists and covers install through first deployment
- `DOCS.md` lists all 6 guides
- `bun run check` passes

---

### Task 3: Write how-to guides for action-tokens

Create how-to guides for `@beesolve/action-tokens`:

1. `docs/how-to/getting-started.md` - Install, CDK construct setup (`ActionTokens` + `grantAccess`), create and validate a first token. Link to the `emailVerify` sample.
2. `docs/how-to/throttling.md` - Using `createNewWithThrottling` to prevent abuse. Show the throttle config, error handling with `TokenThrottledError`, and choosing throttle identity vs. window. Link to how `service-auth` uses this internally.
3. `docs/how-to/error-handling.md` - Handling all error types (`TokenDoesNotExistError`, `ExpiredTokenError`, `TokenAlreadyUsedUpError`, `TokenInvalidError`, `TokenThrottledError`). Show a complete error handling pattern for a `use()` call.
4. Update `packages/action-tokens/DOCS.md` to list the 3 guides.

Reference the existing README for API details - don't duplicate the props table or full API reference. The how-to guides should show _workflows_ (how to wire things together), not repeat the README's reference content.

**Files:** `packages/action-tokens/docs/how-to/getting-started.md`, `packages/action-tokens/docs/how-to/throttling.md`, `packages/action-tokens/docs/how-to/error-handling.md`, `packages/action-tokens/DOCS.md`

**Acceptance criteria:**

- 3 how-to files exist with inline code samples and GitHub links
- `DOCS.md` lists all 3 guides
- `bun run check` passes

---

### Task 4: Write how-to guides for sqs-handler

Create how-to guides for `@beesolve/sqs-handler`:

1. Read `packages/sqs-handler/README.md` and source code to understand the public API
2. `docs/how-to/getting-started.md` - Install, CDK construct setup (`SqsHandler`), write a handler function, wire to EventBridge. Link to relevant samples.
3. `docs/how-to/error-handling-and-dlq.md` - How the DLQ works, partial batch failures, retry behavior, and how to monitor failures.
4. Update `packages/sqs-handler/DOCS.md` to list the guides.

**Files:** `packages/sqs-handler/docs/how-to/getting-started.md`, `packages/sqs-handler/docs/how-to/error-handling-and-dlq.md`, `packages/sqs-handler/DOCS.md`

**Acceptance criteria:**

- 2 how-to files exist with inline code samples and GitHub links
- `DOCS.md` lists the guides
- `bun run check` passes

---

### Task 5: Write how-to guides for lambda-fetch-api

Create how-to guides for `@beesolve/lambda-fetch-api`:

1. Read `packages/lambda-fetch-api/README.md`, source code, and ADRs to understand the Fetch API pattern, AsyncLocalStorage context, and request/response handling
2. `docs/how-to/getting-started.md` - Install, write a handler using the Fetch API pattern, CDK wiring, accessing AWS context (`getAwsContext`). Link to relevant samples.
3. `docs/how-to/sveltekit-integration.md` - Using with SvelteKit via `createSessionHandle` / `createInProcessSessionHandle`. Cover the Vite SSR externals gotcha. Link to dashboard samples.
4. Update `packages/lambda-fetch-api/DOCS.md` to list the guides.

**Files:** `packages/lambda-fetch-api/docs/how-to/getting-started.md`, `packages/lambda-fetch-api/docs/how-to/sveltekit-integration.md`, `packages/lambda-fetch-api/DOCS.md`

**Acceptance criteria:**

- 2 how-to files exist with inline code samples and GitHub links
- SvelteKit guide mentions the Vite SSR externals requirement
- `DOCS.md` lists the guides
- `bun run check` passes

---

### Task 6: Write how-to guides for cdk-constructs

Create how-to guides for `@beesolve/cdk-constructs`:

1. Read `packages/cdk-constructs/README.md` and all source files in `src/` to understand the available constructs (NodejsFunction, SqsWithDlq, StaticWebsite, CloudFrontAccessLogging, EsbuildBuild)
2. `docs/how-to/getting-started.md` - Install, overview of available constructs, basic usage of `NodejsFunction` (the most commonly used). Link to samples that use these constructs.
3. `docs/how-to/static-website.md` - Setting up a static website with CloudFront using the `StaticWebsite` construct. Cover S3 + CloudFront + custom domain if supported.
4. Update `packages/cdk-constructs/DOCS.md` to list the guides.

**Files:** `packages/cdk-constructs/docs/how-to/getting-started.md`, `packages/cdk-constructs/docs/how-to/static-website.md`, `packages/cdk-constructs/DOCS.md`

**Acceptance criteria:**

- 2 how-to files exist with inline code samples and GitHub links
- `DOCS.md` lists the guides
- `bun run check` passes

---

### Task 7: Write getting-started guides for Tier 2 packages

Create a `getting-started.md` for each Tier 2 user-facing package. For each package:

1. Read the README and source to understand the public API
2. Write `docs/how-to/getting-started.md` covering: install, basic setup, minimal usage example, link to GitHub for more
3. Update the package's `DOCS.md` to list the guide

Packages (9 total):

- `packages/service-email` (`@beesolve/email-service`)
- `packages/service-email-dashboard` (`@beesolve/email-service-dashboard`)
- `packages/dmarc-reports` (`@beesolve/dmarc-reports`)
- `packages/dmarc-consumer` (`@beesolve/dmarc-consumer`)
- `packages/dmarc-parser` (`@beesolve/dmarc-parser`)
- `packages/dmarc-dashboard` (`@beesolve/dmarc-dashboard`)
- `packages/lambda-keep-active` (`@beesolve/lambda-keep-active`)
- `packages/hmac` (`@beesolve/hmac`)
- `packages/cdk-email-alarms` (`@beesolve/cdk-email-alarms`)

Each getting-started.md should be 40-80 lines, focused on the minimal path to using the package. Link to the GitHub repo for full examples and ADRs.

**Files:** 9x `packages/*/docs/how-to/getting-started.md`, 9x `packages/*/DOCS.md` (update)

**Acceptance criteria:**

- All 9 packages have a `docs/how-to/getting-started.md`
- All 9 `DOCS.md` files list the guide
- `bun run check` passes

---

### Task 8: Update root README and adding-a-package guide

Update the monorepo-level documentation to include the new documentation convention:

1. **`docs/adding-a-package.md`**: Add a new section (between steps 3 and 4) titled "Add documentation" that covers:
   - Create `DOCS.md` at the package root using the template from this plan
   - Create `docs/how-to/getting-started.md` as the minimum required guide
   - Add `"docs/how-to"` and `"DOCS.md"` to the `files` array in `package.json`
   - Link to relevant samples in `packages/samples/` if applicable
   - Remind that ADRs in `docs/` are NOT published (only `docs/how-to/` is in the files allowlist)

2. **Root `README.md`**: Add a brief note in the Packages table or in a new "Documentation" section explaining that every package ships how-to guides readable from `node_modules` and that the `samples/` directory contains full working examples.

**Files:** `docs/adding-a-package.md`, `README.md`

**Acceptance criteria:**

- `adding-a-package.md` includes the documentation step
- Root README mentions the documentation convention
- `bun run check` passes

---

### Task 9: Verify npm tarball contents

Run `bun pm pack` on 3 representative packages (one from each group) and verify the tarball contains the expected files:

1. `packages/action-tokens` (Tier 1): should contain `dist/`, `DOCS.md`, `docs/how-to/getting-started.md`, `docs/how-to/throttling.md`, `docs/how-to/error-handling.md`, `README.md`, `CHANGELOG.md`, `package.json`
2. `packages/hmac` (Tier 2): should contain `dist/`, `DOCS.md`, `docs/how-to/getting-started.md`, `README.md`, `CHANGELOG.md`, `package.json`
3. `packages/helpers` (minimal/internal): should contain `dist/`, `DOCS.md`, `README.md`, `CHANGELOG.md`, `package.json`, but NO `docs/how-to/` content

For each:

- Run `bun pm pack` to create the tarball
- Run `tar tzf *.tgz` to list contents
- Verify `docs/adr-*.md` files are NOT included (they should be excluded by the files allowlist)
- Verify `docs/how-to/*.md` files ARE included for Tier 1 and Tier 2 packages
- Verify `DOCS.md` is included in all packages
- Clean up the `.tgz` files

If any package is missing expected files or includes ADRs, fix the `files` field and document the correction.

**Files:** None created - verification only

**Acceptance criteria:**

- Tarball for action-tokens includes how-to guides, DOCS.md, excludes ADRs
- Tarball for hmac includes getting-started guide, DOCS.md, excludes ADRs
- Tarball for helpers includes DOCS.md only, excludes ADRs, excludes docs/how-to/
- All `.tgz` files cleaned up

---

## Future Work (out of scope)

- **Automated doc staleness checks**: A CI step that verifies every publishable package has a `DOCS.md` and at least one how-to guide. Could be added as a lint rule or a pre-publish check.
- **Version-stamped GitHub links**: Currently links point to `main` branch. Could use tagged releases for stable linking, but `main` is fine since the repo is public and `main` is always ahead of the published version.
- **Agent-specific metadata**: Some agent frameworks support structured metadata (e.g. `llms.txt`, tool descriptors). Could be explored once a standard emerges.
- **Auto-generated DOCS.md**: A script that reads `package.json` exports, `docs/how-to/` contents, and `samples/` directory to generate `DOCS.md` automatically. Worth doing if the manual approach becomes a maintenance burden.
- **Search/index file**: A `docs/index.json` that maps topics to files for programmatic agent consumption. Markdown is good enough for current agent capabilities.
