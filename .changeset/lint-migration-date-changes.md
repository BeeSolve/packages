---
"@beesolve/action-tokens": minor
"@beesolve/service-auth": minor
"@beesolve/lambda-fetch-api": patch
"@beesolve/helpers": patch
---

Date fields (`expiresAt`, `createdAt`, `startedAt`, `updatedAt`) are now ISO timestamp strings instead of `Date` objects. Use `Date.parse(value)` for comparisons or `new Date(value)` to convert.

Migrate from Biome to Oxlint + Oxfmt. Add `@beesolve/lint-config` with custom rules. Replace `T[]` with `Array<T>` syntax. Add typeguards to lambda-fetch-api authorizer.
