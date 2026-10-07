# Adding a New Publishable Package

## 1. Scaffold the package

Run the add-package command with the short package name (lowercase kebab-case, without the `@beesolve/` prefix):

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

## 2. Add your code and dependencies

Edit `packages/<name>/index.ts` to export your public API.

If the package depends on other `@beesolve/*` packages in this repo, add them to `package.json` using `workspace:^` references:

```json
"dependencies": {
  "@beesolve/helpers": "workspace:^"
}
```

Then run:

```bash
bun install
bun run recalculate-dependencies
```

`recalculate-dependencies` re-derives the topological publish order from all `package.json` files and updates `dependencies.json`. Run it any time you add or remove intra-monorepo dependencies.

Use `catalog:` references for shared external dependencies rather than pinning versions directly:

```json
"dependencies": {
  "some-shared-dep": "catalog:"
}
```

## 3. Verify the build config

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

If your package has multiple entry points or needs custom build options (e.g. `inferTypes`, additional entry files), update this entry manually.

## 4. Add documentation

Published packages ship a small amount of agent-friendly documentation inside the npm tarball so AI coding agents can discover usage directly from `node_modules`.

### Create `DOCS.md` at the package root

`DOCS.md` is the agent entry point. npm auto-includes root markdown files, so an agent scanning `node_modules/@beesolve/<name>/` sees it immediately alongside `README.md`.

Two elements are mandatory:

1. A `**Keywords:**` line directly under the title - a single grep-friendly line of comma-separated keywords (task verbs, exported symbol names, domain terms).
2. A canonical-docs directive blockquote telling agents to trust the installed documentation over prior knowledge, because it is version-locked to the installed package.

If the package has at least one how-to guide, use the full template:

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

| Sample                                                                                             | What it shows |
| -------------------------------------------------------------------------------------------------- | ------------- |
| [authEmailSimple](https://github.com/BeeSolve/packages/tree/main/packages/samples/authEmailSimple) | ...           |

## Further Reading

- [README](./README.md) - API reference and configuration
- [CHANGELOG](./CHANGELOG.md) - Version history
- [Architecture Decision Records](https://github.com/BeeSolve/packages/tree/main/packages/<dir-name>/docs) (GitHub only)
```

For internal plumbing packages that ship no how-to guides, use the "no guides" variant: keep the title, `**Keywords:**` line, canonical-docs directive, and GitHub link, then state that the package ships no guides and point to the README. Omit the How-To Guides and Working Examples tables entirely.

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

Never write a "Coming soon" row or link to a guide or sample that does not exist. A dangling link tells an agent content exists when it does not, which is worse than no link. List only guides and samples that are actually on disk. When a package has how-to guides but no sample maps to it, keep the How-To Guides table and replace the Working Examples table with a single sentence: "No dedicated sample exists for this package yet; see the how-to guides above."

### Create the minimum how-to guide

For user-facing packages, create `docs/how-to/getting-started.md` covering install, minimal setup, and a first call. Keep code samples small (under 30 lines) and link to a full working example on GitHub where one exists. Internal plumbing packages skip this - they ship `DOCS.md` only.

### Add documentation to the `files` allowlist

Add `"docs/how-to"` and `"DOCS.md"` to the `files` array in `package.json` so they ship in the tarball:

```json
"files": ["dist", "docs/how-to", "DOCS.md"]
```

For internal plumbing packages that ship no guides, add only `"DOCS.md"` (omit `"docs/how-to"`).

### Link relevant samples

If a sample in [`packages/samples/`](../packages/samples) demonstrates the package, link it from `DOCS.md` (Working Examples) and from the relevant how-to guides. Use absolute GitHub URLs - agents have `node_modules` locally but not the git checkout.

### ADRs are not published

ADRs (`docs/adr-*.md`) are internal maintainer documentation and are **not** published. Only `docs/how-to/` is in the files allowlist, so ADRs stay out of the npm tarball. See the [ADR convention](../.kiro/steering/adrs.md) for where ADRs live.

## 5. Add the package to the root README

Add a row for the new package to the **Packages** table in the root [`README.md`](../README.md).
The link target is the package directory (which may differ from the `@beesolve/<name>`
scope — e.g. `@beesolve/dynamo-helpers` lives in `packages/helpers-dynamo`).

## 6. Publish a 0.0.0 placeholder and register the OIDC Trusted Publisher

OIDC trust can only be registered after the package exists on npm. For a brand-new package
that is not ready for a real release, publish a minimal `0.0.0` placeholder to reserve the
`@beesolve/<name>` name and unblock OIDC configuration — do **not** do a first manual _real_
publish.

Follow the `publish-placeholder-package` skill (`.kiro/skills/publish-placeholder-package/SKILL.md`),
which publishes a minimal `0.0.0` placeholder from a temp directory, then registers the GitHub
Actions Trusted Publisher (`npm trust github @beesolve/<name> --repo BeeSolve/packages --file
publish.yml --yes`, with the npmjs.org web UI as a fallback).

The scaffold initializes the package's `package.json` at `0.1.0`, but the name is first
reserved on npm by publishing a separate `0.0.0` placeholder — the `0.1.0` version is published
later through the normal changeset release.

This is a one-time bootstrap. Once the placeholder exists and trust is registered, the first
real release happens through the normal changesets flow (see below).

## 7. Developer workflow — making changes

### Running tests

Run the suite per package — each package's tests run in their own `bun test`
process:

```bash
bun run test              # whole workspace: builds, then one process per package
cd packages/<name> && bun test   # a single package
```

Do **not** run a bare `bun test` from the repo root. It runs every package in
one shared process, which leaks module mocks across packages and produces
spurious failures that don't reproduce per package. See
[ADR-003](./adr-003-per-package-test-isolation.md).

### Changesets

When you change a package, add a changeset describing the bump type before opening a PR:

```bash
bunx changeset
```

Select the affected packages, choose `patch` / `minor` / `major`, write a short summary.
Commit the generated `.changeset/<random-name>.md` file with your PR.

After the PR is merged to `main`, the Changesets bot will open a "Version Packages" PR
that bumps all affected versions and writes CHANGELOG entries. Merging that PR triggers
the `publish.yml` workflow which publishes the changed packages automatically.
