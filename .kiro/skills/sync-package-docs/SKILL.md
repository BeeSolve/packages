---
name: sync-package-docs
description: Keep each package's agentic documentation (DOCS.md + docs/how-to/ guides) in sync with the code. Use when adding a new package, changing a package's public API (exports, construct props, error types), adding or renaming a sample, or whenever you touch a package and want its published docs to stay accurate. Internal to the @beesolve/packages monorepo.
---

## Overview

This is the `@beesolve/packages` binding for the generic `agentic-package-docs` skill. The method, the non-negotiable rules, the DOCS.md / how-to templates, and the sync procedure all live in that user-level skill - **read and follow it.** This file only supplies the concrete values for THIS repo. Where the two overlap, these repo-specific values win.

Convention of record (what gets published, templates, tiering): `.kiro/plans/agentic-friendly-npm-docs.md`.

## Repo-Specific Bindings

Substitute these into the generic skill's placeholders:

- **Scope:** `@beesolve`
- **Repo URL / branch:** `https://github.com/BeeSolve/packages`, branch `main`. Mind the org casing: `BeeSolve`.
- **Install command:** `bun add` (primary); mention `npm install` as an alternative.
- **Layout:** monorepo, packages under `packages/<dir>`. Examples live under `packages/samples/` (a `private: true`, non-published package).
- **Package path in links:** `<repo-url>/tree/main/packages/<dir-name>`. The URL path uses the DIRECTORY name, not the npm name.
- **Dir-name vs npm-name differences** (always read `package.json` `name` to confirm):
  - `service-auth` -> `@beesolve/auth-service`
  - `service-email` -> `@beesolve/email-service`
  - `service-email-dashboard` -> `@beesolve/email-service-dashboard`
  - `helpers-dynamo` -> `@beesolve/dynamo-helpers`
  - all others: `@beesolve/<dir-name>`
- **Publish mechanism:** the `files` array in each `package.json` (no `.npmignore` in this repo).
  - User-facing packages: `"files"` includes `"dist"`, `"docs/how-to"`, `"DOCS.md"`.
  - Internal plumbing packages (`helpers`, `helpers-dynamo`, `lint-config`): `"files"` includes `"DOCS.md"` but NOT `"docs/how-to"`. `lint-config` keeps its custom list (`oxfmt.json`, `presets`, `plugins`, `scripts`) and appends `"DOCS.md"`.
  - ADRs (`docs/adr-*.md`) and bug notes (`docs/bugs/`) stay unpublished. Never add the whole `"docs"` folder to `files`.
- **Internal design docs to keep OUT of the tarball:** `docs/adr-*.md`, `docs/bugs/*`, `docs/*-design.md`, `docs/plans/*`.
- **Further Reading ADR link:** include `[Architecture Decision Records](<repo-url>/tree/main/packages/<dir-name>/docs) (GitHub only)` only when the package actually has a `docs/` folder with ADRs; omit otherwise.

## Verification Gates (this repo)

Run after any docs change:

```bash
bun run check        # oxfmt + oxlint (run `bun run fmt` first if markdown tables need realignment)
bun run type-check
bun test

# tarball check for a specific package
cd packages/<dir> && bun pm pack --dry-run && cd -
```

The pack output must include `DOCS.md` (and `docs/how-to/*.md` for user-facing packages) and must NOT include any `docs/adr-*.md` or `docs/bugs/*`.

Known pre-existing format failure unrelated to docs work: `.kiro/plans/dmarc-dashboard-improvements.md`. Do not fix it, and revert it if `bun run fmt` reformats it.

## Repo-Wide Audit (this repo's globs)

```bash
grep -rl "Coming soon" packages/*/DOCS.md                                           # expect nothing
for f in packages/*/DOCS.md; do grep -L "Keywords:" "$f"; done                      # expect nothing
for f in packages/*/DOCS.md; do grep -L "matches the installed version" "$f"; done  # expect nothing
ls packages/*/DOCS.md                                                               # every publishable package has one
```

Sample-to-package mapping check:

```bash
grep -rl '@beesolve/<name>' packages/samples/*/   # confirm a sample uses the package before linking it
```

## Interaction With Other Repo Workflows

- **New packages:** the `add-package` skill scaffolds the docs stubs and the `files` entries. This skill fills in real content.
- **Changesets:** a docs change is a `patch`. Package names differ from directory names - always read `package.json` `name` before writing a changeset (see the mappings above).
- **Steering:** repo steering (`.kiro/steering/`) outranks this skill if they ever conflict.

## Scope Note

Internal tooling for `@beesolve/packages`. Not published to npm, not referenced from any package README.
