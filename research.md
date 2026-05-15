# npm Publishing Automation — Research

## Current State

### Package Inventory

| Package | Version | Internal Dependencies |
|---|---|---|
| `@beesolve/helpers` | 0.1.4 | none |
| `@beesolve/cdk-email-alarms` | 0.1.3 | none |
| `@beesolve/cdk-constructs` | 0.1.28 | helpers |
| `@beesolve/lambda-fetch-api` | 0.1.6 | helpers |
| `@beesolve/email-service` | 0.1.19 | helpers, cdk-constructs |
| `@beesolve/sqs-handler` | 0.1.20 | helpers, cdk-email-alarms, cdk-constructs |

### Topological Publish Order

Packages must be published in dependency order so that a newly published version of a dependency
is available on npm before its dependents are published.

```
Tier 1 (no internal deps):   helpers, cdk-email-alarms
Tier 2 (depend on tier 1):   cdk-constructs, lambda-fetch-api
Tier 3 (depend on tier 2):   email-service, sqs-handler
```

### What Exists Today

- No CI/CD, no GitHub Actions, no git tags, no changelogs.
- Publishing is entirely manual: `bun publish --access public` from each package directory.
- `workspace:^` dependency references are automatically rewritten to actual version numbers by
  `bun publish` at publish time — no manual replacement needed.

### Special Case: `service-email`

This package has a `prepublishOnly` lifecycle hook:

```json
"prepublishOnly": "bun run --bun build.ts && cd handler && zip -r ../dist/handler.zip *"
```

It esbuild-compiles a Lambda handler and packages it as a zip before publishing. `bun publish`
runs this hook automatically, so no special CI orchestration is needed — it runs as part of
the normal publish step. The Ubuntu GitHub Actions runner includes `zip` pre-installed, and
`esbuild` is a devDependency already installed by `bun install`.

---

## Chosen Approach: Changesets + GitHub Actions + npm OIDC Trusted Publishers

### Versioning: Changesets

[Changesets](https://github.com/changesets/changesets) is the de facto standard for monorepo
versioning. The workflow:

```
1. Developer makes changes and opens a PR
2. Developer runs: bunx changeset
   → Describes the change (patch / minor / major) and which packages are affected
   → Commits the generated .changeset/random-name.md file with the PR

3. Changesets bot sees the new .changeset file and creates (or updates) a "Version PR"
   → Bumps versions of all affected packages
   → Bumps dependents automatically (e.g. if helpers bumps, cdk-constructs bumps too)
   → Generates CHANGELOG.md entries

4. Team reviews and merges the Version PR to main

5. Push to main triggers the publish GitHub Actions workflow
   → Packages whose version changed vs the npm registry are published in topological order
```

**bun compatibility**: Changesets works with bun. Use `bunx changeset` to add changesets.
The version-bumping step (`changeset version`) is run by the CI bot. For publishing, we
call `bun publish --access public` directly (rather than `changeset publish`, which calls
`npm publish` internally).

**Dependency cascade**: Changesets handles the bumping cascade automatically. When you bump
`@beesolve/helpers` from `0.1.4` to `0.1.5`, Changesets bumps every package that lists
`helpers` as a dependency to at minimum a patch version.

---

### npm Auth: OIDC Trusted Publishers (secretless)

npmjs.org supports **Trusted Publishers** (generally available since July 31, 2025). This is
true secretless OIDC publishing — no `NPM_TOKEN` needs to be stored as a GitHub secret.

**How it works** (analogous to AWS OIDC role assumption):

1. Register a trust relationship on npmjs.org per package: "trust the workflow
   `.github/workflows/publish.yml` from the GitHub repo `beesolve/packages`"
2. In GitHub Actions, the workflow requests an OIDC token from GitHub's identity provider
   (via `id-token: write` permission)
3. npm CLI v11.5.1+ detects the OIDC environment automatically, exchanges the short-lived
   GitHub OIDC token for short-lived npm publish credentials, and publishes
4. No long-lived secrets are stored anywhere

**Requirements:**
- Node.js 22.14.0+ (ships npm CLI v11.5.1+)
- `id-token: write` permission in the GitHub Actions workflow
- Trust relationship registered on npmjs.org per package (one-time setup)
- Each package must already exist on npm (first publish must be done manually — see bootstrap
  section below)
- `repository` field in each `package.json` must exactly match the GitHub repo URL

**One-time setup per package on npmjs.org:**
1. Navigate to `https://www.npmjs.com/package/@beesolve/<name>/access`
2. Click "Add Trusted Publisher" → select GitHub Actions
3. Enter: organization = `beesolve`, repository = `packages`, workflow file = `publish.yml`

**Critical**: Do NOT set `NODE_AUTH_TOKEN` (or `NPM_TOKEN`) in the workflow. If the env var is
present (even as empty string), npm uses it instead of OIDC, breaking secretless auth.

---

### GitHub Actions Workflows

Two workflows are needed.

#### `ci.yml` — runs on every PR

Validates that the code builds and type-checks cleanly before merge.

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run build
      - run: bun run type-check
```

#### `publish.yml` — runs on push to main

Uses `changesets/action` which handles two cases automatically:
- **Pending changesets exist** (normal PR merged): creates or updates the Version PR
- **Version PR just merged** (no pending changesets, versions already bumped): runs the
  `publish` script to publish changed packages

```yaml
name: Publish

on:
  push:
    branches: [main]

permissions:
  contents: write        # changesets commits version bumps and changelogs
  id-token: write        # npm OIDC trusted publishing
  pull-requests: write   # changesets bot creates/updates the Version PR

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0           # changesets needs full git history
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'

      - uses: oven-sh/setup-bun@v2

      - run: bun install

      - name: Version or Publish
        uses: changesets/action@v1
        with:
          version: bunx changeset version
          publish: bun run publish:packages
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # NO NPM_TOKEN — OIDC handles authentication
```

The `publish:packages` script in root `package.json` would rebuild all packages and then
publish each one in topological order, skipping any package whose current version is already
on the npm registry.

---

### Required Changes to Repository

**Root `package.json`** — add `@changesets/cli` and new scripts:
```json
{
  "devDependencies": {
    "@changesets/cli": "^2.x"
  },
  "scripts": {
    "build": "bunup",
    "dev": "bunup --watch",
    "type-check": "bun run --filter '*' type-check",
    "publish:packages": "bun run build && node --experimental-strip-types scripts/publish.ts"
  }
}
```

**`.changeset/config.json`** — generated by `bunx changeset init`:
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

**`scripts/publish.ts`** — small script to publish in topological order, checking the npm
registry to skip already-published versions:
```typescript
// Publish packages in topological order, skipping versions already on npm
const packages = [
  "packages/helpers",
  "packages/cdk-email-alarms",
  "packages/cdk-constructs",
  "packages/lambda-fetch-api",
  "packages/service-email",
  "packages/sqs-handler",
];

for (const pkg of packages) {
  // read version from package.json, check npm registry, publish if needed
}
```

---

### Bootstrap (One-Time Manual Steps)

Before automation works, each package must be published to npm at least once manually so that:
- The package exists on npmjs.org (required to register OIDC trust)
- The npm Trusted Publisher relationship can be established

Steps:
1. `cd packages/<name> && bun publish --access public` — repeat for all 6 packages in
   topological order
2. Register Trusted Publishers on npmjs.org for each package (see setup above)
3. Create the GitHub Actions workflows

---

## Open Questions

1. **Are all 6 packages already published on npm?** If any are new/unpublished, they need a
   manual first publish before OIDC trust can be registered.

2. **Does `bun publish` support npm OIDC Trusted Publishers natively?** The secretless flow
   requires npm CLI v11.5.1+ to perform the OIDC token exchange. If `bun publish` doesn't yet
   support this, the publish step in CI would use `npm publish --access public` (via the Node 22
   npm CLI set up by `actions/setup-node`) instead of `bun publish`. Both produce identical
   results — the difference is which CLI performs the token exchange.

3. **`service-email` handler assets**: Does `packages/service-email/build.ts` reference any
   files outside the `service-email` package directory? If so, CI needs to check out the full
   repo (it does via `actions/checkout`) and those paths need to be valid in the CI environment.

4. **Monorepo root vs package-level publish**: Should the Changesets config use `access: "public"`
   globally (all packages published as public), or should individual packages override this?
   All current packages appear to be public scoped packages, so global `public` should be fine.
