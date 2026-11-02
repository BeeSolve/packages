---
"@beesolve/aws-env-resolver": patch
---

Fix: the resource cache is invalidated when the resource mapping changes. Previously the cache was keyed only by region, stack names and secret id, so regenerating a config with new env vars kept serving the old cached values (and the new vars were missing) until the 24 hour TTL expired or `--refresh` was passed. The cache file now records a hash of the mapping and a mismatch is a miss. Existing cache files miss once after upgrading.
