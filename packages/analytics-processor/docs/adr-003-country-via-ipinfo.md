# ADR-003: Country Breakdown via an IP-Info Cache

## Status

Accepted

## Context

The dashboard wants a per-country breakdown of traffic. CloudFront standard logs
— both legacy v1 and the new v2 Parquet format — contain no viewer-country
field. The only geographic signal available is the client IP (`c-ip`). Resolving
every request's IP to a country on every hourly run would be slow, would hammer
an external geolocation API, and would not be reproducible across re-runs.

`@beesolve/dmarc-consumer` already solves an almost identical problem: it
enriches source IPs to ASN + country via ipinfo.io Lite and caches the result
per IP in its DynamoDB table (see that package's `ipInfo.ts`). The analytics
processor needs the same capability, but a backend package depending on another
backend package only for a cache class would couple their release cycles and
schemas for no architectural reason.

## Decision

Derive the country breakdown from the top-N client IPs of each hour, resolved
through an `IpInfoCache` that is **copied into this package** (not imported from
dmarc-consumer):

- The hourly Athena query returns the top-N `c-ip` values by hits for the hour.
- `IpInfoCache.enrichMany` resolves those IPs, reading cached entries first and
  calling ipinfo.io only for IPs not already cached, then writing new results
  back to the table.
- Each IP's hits are attributed to its resolved `countryCode`. IPs that cannot
  be resolved — or all IPs when no API key is configured — fall back to the
  sentinel country `ZZ`.

The cache is presence-only: an IP is looked up at most once, ever.

## Rationale

### 1. Top-N IPs, not every IP

Country is a coarse breakdown. Resolving only the top-N IPs by hits captures the
overwhelming majority of traffic while bounding both the number of external
lookups and the number of DynamoDB reads per hour.

### 2. Cache makes it cheap and reproducible

Because resolution is cached per IP, a re-run of the same hour (idempotency
re-run, backfill overlap) performs no new external calls and produces the same
attribution. Cost is bounded by the number of distinct IPs seen, not by the
number of runs.

### 3. Copy over backend→backend dependency

Copying the small, stable `IpInfoCache` into this package keeps the two backends
independently releasable and lets each own its table shape. The duplication is a
single self-contained file with no behavioral drift risk, which is a better
trade than a cross-package runtime dependency that exists only to share a cache.

### 4. `ZZ` fallback keeps the pipeline total

Using the ISO "unknown" sentinel `ZZ` for unresolved IPs — and for the no-API-key
case — means the country breakdown is always well-defined and the write path
never has to special-case missing data.

## Consequences

- Country attribution is approximate (top-N IPs) but cheap, cached, and
  reproducible.
- Without an ipinfo.io API key the breakdown degrades gracefully to a single
  `ZZ` bucket rather than failing.
- `IpInfoCache` is duplicated between dmarc-consumer and analytics-processor;
  changes to one do not propagate to the other, which is intentional.

## Alternatives Considered

### Depend on `@beesolve/dmarc-consumer` for the cache

Rejected. A backend→backend dependency only to reuse a cache class couples
release cycles and table schemas for no architectural benefit.

### Resolve every request IP

Rejected. Unbounded external calls and reads per hour for a coarse breakdown
that top-N already captures.

### A third-party MaxMind/GeoIP database bundled in the Lambda

Rejected for now. It adds a sizeable asset and an update cadence to the Lambda;
the cached ipinfo.io lookups are sufficient at this volume and match the
existing dmarc-consumer approach.

## References

- ADR-002 — single-table key schema (where cached IP info lives)
- `@beesolve/dmarc-consumer` `ipInfo.ts` — the cache this is copied from
