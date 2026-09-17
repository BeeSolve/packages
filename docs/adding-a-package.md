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

## 4. Add the package to the root README

Add a row for the new package to the **Packages** table in the root [`README.md`](../README.md).
The link target is the package directory (which may differ from the `@beesolve/<name>`
scope — e.g. `@beesolve/dynamo-helpers` lives in `packages/helpers-dynamo`).

## 5. Register OIDC Trusted Publisher on npmjs.org

The package must exist on npm before you can register a Trusted Publisher.
Do the first publish manually (see step 6), then:

1. Go to `https://www.npmjs.com/package/@beesolve/<name>/access`
2. Click **Add Trusted Publisher → GitHub Actions**
3. Enter:
   - Organization: `BeeSolve`
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
