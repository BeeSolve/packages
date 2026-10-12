---
"@beesolve/dmarc-consumer": minor
---

Move the IP enrichment cache to the new shared `@beesolve/ip-info` package.

The `IpInfoCache` implementation (plus `lookupIpInfo`, `IpInfo`, `IpInfoCacheItem`,
and `ipInfoCacheSchema`) is no longer defined or exported here — it now lives in
`@beesolve/ip-info`, which this package depends on. Internally the consumer imports
these from `@beesolve/ip-info`; behavior is unchanged.

BREAKING for subpath consumers: the `@beesolve/dmarc-consumer/ip-info` export has been
removed. Import `IpInfoCache` and friends from `@beesolve/ip-info` instead. All other
exports (`./report`, `./domain`, `./processing-stats`, `./dns`, `./dns-record`, `./sdk`,
`./cdk`) are unchanged.
