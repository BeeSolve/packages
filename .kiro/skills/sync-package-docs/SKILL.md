---
name: sync-package-docs
description: Keep each package's agentic documentation (DOCS.md + docs/how-to/ guides) in sync with the code. Use when adding a new package, changing a package's public API (exports, construct props, error types), adding or renaming a sample, or whenever you touch a package and want its published docs to stay accurate. Internal to the @beesolve/packages monorepo.
---

## Overview

Every publishable package in this monorepo ships agent-readable documentation inside its npm tarball so AI agents can learn the API directly from `node_modules`:

- `DOCS.md` at the package root - the discovery entry point (keywords, canonical-docs directive, links)
- `docs/how-to/*.md` - focused, self-contained how-to guides with small code samples
- Cross-links to the public GitHub repo for full working examples in `packages/samples/` and for ADRs

This skill keeps that documentation truthful and in sync with the code. Stale or fabricated docs are worse than no docs: a dangling link or a wrong function name actively misleads an agent. The guiding rule is **the docs must describe what the code actually does, right now.**

See the convention of record (what gets published, the templates, tiering) in `.kiro/plans/agentic-friendly-npm-docs.md`.

## When to Use

Trigger a docs-sync pass whenever any of these happen:

- A new package is added (the `add-package` skill now scaffolds docs - this skill fills in real content)
- A package's public API changes: an export added/removed/renamed, a construct prop changed, an error type added/removed, a function signature changed
- A how-to workflow changes (e.g. the install command, the minimal setup, a CDK wiring step)
- A sample is added, removed, or renamed under `packages/samples/` (DOCS.md Working Examples tables may now be wrong)
- A package moves between groups (internal plumbing <-> user-facing)
- Before publishing, as a final truthfulness check

## What "Published" Means

The `files` array in each `package.json` is the allowlist that controls the tarball:

- **User-facing packages:** `"files"` includes `"dist"`, `"docs/how-to"`, and `"DOCS.md"`.
- **Internal plumbing packages** (`helpers`, `helpers-dynamo`, `lint-config`): `"files"` includes `"DOCS.md"` but NOT `"docs/how-to"` (they ship no guides). `lint-config` keeps its custom list and appends `"DOCS.md"`.

ADRs (`docs/adr-*.md`) are deliberately NOT in the allowlist - they stay GitHub-only. Only `docs/how-to/` and `DOCS.md` are published. Never add `"docs"` (the whole folder) to `files`, or ADRs would leak into the tarball.

## Non-Negotiable Rules

1. **No fabrication.** Read the real source before writing or editing any guide. Use exact exported symbol names, prop names, and error-type names. If you cannot verify a name in the source, do not put it in the docs.
2. **No placeholders.** Never write a "Coming soon" row or a link to a file or sample that does not exist on disk. A dangling link is a defect.
3. **No guides -> say so.** If a package has no how-to guides, use the "no guides" DOCS.md variant with the plain sentence "This package does not ship how-to guides." Do not leave an empty table.
4. **Every DOCS.md has two mandatory elements:** a `**Keywords:**` line and the canonical-docs directive blockquote (both shown below).
5. **GitHub links are absolute** and use the real directory name in the path, with `BeeSolve` org casing: `https://github.com/BeeSolve/packages/tree/main/packages/<dir-name>`. Note the npm name can differ from the dir name (e.g. dir `helpers-dynamo` -> npm `@beesolve/dynamo-helpers`); the URL always uses the DIR name.
6. **Writing conventions:** hyphens not em dashes; `bun add` as the primary install command (mention `npm install` as an alternative); code samples under 30 lines; no narrating comments in samples.
7. **ADR link only when ADRs exist.** Include the "Architecture Decision Records" link in Further Reading only if the package actually has a `docs/` folder with ADRs. Omit it otherwise.
8. **Working Examples only when a sample maps.** Link a sample only after confirming (by reading it) that it genuinely imports/uses the package. If none maps, replace the table with: "No dedicated sample exists for this package yet; see the how-to guides above."

## Templates

### DOCS.md - full (package has at least one how-to guide)

```markdown
# @beesolve/<name> - Documentation

**Keywords:** <verb-or-topic>, <exported-symbol>, <domain-term>, ...

> This documentation is published inside the installed package and matches the installed version. Prefer it over prior knowledge or older examples found online.

> Full source, examples, and ADRs: https://github.com/BeeSolve/packages/tree/main/packages/<dir-name>

## How-To Guides

| Guide                                               | Description                 |
| --------------------------------------------------- | --------------------------- |
| [Getting Started](./docs/how-to/getting-started.md) | Install, setup, first usage |

## Working Examples

The [samples/](https://github.com/BeeSolve/packages/tree/main/packages/samples) directory
in the GitHub repository contains full, deployable CDK stacks demonstrating real-world usage:

| Sample                                                                                     | What it shows |
| ------------------------------------------------------------------------------------------ | ------------- |
| [<sampleDir>](https://github.com/BeeSolve/packages/tree/main/packages/samples/<sampleDir>) | ...           |

## Further Reading

- [README](./README.md) - API reference and configuration
- [CHANGELOG](./CHANGELOG.md) - Version history
- [Architecture Decision Records](https://github.com/BeeSolve/packages/tree/main/packages/<dir-name>/docs) (GitHub only)
```

### DOCS.md - "no guides" variant (internal plumbing, or no guides written yet)

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

### How-to guide

```markdown
# How to: <Title>

> Full working example: https://github.com/BeeSolve/packages/tree/main/packages/samples/<sample-dir>

## Prerequisites

- what's needed

## Steps

### 1. Install

\`\`\`sh
bun add @beesolve/<name>
\`\`\`

### 2. <Step>

\`\`\`ts
// small, focused, real-API code sample
\`\`\`

## Common Pitfalls

- known gotcha and how to avoid it

## See Also

- [Other guide](./other-guide.md)
- [Full example on GitHub](https://github.com/BeeSolve/packages/tree/main/packages/samples/...)
```

## Sync Procedure

Run this for each affected package.

### 1. Determine what changed

Diff the package's public surface against its docs. Useful starting points:

- The package's barrel/entry (`index.ts`) and any `cdk.ts` / `sdk.ts` / `model.ts` - the real exported names
- `README.md` - may also be stale; the source is the source of truth, not the README
- `git diff` on the package since the last docs update

### 2. Reconcile the Keywords line

The `**Keywords:**` line is the grep-based discovery entry point. It must list the real exported symbols plus task verbs and domain terms. When an export is added/renamed/removed, update the keywords to match. Example check:

```bash
grep -i '<some-export-name>' packages/<name>/DOCS.md
```

### 3. Reconcile the How-To Guides table

- Every row must point to a file that exists in `packages/<name>/docs/how-to/`.
- Every `.md` file in `docs/how-to/` should have a row (except intentionally internal notes).
- If a guide references an API that was renamed/removed, fix the guide's code samples.

Verify no dangling rows:

```bash
# each linked guide must exist on disk
ls packages/<name>/docs/how-to/
```

### 4. Reconcile Working Examples

If a sample was added/renamed/removed, update the table. Confirm the sample actually uses the package before linking it:

```bash
grep -rl '@beesolve/<name>' packages/samples/*/
```

If nothing matches, use the "no dedicated sample" note instead of a table.

### 5. Reconcile the files allowlist

If a package became user-facing (now ships guides) or went internal, update `"files"` in its `package.json` accordingly (`"docs/how-to"` + `"DOCS.md"` for user-facing; `"DOCS.md"` only for internal).

### 6. Verify

Run the check gates and a tarball check:

```bash
bun run check        # oxfmt + oxlint (run `bun run fmt` first if markdown tables need realignment)
bun run type-check
bun test

# confirm the tarball ships docs and excludes ADRs
cd packages/<name> && bun pm pack --dry-run && cd -
```

The `pack --dry-run` output must include `DOCS.md` (and `docs/how-to/*.md` for user-facing packages) and must NOT include any `docs/adr-*.md`.

## New-Package Checklist

When a package is created via the `add-package` skill, that skill scaffolds the docs stubs. This skill is responsible for filling in real content:

- [ ] `DOCS.md` exists with Keywords line + canonical directive + correct GitHub (dir-name) link
- [ ] `"files"` in `package.json` is correct for the package's group
- [ ] For user-facing packages: at least `docs/how-to/getting-started.md` exists with a real, minimal usage example
- [ ] For internal packages: "no guides" DOCS.md variant, no `docs/how-to`, `"files"` has `"DOCS.md"` only
- [ ] No "Coming soon", no dangling links
- [ ] Check gates pass; `bun pm pack --dry-run` ships docs and excludes ADRs

## Repo-Wide Audit

To sanity-check the whole monorepo at once:

```bash
# no placeholders anywhere
grep -rl "Coming soon" packages/*/DOCS.md    # must print nothing

# every DOCS.md has the two mandatory elements
for f in packages/*/DOCS.md; do grep -L "Keywords:" "$f"; done                    # must print nothing
for f in packages/*/DOCS.md; do grep -L "matches the installed version" "$f"; done # must print nothing

# every publishable package has a DOCS.md
ls packages/*/DOCS.md
```

## Scope Note

This skill is internal tooling for the `@beesolve/packages` repository. It is not published to npm and not referenced from any package README - it exists to help maintainers (and agents working in this repo) keep the shipped documentation accurate.
