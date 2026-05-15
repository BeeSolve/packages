# npm Publishing Automation — Implementation Plan

## Context

This monorepo has 6 published npm packages with a clear dependency graph but zero automation.
Publishing is currently manual (`bun publish --access public` per package). The goal is
Changesets-based versioning with automated publishing on push to main, using GitHub Actions
and npm OIDC Trusted Publishers (secretless — no stored NPM_TOKEN).

**Key constraints:**
- `bun publish` MUST be used (not `npm publish`) because it resolves `workspace:^` and
  `catalog:` references in package.json before publishing.
- `bun publish` does NOT support npm OIDC Trusted Publishers natively.
- Solution: **hybrid** — `bun pm pack` creates the resolved tarball, then `npm publish <tarball>`
  performs the OIDC-authenticated publish via Node 24's npm CLI.
- `bun pm pack` resolves `catalog:` (confirmed by bun docs); `workspace:^` resolution is
  documented by inference — needs one-off verification during implementation (see risk section).
- All 6 packages are already published on npm. No bootstrap publish needed.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `.changeset/config.json` | Create (via `bunx changeset init`, then edit) |
| `package.json` (root) | Modify: add `@changesets/cli`, add `version` + `publish:packages` scripts |
| `scripts/publish.ts` | Create: topological publish script |
| `.github/workflows/ci.yml` | Create |
| `.github/workflows/publish.yml` | Create |
| `docs/adding-a-package.md` | Create: guide for adding new packages |

---

## Step 1 — Initialize Changesets

```bash
bunx changeset init
```

Creates `.changeset/config.json`. Edit to:

```json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

`access: "public"` applies globally — all 6 packages are public scoped.

---

## Step 2 — Update Root `package.json`

Add to `devDependencies`:
```json
"@changesets/cli": "^2.27.0"
```

Add/update `scripts`:
```json
{
  "scripts": {
    "build": "bunup",
    "dev": "bunup --watch",
    "type-check": "bun run --filter '*' type-check",
    "version": "changeset version",
    "publish:packages": "bun run build && bun scripts/publish.ts"
  }
}
```

---

## Step 3 — Create `scripts/publish.ts`

Publishes packages in topological order. For each package:
1. Reads current version from `package.json`
2. Checks npm registry — skips if this version is already published
3. Runs `prepublishOnly` script manually if the package has one (handles `service-email`
   Lambda zip build; `bun pm pack` does not trigger `prepublishOnly`)
4. Runs `bun pm pack` — creates a `.tgz` with resolved `workspace:^`/`catalog:` references
5. Runs `npm publish <tarball> --access public` — npm CLI performs OIDC Trusted Publishers auth
6. Cleans up the tarball

```typescript
#!/usr/bin/env bun
import { $ } from "bun";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");

// Topological order — dependencies before dependents
const PACKAGES = [
  "packages/helpers",
  "packages/cdk-email-alarms",
  "packages/cdk-constructs",
  "packages/lambda-fetch-api",
  "packages/service-email",
  "packages/sqs-handler",
] as const;

type Pkg = { name: string; version: string; scripts?: Record<string, string> };

async function readPkg(dir: string): Promise<Pkg> {
  return Bun.file(join(ROOT, dir, "package.json")).json();
}

async function isPublished(name: string, version: string): Promise<boolean> {
  const result = await $`npm view ${name}@${version} version`.quiet().nothrow();
  return result.exitCode === 0;
}

for (const pkgDir of PACKAGES) {
  const absDir = join(ROOT, pkgDir);
  const pkg = await readPkg(pkgDir);

  if (await isPublished(pkg.name, pkg.version)) {
    console.log(`  skip ${pkg.name}@${pkg.version} (already on npm)`);
    continue;
  }

  console.log(`  publishing ${pkg.name}@${pkg.version}`);

  // Run prepublishOnly manually (bun pm pack does not trigger it)
  if (pkg.scripts?.prepublishOnly) {
    await $`bun run prepublishOnly`.cwd(absDir);
  }

  // Pack with bun — resolves workspace:^ and catalog: references
  await $`bun pm pack`.cwd(absDir);

  // Find the generated tarball
  const [tarball] = [...new Bun.Glob("*.tgz").scanSync(absDir)];
  if (!tarball) throw new Error(`No tarball found in ${pkgDir}`);

  // Publish via npm CLI — triggers OIDC Trusted Publishers
  await $`npm publish ${tarball} --access public`.cwd(absDir);

  await $`rm ${tarball}`.cwd(absDir);
}
```

---

## Step 4 — Create `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: oven-sh/setup-bun@v2

      - run: bun install

      - run: bun run build

      - run: bun run type-check
```

---

## Step 5 — Create `.github/workflows/publish.yml`

`changesets/action` does double duty on each push to main:
- **Pending changesets exist** → creates/updates a Version PR (bumps versions, writes CHANGELOG)
- **Version PR just merged** (no pending changesets) → runs the `publish:packages` script

```yaml
name: Publish

on:
  push:
    branches: [main]

permissions:
  contents: write       # changesets commits version bumps + changelogs
  id-token: write       # npm OIDC Trusted Publishers
  pull-requests: write  # changesets bot creates/updates the Version PR

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
          # DO NOT set NODE_AUTH_TOKEN — its presence breaks OIDC auth

      - uses: oven-sh/setup-bun@v2

      - run: bun install

      - name: Version or Publish
        uses: changesets/action@v1
        with:
          version: bun run version
          publish: bun run publish:packages
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # NO NPM_TOKEN — OIDC Trusted Publishers handles auth
```

**Action versions** (latest as of May 2026):
- `actions/checkout@v6` (v6.0.2)
- `actions/setup-node@v6` (v6.4.0) — Node 24 ships npm CLI v11.5.1+ required for OIDC
- `oven-sh/setup-bun@v2` (v2.2.0)
- `changesets/action@v1` (v1.8.0)

---

## Step 6 — Register OIDC Trusted Publishers on npmjs.org (one-time manual)

For each of the 6 packages:

1. Go to `https://www.npmjs.com/package/@beesolve/<name>/access`
2. Click **Add Trusted Publisher** → GitHub Actions
3. Enter:
   - Organization: `beesolve`
   - Repository: `packages`
   - Workflow file: `publish.yml`

Packages to register: `helpers`, `cdk-email-alarms`, `cdk-constructs`, `lambda-fetch-api`,
`email-service`, `sqs-handler`

---

## Step 7 — Create `docs/adding-a-package.md`

Document the end-to-end workflow for adding a new publishable package:

1. **Create the package directory** under `packages/<name>/` — copy the structure of an
   existing simple package (`helpers` is a good template): `package.json`, `tsconfig.json`
   extending `../../tsconfig.base.json`, `index.ts` entry point
2. **`package.json` fields required**: `name`, `version`, `files: ["dist"]`, `exports`,
   `repository` pointing to `git+https://github.com/beesolve/packages.git`
3. **Add to `bunup.config.ts`** — add a workspace entry with entry point(s)
4. **Add to `scripts/publish.ts`** — insert the new package path in the `PACKAGES` array
   at the correct topological position: after all its `@beesolve/*` dependencies,
   before any packages that depend on it
5. **Register OIDC Trusted Publisher** on npmjs.org (see Step 6 above)
6. **First publish** — OIDC trust registration requires the package to already exist on npm.
   From the package directory, run:
   ```bash
   npm login   # if not already authenticated
   bun pm pack
   npm publish *.tgz --access public
   rm *.tgz
   ```
7. **Developer workflow** — when making changes, run `bunx changeset` in the repo root to
   add a changeset file describing the change; commit it with the PR

---

## Dependency Graph Reference

```
Tier 1 (publish first):   helpers, cdk-email-alarms
Tier 2:                   cdk-constructs, lambda-fetch-api
Tier 3 (publish last):    email-service, sqs-handler
```

Dependency edges:
- `cdk-constructs` → `helpers`
- `lambda-fetch-api` → `helpers`
- `email-service` → `helpers`, `cdk-constructs`
- `sqs-handler` → `helpers`, `cdk-email-alarms`, `cdk-constructs`

**`service-email` special case**: `prepublishOnly` runs
`bun run --bun build.ts && cd handler && zip -r ../dist/handler.zip *`.
`build.ts` imports `esmBuild` from `@beesolve/cdk-constructs` — resolved from the workspace
symlink in CI (safe because `bun install` links all workspace packages before publish runs).
The publish script explicitly runs `prepublishOnly` before `bun pm pack`.

---

## Verification

1. Open a PR, run `bunx changeset`, select the changed packages and bump type, commit the
   `.changeset/*.md` file, merge to main
2. Verify the Changesets bot opens a "Version Packages" PR with version bumps and CHANGELOG
3. Merge the Version PR
4. Watch the `publish.yml` workflow — confirm packages publish in topological order
5. On npmjs.org, verify provenance attestation is visible on the new package versions
6. Confirm no `NPM_TOKEN` secret exists in GitHub repo settings

---

## Risk: `bun pm pack` + `workspace:^` Resolution

`bun publish` is documented to resolve both `catalog:` and `workspace:^`. `bun pm pack` is
documented to resolve `catalog:`; `workspace:^` resolution is implied but not explicitly
confirmed.

**Verify before merging** — after running `bun pm pack` on any package with `workspace:^`
dependencies (`cdk-constructs`, `email-service`, `sqs-handler`), inspect the tarball:

```bash
tar -xOf <name>-<version>.tgz package/package.json | grep -E 'workspace|catalog'
```

If `workspace:^` is still present, fall back to storing an `NPM_TOKEN` as a GitHub secret
and replacing `npm publish <tarball>` with `bun publish --access public` in `publish.ts`.
