# ADR-003: DNS Setup Records Cached on the Domain Record, Refreshed Out of Band

## Status

Accepted

## Context

The dashboard needs to give users actionable setup guidance: is their `_dmarc`
policy strong enough, does their SPF record end in `-all`, does it exceed the
10-lookup limit, are the DKIM selectors that actually sign their mail published in
DNS? Answering these requires reading the domain's **live DNS** — the `_dmarc`,
SPF, and DKIM TXT records — and combining that with what the reports already show.

Three questions had to be decided: (1) where the fetched DNS data is stored, (2)
when and how it is fetched, and (3) how staleness is judged given that TXT lookups
do not expose a usable TTL.

DNS resolution runs on Node's built-in `node:dns/promises` — all Lambdas use
`Runtime.NODEJS_24_X` and the dashboard SSR runs on Node 24, so no dependency is
added. `resolveTxt()` does **not** return per-record DNS TTLs (`{ ttl: true }` is
only supported for A/AAAA lookups), so the published TTL is not available to drive
staleness.

## Decision

Cache the resolved DNS records as an **optional `dns` field on the existing domain
record** (`pk: domain#<domain>`, `sk: domain`). Fetch and write that field only in
an **out-of-band SQS worker** (`refreshDomainDns`), never inline in the SSR request
path. Trigger the worker three ways — a **daily EventBridge cron** that fans out one
task per stale domain, a **first-time bootstrap** enqueue when a domain aggregate is
first created during ingest, and an **on-demand refresh button** in the dashboard.
Judge staleness against an **internally configured TTL** (`DNS_CACHE_TTL_MS`, default
24h), not the DNS-published TTL.

The DKIM selectors to probe are **observation-driven**: the consumer maintains a
self-updating `selectors` String Set on the domain record as reports arrive, so the
worker reads the set directly rather than scanning report history.

### Rationale

#### 1. DNS cached on the domain record, not a separate cache item

The `dns` field is `v.optional`, so existing stored records without it parse
unchanged — the schema change is backward compatible. It is written with a targeted
`SET #dns = :dns` update that never touches the `ADD` counter fields, so ingest's
atomic counter updates and the DNS write never interfere. Keeping it on the domain
item (rather than a separate `dns#<domain>` item) means the SSR page reads DNS,
counters, and selectors in the single `getByDomain` it already performs.

#### 2. All fetching and writing happens in an out-of-band SQS worker

`node:dns/promises` resolution can be slow or hang. Doing it inline in the SSR
request path risks API Gateway / CloudFront timeouts. Moving it to an SQS worker
(`refreshDomainDns`) mirrors the existing IP-backfill architecture and keeps SSR
strictly read-only: the page reads the cached `dns` field and never resolves DNS
itself.

#### 3. Three triggers, all through one guarded start

- **Daily EventBridge cron** fans out one `refreshDomainDns` task per _stale_ domain
  (`isDnsStale` against the TTL). A daily cron plus a 24h TTL means each domain
  refetches roughly daily, while the cron is a no-op for anything still fresh.
- **First-time bootstrap**: when a domain aggregate is created for the first time
  during ingest (detected via `upsert` returning `{ created }`), a refresh is
  enqueued so new domains get DNS immediately without waiting for the nightly sweep
  and without inline DNS on the ingest hot path. It is fire-and-forget — enqueue
  errors are logged and swallowed so ingest never fails.
- **On-demand button** enqueues a forced refresh via `AdminSdk.startDnsRefresh`.

All three enqueue through the **same guarded `startRun`** on the shared job-run
tracker. The tracker's `already-running` condition is the single point that prevents
the cron, the bootstrap, and a manual click from double-starting a run for the same
domain. The cron is deliberately **not** an unconditional enqueue.

#### 4. Internal 24h staleness TTL, not the DNS-published TTL

`resolveTxt()` does not expose per-record TTLs. Reading real TXT TTLs would require
raw DNS queries or a new dependency, which we declined. A configurable
`DNS_CACHE_TTL_MS` (default 24h) is simple, dependency-free, and adequate: DMARC/SPF/
DKIM records change rarely, so a daily refresh is more than timely enough.

#### 5. Generalized job-run tracker shared with IP backfill

The DNS refresh reuses the IP-backfill run-state machine, generalized to be
parameterized by a **job kind** (`ipBackfill` | `dnsRefresh`). Each kind gets a
distinct config `sk` and run-history `pk` prefix so the two job types stay isolated
in the single table, while sharing identical `canRun` / `lastRun` / stale-run
recovery semantics. This avoids duplicating the tracker and gives DNS refresh the
same crash-recovery behavior for free.

#### 6. Observation-driven DKIM selectors, maintained at ingest

DNS cannot enumerate arbitrary DKIM selectors, so the worker can only probe selectors
it knows about. Rather than scan a domain's entire report history on every refresh
(wasteful, and re-discovering the same handful of selectors daily), the consumer
unions each report's observed `authResults.dkim[].selector` values into a `selectors`
String Set on the domain record at ingest time. The set self-updates as senders
rotate selectors, and the worker reads it directly — no report traversal.

## Consequences

- The domain record gains two optional fields: `dns` (the cached records) and
  `selectors` (a String Set of observed DKIM selectors). Both are optional, so the
  change is backward compatible.
- The consumer Lambda gains permission to enqueue to the tasks main queue (for the
  first-time bootstrap) in addition to its existing table access.
- A new daily EventBridge rule and a small cron Lambda are added. The DNS worker
  itself is not a new function — `refreshDomainDns` is added to the existing tasks
  SqsHandler, which already has table read/write.
- SSR never performs DNS resolution; it reads `dns` (and `dns.fetchedAt` for a
  "last checked" hint) and degrades gracefully when `dns` is absent or carries an
  `error`, still rendering report-derived findings.
- Because DNS resolution is isolated in a single network-touching function
  (`resolveDomainDns`), the record parsers are pure and unit-tested without DNS.
- A domain that stops sending mail for longer than reports are retained will have a
  stable selector set (the String Set only grows); stale selectors that are no longer
  published simply resolve to `found: false`, which the advisory can surface.

## Alternatives Considered

### Separate DNS cache item (`pk: dns#<domain>`)

Rejected per the user's explicit instruction to keep the cache on the domain record.
A separate item would also cost the SSR page an extra read; the domain record is
already fetched.

### Inline DNS resolution in the SSR load path

Rejected — `resolveTxt` latency/hangs would threaten API Gateway/CloudFront timeouts
and make page loads depend on external DNS. Out-of-band resolution keeps SSR fast and
read-only.

### DNS-published TTL for staleness

Not available: `node:dns/promises` `resolveTxt()` has no `{ ttl: true }` option (that
is A/AAAA only). Obtaining real TXT TTLs requires raw DNS queries or a new dependency,
which was declined. A fixed configurable window is used instead.

### Scanning report history for DKIM selectors on each refresh

Rejected as wasteful — it re-reads the whole report history to rediscover a small,
slowly-changing selector set. Maintaining a self-updating String Set at ingest gives
the worker the selectors with a single `getByDomain` and no traversal.

## References

- [ADR-002: Source IP Enrichment via a Per-IP ipinfo Cache](./adr-002-ip-enrichment-cache.md)
- [Node.js `dns.promises.resolveTxt`](https://nodejs.org/api/dns.html#dnspromisesresolvetxthostname)
