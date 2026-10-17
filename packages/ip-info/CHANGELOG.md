# @beesolve/ip-info

## 0.3.0

### Minor Changes

- 25b3bcf: Never persist raw IP addresses in the enrichment cache. Items are now keyed by
  `pk = ipinfo#<sha256(ip)>` and the plaintext `ip` attribute is removed from the
  stored record, so an IP cannot be read back out of the table. `get`/`getMany`/
  `enrich`/`enrichMany` are unchanged at the call site (they still take IPs and
  return results keyed by the input IP), but `IpInfoCacheItem` and
  `ipInfoCacheSchema` no longer carry an `ip` field. Existing cache entries written
  under the old plaintext-IP keys are not read by the new key scheme; they are
  harmlessly re-fetched on next access (and can be left to expire or be removed).

## 0.2.0

### Minor Changes

- dfc3824: Add `@beesolve/ip-info` — shared IP enrichment (country/ASN) with a DynamoDB-backed
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
