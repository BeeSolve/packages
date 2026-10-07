---
inclusion: manual
---

# Skill: Add a New Package

This skill guides you through creating a new publishable package in the @beesolve/packages monorepo.

## Inputs

- **name**: The short package name in lowercase kebab-case, without the `@beesolve/` prefix (e.g. `my-utils`)
- **motivation**: A brief description of why this package needs to exist — what problem it solves and why it's a standalone package

## Steps

### 1. Scaffold the package

Run the scaffolding script:

```bash
bun run add-package <name>
```

This creates `packages/<name>/` with the required files and updates `bunup.config.ts` and `dependencies.json` automatically.

**Created files:**

```
packages/<name>/
  index.ts          # entry point (empty stub — add your exports here)
  tsconfig.json
  package.json
```

### 2. Create the motivation ADR

Every package requires a `docs/adr-001-motivation.md` explaining why it exists. Create it following the ADR convention in #[[file:.kiro/steering/adrs.md]].

The motivation ADR must answer:

- What problem does this package solve?
- Why does it exist as a standalone package rather than inline code?
- What are the boundaries of its responsibility?

### 3. Add code and dependencies

Edit `packages/<name>/index.ts` to export the public API.

For intra-monorepo dependencies, use `workspace:^` references:

```json
"dependencies": {
  "@beesolve/helpers": "workspace:^"
}
```

For shared external dependencies, use `catalog:` references:

```json
"dependencies": {
  "some-shared-dep": "catalog:"
}
```

After adding dependencies, run:

```bash
bun install
bun run recalculate-dependencies
```

`recalculate-dependencies` re-derives the topological publish order from all `package.json` files and updates `dependencies.json`. Run it any time intra-monorepo dependencies change.

### 3b. Add agentic documentation

Every publishable package ships agent-readable docs inside its npm tarball. Create them now and keep them accurate with the `sync-package-docs` skill.

For a **user-facing** package (something external users install directly):

1. Add `"docs/how-to"` and `"DOCS.md"` to the `"files"` array in `package.json` (alongside `"dist"`).
2. Create `DOCS.md` at the package root using the full template from `sync-package-docs`.
3. Create at least `docs/how-to/getting-started.md` with a real, minimal usage example grounded in the package's exports.

For an **internal plumbing** package (consumed mainly by other `@beesolve/*` packages):

1. Add only `"DOCS.md"` to the `"files"` array (no `"docs/how-to"`).
2. Create `DOCS.md` using the "no guides" variant from `sync-package-docs`.

Never add `"docs"` (the whole folder) to `files` - ADRs must stay unpublished. See the `sync-package-docs` skill for the templates and the non-negotiable rules (no placeholders, no fabricated API names, mandatory Keywords line and canonical-docs directive).

### 4. Verify the build config

The scaffold adds a minimal entry to `bunup.config.ts`:

```ts
{
  name: "@beesolve/<name>",
  root: "packages/<name>",
  config: {
    entry: ["index.ts"],
  },
},
```

If the package has multiple entry points or needs custom build options (e.g. `inferTypes`, additional entry files), update this entry manually.

### 5. Publish a 0.0.0 placeholder and register the OIDC Trusted Publisher

OIDC trust can only be registered after the package exists on npm. For a brand-new package not
yet ready for a real release, publish a minimal `0.0.0` placeholder to reserve the
`@beesolve/<name>` name and unblock OIDC configuration — do **not** do a first manual _real_
publish.

Follow the `publish-placeholder-package` skill (`.kiro/skills/publish-placeholder-package/SKILL.md`):
it publishes a minimal `0.0.0` placeholder from a temp directory, polls until the name resolves
on npm, then registers the GitHub Actions Trusted Publisher via
`npm trust github @beesolve/<name> --repo BeeSolve/packages --file publish.yml --yes` (with the
npmjs.org web UI as a fallback). This is a one-time bootstrap; the first real release then goes
through the changesets flow below.

### 6. Update the changeset mapping in steering

Add the new package to the known mappings list in `.kiro/steering/typescript.md` under the **Changesets** section:

```
- `packages/<name>/` -> `@beesolve/<name>`
```

## Ongoing Workflow — Making Changes

When changing a package after initial setup, add a changeset before opening a PR:

```bash
bunx changeset
```

Select the affected packages, choose `patch` / `minor` / `major`, write a short summary. Commit the generated `.changeset/<random-name>.md` file with the PR.

If the change touches the public API (exports, construct props, error types) or a documented workflow, run a docs-sync pass with the `sync-package-docs` skill so the package's `DOCS.md` and `docs/how-to/` guides stay accurate.

After the PR is merged to `main`, the Changesets bot opens a "Version Packages" PR that bumps versions and writes CHANGELOG entries. Merging that PR triggers the `publish.yml` workflow which publishes automatically.
