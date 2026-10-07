---
"@beesolve/auth-service": patch
---

Fix: depend on the internal `@beesolve/lambda-keep-active` package via `workspace:^` instead of `catalog:`.

`lambda-keep-active` is an intra-monorepo package, so it must be referenced with `workspace:^` like every other internal dependency - the `catalog:` is reserved for shared third-party dependencies. The package was also removed from the workspace catalog, where it did not belong. This resolves a changesets warning and ensures the published dependency range tracks the actual released version of `lambda-keep-active`.
