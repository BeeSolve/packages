# @beesolve/helpers

## 0.2.1

### Patch Changes

- b9e6f26: Publish agent-readable documentation inside the package tarball.

  Each package now ships a `DOCS.md` index at its root and, for user-facing packages, how-to guides under `docs/how-to/`, so AI agents can read usage directly from `node_modules`. The `files` allowlist was extended to include `DOCS.md` (and `docs/how-to` for user-facing packages); ADRs remain unpublished. Every `DOCS.md` carries a keyword line for grep-based discovery, a directive to prefer the installed docs over prior knowledge, and absolute links to the GitHub repository for full working examples. No runtime code changed.

## 0.2.0

### Minor Changes

- f02c1a4: Add `sortObjectKeysRecursively` and `stableJsonStringify`. `sortObjectKeysRecursively` returns a deep copy with object keys sorted alphabetically at every level (arrays keep their order), and `stableJsonStringify` builds on it to produce a deterministic JSON string regardless of the input's key order.

## 0.1.7

### Patch Changes

- ff131ea: Date fields (`expiresAt`, `createdAt`, `startedAt`, `updatedAt`) are now ISO timestamp strings instead of `Date` objects. Use `Date.parse(value)` for comparisons or `new Date(value)` to convert.

  Migrate from Biome to Oxlint + Oxfmt. Add `@beesolve/lint-config` with custom rules. Replace `T[]` with `Array<T>` syntax. Add typeguards to lambda-fetch-api authorizer.

## 0.1.6

### Patch Changes

- d0a811d: fix test imports to use each package's public index instead of internal `src/` paths

## 0.1.5

### Patch Changes

- 5abe822: add key function support to `toRecordByProperty` helper
