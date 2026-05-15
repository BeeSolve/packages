# Adding a New Publishable Package

## 1. Create the package directory

```
packages/<name>/
  index.ts          # entry point
  tsconfig.json
  package.json
```

`tsconfig.json` — extend the base config:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "declaration": true, "isolatedDeclarations": true },
  "include": ["src/**/*", "index.ts"]
}
```

## 2. Required `package.json` fields

Use `packages/helpers/package.json` as a template. The fields below are mandatory for publishing to work correctly.

```json
{
  "name": "@beesolve/<name>",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "files": ["dist"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/beesolve/packages.git"
  },
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    },
    "./package.json": "./package.json"
  },
  "scripts": {
    "type-check": "tsc --noEmit"
  }
}
```

`repository.url` must exactly match `git+https://github.com/beesolve/packages.git` — npm OIDC
Trusted Publishers validates this against the GitHub repo that issues the OIDC token.

Use `catalog:` references for shared dependencies rather than pinning versions directly:

```json
"dependencies": {
  "some-shared-dep": "catalog:"
}
```

## 3. Add to `bunup.config.ts`

Add a workspace entry in topological order (after any `@beesolve/*` deps it imports):

```ts
{
  name: "@beesolve/<name>",
  root: "packages/<name>",
  config: {
    entry: ["index.ts"],
  },
},
```

## 4. Add to `scripts/publish.ts`

Insert the package path into the `PACKAGES` array at the correct topological position —
after all its `@beesolve/*` dependencies, before any packages that depend on it:

```ts
const PACKAGES = [
  "packages/helpers",           // tier 1
  "packages/cdk-email-alarms",  // tier 1
  "packages/<name>",            // insert here if it only depends on tier 1
  "packages/cdk-constructs",    // tier 2
  ...
] as const;
```

## 5. Register OIDC Trusted Publisher on npmjs.org

The package must exist on npm before you can register a Trusted Publisher.
Do the first publish manually (see step 6), then:

1. Go to `https://www.npmjs.com/package/@beesolve/<name>/access`
2. Click **Add Trusted Publisher → GitHub Actions**
3. Enter:
   - Organization: `beesolve`
   - Repository: `packages`
   - Workflow file: `publish.yml`

## 6. First manual publish

OIDC trust can only be registered after the package exists on npm, so the very first
publish must be done manually:

```bash
cd packages/<name>
bun pm pack
npm publish *.tgz --access public
rm *.tgz
```

You must be logged in to npm (`npm whoami`). If not, run `npm login` first.

## 7. Developer workflow — making changes

When you change a package, add a changeset describing the bump type before opening a PR:

```bash
bunx changeset
```

Select the affected packages, choose `patch` / `minor` / `major`, write a short summary.
Commit the generated `.changeset/<random-name>.md` file with your PR.

After the PR is merged to `main`, the Changesets bot will open a "Version Packages" PR
that bumps all affected versions and writes CHANGELOG entries. Merging that PR triggers
the `publish.yml` workflow which publishes the changed packages automatically.
