---
"@beesolve/ip-info": minor
---

Never persist raw IP addresses in the enrichment cache. Items are now keyed by
`pk = ipinfo#<sha256(ip)>` and the plaintext `ip` attribute is removed from the
stored record, so an IP cannot be read back out of the table. `get`/`getMany`/
`enrich`/`enrichMany` are unchanged at the call site (they still take IPs and
return results keyed by the input IP), but `IpInfoCacheItem` and
`ipInfoCacheSchema` no longer carry an `ip` field. Existing cache entries written
under the old plaintext-IP keys are not read by the new key scheme; they are
harmlessly re-fetched on next access (and can be left to expire or be removed).
