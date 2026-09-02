# ADR-002: Source IP Enrichment via a Per-IP ipinfo Cache

## Status

Accepted

## Context

DMARC aggregate reports identify senders only by raw source IP address. A raw IP
(e.g. `112.201.67.110`) is meaningless to a human trying to judge whether a row in
the Source IP Analysis table is their own mail provider or an unauthorized sender.
To make the dashboard understandable, each source IP needs an ASN / organization
name (e.g. "Google LLC") and a country.

We need to decide (1) where enrichment data comes from, (2) where it is stored, and
(3) when the lookup happens.

## Decision

Enrich source IPs with ASN and country using the **ipinfo.io Lite API**, and cache
each result as a **per-IP item in the existing DynamoDB table** (`pk: ipinfo#<ip>`,
`sk: ipinfo`). Lookups happen at **ingestion time** in the consumer, **presence-first**:
an IP is looked up only when it is not already cached, and once cached it is never
re-fetched.

Enrichment is **optional**: when no `IPINFO_API_KEY` is configured, enrichment is
skipped entirely and the dashboard renders without ASN/country columns populated.

### Rationale

#### 1. ipinfo.io Lite is free and sufficient

The Lite API provides unlimited country-level geolocation and basic ASN information
(ASN, organization name, domain) with no daily or monthly limit. That is exactly the
fields the dashboard needs and nothing more.

#### 2. Per-IP cache item, not inline on each record

The same IP recurs across many reports and many domains. Storing enrichment inline
on every DMARC record would duplicate the data and make refresh impossible. A single
item keyed by IP is deduplicated, refreshable in place, and reusable by the consumer,
the dashboard, and any backfill tooling.

#### 3. Same table, no new infrastructure

The cache lives in the existing DMARC table using a distinct key prefix. No new table,
GSI, or stack wiring is required.

#### 4. Presence-only caching, no TTL, no staleness refresh

Each cache item stores `fetchedAt`, but it is treated as **informational metadata
only** — it is never read to make an expiry or refresh decision. Caching is
**presence-only**: if an IP is already stored, the cached value is used and the ipinfo
API is never called again for that IP. We deliberately do **not** set a DynamoDB TTL
attribute on these items, and we do **not** implement a logical staleness/refresh
mechanism.

The rationale is twofold. First, ASN/country mappings drift very rarely, so refreshing
adds cost (extra API calls, extra reads) without meaningful benefit at the current
scale. Second, presence-only caching avoids overfetching ipinfo during backfills and
re-runs: enriching the same historical IP set repeatedly costs at most one lookup per
IP, ever. The read+write grant that a staleness refresh would have required is needed
for backfill anyway, so there is no infrastructure tradeoff to preserve.

## Consequences

- The consumer Lambda gains read+write on the table (previously write-only) so it can
  check the cache before fetching. This grant is also required by the backfill worker.
- Enrichment failures are logged and swallowed by the consumer handler — they never
  fail report persistence. (`enrich`/`enrichMany` themselves surface lookup errors; the
  caller decides how to handle them.)
- The dashboard performs only cache reads (`getMany`); it never calls the API at
  render time, keeping page loads fast and free of external latency.
- Historical reports ingested before enrichment existed are not enriched automatically.
  A per-domain backfill (owned by this package, exposed via an SDK) populates the cache
  for existing IPs. Because caching is presence-only, re-running a backfill is cheap.
- An IP's enrichment is effectively permanent once stored. If ASN/country data ever
  needs correcting, a deliberate refresh mechanism would have to be added (see Future
  Work).

## Future Work

### Optional cache staleness / refresh (not needed at current scale)

Should ASN/country drift ever become a concern, a refresh mechanism can be layered on
**without** changing the presence-only default. The intended shape:

- On read (or in a periodic sweep), batch-read the candidate IPs, then for each IP
  perform a **conditional** `PutCommand` that writes only when the item is missing or
  older than a cutoff:

  ```
  ConditionExpression:
    "attribute_not_exists(pk) AND attribute_not_exists(sk) OR fetchedAt < :cutoff"
  ```

  Because the table uses a **composite key** (`pk` + `sk`), the not-exists branch must
  check **both** key attributes — checking only `attribute_not_exists(pk)` would
  incorrectly block writes for items sharing a `pk` with a different `sk`.

This is explicitly **out of scope** and unnecessary at the current scale: the enrichment
data set is small, ipinfo Lite is free, and ASN/country mappings are stable enough that
a one-time lookup per IP is sufficient. `fetchedAt` is already stored so this can be
added later with no schema migration.

## Alternatives Considered

### Bundled offline MaxMind GeoLite2 database

Ships ASN/country offline with no runtime network calls. Rejected for now because it
requires a MaxMind account + license key, a ~6MB bundled data file that must be
periodically refreshed, and the free ipinfo Lite tier already covers the need with less
operational overhead. Could be revisited if API dependency becomes undesirable.

### Reverse DNS (PTR) only

Zero dependencies via `node:dns`, but PTR yields a hostname rather than an organization
name or country, and many botnet IPs have no PTR record. Too weak a signal for the
"is this my provider or a botnet?" question.

### Inline enrichment stored on each report record

Rejected — see Rationale #2 (duplication, no refresh path).

## References

- [ipinfo.io Lite API](https://ipinfo.io/developers/lite-api)
- [ADR-001: Handle RUA (Aggregate) Reports Only](./adr-001-rua-only.md)
