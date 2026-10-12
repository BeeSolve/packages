# ADR-001: Why This Package Exists

## Status

Accepted

## Context

Several backends enrich raw IP addresses with country and ASN metadata before
presenting them to users. The DMARC pipeline enriches the source IPs of DMARC
report records, and the CloudFront analytics processor enriches the top client
IPs of each hourly window. Both need the same behavior:

- Look up IP metadata via the ipinfo.io lite API
- Cache each result in DynamoDB so a given IP is fetched at most once
- A presence-only enrichment path (`enrich`/`enrichMany`) that skips the API for
  already-cached IPs and no-ops entirely when no API key is configured
- Read-only lookups (`get`/`getMany`) for a dashboard that renders cached values
  but must never call the external API

The exact same `IpInfoCache` implementation was copied byte-for-byte into
`@beesolve/dmarc-consumer` and `@beesolve/analytics-processor`, and the DMARC
dashboard reached into the consumer's `./ip-info` subpath to reuse it. The copies
had already drifted into a dashboard-to-backend dependency that existed solely to
share this one class.

## Decision

Extract the IP enrichment cache into a standalone `@beesolve/ip-info` package
exporting `IpInfoCache`, `lookupIpInfo`, the `IpInfo` result shape, the
`IpInfoCacheItem` record shape, and the `ipInfoCacheSchema` Valibot schema. All
three consumers depend on this package directly.

## Rationale

### 1. Single source of truth

Two byte-identical copies are two things to keep in sync and two places for a fix
to be forgotten. One package means one implementation, one test suite, and one
place to change behavior.

### 2. Avoids backend-to-backend coupling

The dashboard previously imported `IpInfoCache` from
`@beesolve/dmarc-consumer/ip-info`, giving a read-side app a dependency on a
write-side backend purely to reuse a cache class. A shared leaf package removes
that coupling: the dashboard depends on `@beesolve/ip-info` for enrichment and on
`@beesolve/dmarc-consumer` only for the DMARC domain models it actually needs.

### 3. Generic, DynamoDB-only primitive

The cache is a small, pure DynamoDB model with no CDK or Lambda surface, matching
the shape of other leaf libraries like `@beesolve/helpers`. It is independently
useful to any backend that needs IP enrichment, not just the two current ones.

## Consequences

- IP enrichment lives in one tested package; both backends and the dashboard share
  it via a single dependency.
- `@beesolve/dmarc-consumer` drops its `./ip-info` subpath export. Any external
  importer of that subpath must switch to `@beesolve/ip-info`. The consumer is
  pre-1.0 and internal, so this is an acceptable, documented move.
- The package is DynamoDB-only and tied to the ipinfo.io lite API shape — not a
  general geoip abstraction. Acceptable given the AWS-focused consumers.

## Alternatives Considered

### Keep the copies in sync manually

Rejected. Byte-identical copies had already drifted into an ad-hoc cross-package
dependency, and manual syncing guarantees eventual divergence.

### Keep the canonical copy in dmarc-consumer and let others import its subpath

Rejected. This makes a write-side backend the owner of a primitive consumed by a
read-side dashboard and an unrelated analytics backend, inverting the dependency
direction and forcing unrelated packages to depend on the DMARC consumer.
