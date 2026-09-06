---
"@beesolve/helpers": minor
---

Add `sortObjectKeysRecursively` and `stableJsonStringify`. `sortObjectKeysRecursively` returns a deep copy with object keys sorted alphabetically at every level (arrays keep their order), and `stableJsonStringify` builds on it to produce a deterministic JSON string regardless of the input's key order.
