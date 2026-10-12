---
"@beesolve/ip-info": minor
---

Add `@beesolve/ip-info` — shared IP enrichment (country/ASN) with a DynamoDB-backed
presence cache.

This extracts the `IpInfoCache` implementation that was previously duplicated
byte-for-byte inside `@beesolve/dmarc-consumer` and `@beesolve/analytics-processor`
(and reached into by the DMARC dashboard) into a single, independently publishable
leaf package. Behavior is unchanged.

Public API (`.`): `IpInfoCache` (DynamoDB cache with `get`/`getMany`/`put`/`enrich`/`enrichMany`),
`lookupIpInfo` (direct uncached ipinfo.io lite lookup), the `IpInfo` result shape, the
`IpInfoCacheItem` stored-record shape, and the `ipInfoCacheSchema` Valibot schema. The
cache stores one item per IP under `pk = ipinfo#<ip>`, `sk = ipinfo`; `enrich`/`enrichMany`
only call the API for IPs not already cached and no-op when no API key is configured.
