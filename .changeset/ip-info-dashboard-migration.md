---
"@beesolve/dmarc-dashboard": patch
---

Import `IpInfoCache` from the new shared `@beesolve/ip-info` package instead of the
`@beesolve/dmarc-consumer/ip-info` subpath (which has been removed). The dashboard still
depends on `@beesolve/dmarc-consumer` for its DMARC domain models. No behavior change.
