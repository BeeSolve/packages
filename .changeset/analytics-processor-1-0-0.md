---
"@beesolve/analytics-processor": major
---

Promote to 1.0.0. The API is considered stable; from this release on, breaking changes require a major version bump.

BREAKING: the root entry point now exports an explicit list of names instead of `export *`; internal SQL/key/transaction helpers and the re-export of `@beesolve/ip-info` are no longer exported. Import `@beesolve/ip-info` directly.
