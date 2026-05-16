# BeeSolve packages

## Adding a new package

```bash
bun run add-package <name>
```

See [docs/adding-a-package.md](docs/adding-a-package.md) for the full guide including first publish and OIDC setup.

## Development

```bash
bun run build        # build all packages
bun run type-check   # type-check all packages
```

## Making changes

Before opening a PR, create a changeset describing the version bump:

```bash
bunx changeset
```

Select the affected packages, choose `patch` / `minor` / `major`, write a short summary. Commit the generated `.changeset/<name>.md` file with your PR.

After the PR merges to `main`, the Changesets bot opens a "Version Packages" PR that bumps versions and writes CHANGELOG entries. Merging that PR triggers `publish.yml`, which publishes all changed packages automatically.

## Publishing manually

```bash
bun run publish:packages
```

This builds all packages and publishes any version not yet on npm, in topological order derived from `dependencies.json`.

## Dependency order

`dependencies.json` records the topological publish order. Regenerate it after adding or removing `@beesolve/*` dependencies between packages:

```bash
bun run recalculate-dependencies
```
