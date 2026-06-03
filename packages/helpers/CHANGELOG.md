# @beesolve/helpers

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
