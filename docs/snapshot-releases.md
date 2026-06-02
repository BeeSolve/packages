# Snapshot (beta) releases

Publish a throwaway pre-release to test a package before merging. No permanent version bump or CHANGELOG edits.

## Steps

1. Version with `--snapshot`:

```bash
bunx changeset version --snapshot beta
```

This sets affected packages to `0.0.0-beta-<timestamp>`.

2. Build and publish manually with the `beta` dist-tag:

```bash
# Build dist/ (JS + .d.ts) from the workspace root
bun run build

# Build Lambda zips and publish
cd packages/<name>
bun run prepublishOnly
bun pm pack
npm publish *.tgz --access public --tag beta
rm *.tgz
```

> **Note**: `bun run build` (bunup) must run from the repo root before `prepublishOnly`. The `prepublishOnly` script only bundles Lambda zips — it does not generate the `dist/*.js` and `dist/*.d.ts` files that consumers import. In CI, the publish workflow runs `bun run build` before publishing.

3. Install in your consumer:

```bash
bun add @beesolve/<name>@beta
```

## Cleanup

After testing, discard the snapshot version bump:

```bash
git checkout -- .
```

The `beta` dist-tag on npm can be left as-is — it won't affect consumers using the default `latest` tag.
