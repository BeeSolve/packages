---
"@beesolve/analytics-processor": patch
---

Source the IP enrichment cache from the new shared `@beesolve/ip-info` package instead
of a local copy.

The duplicated `ipInfo.ts` has been removed and the root barrel now re-exports
`@beesolve/ip-info`, so the package's public API still surfaces `IpInfoCache`,
`lookupIpInfo`, `IpInfo`, and `IpInfoCacheItem` unchanged. No behavior change.
