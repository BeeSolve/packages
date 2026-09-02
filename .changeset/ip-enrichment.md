---
"@beesolve/dmarc-consumer": minor
"@beesolve/dmarc-dashboard": minor
---

Add optional source IP enrichment (ASN + country) via ipinfo.io Lite, plus a
per-domain backfill job for historical data.

- `dmarc-consumer` gains an `IpInfoCache` (`./ip-info` export) that caches per-IP
  ASN/country lookups as `ipinfo#<ip>` items in the existing table. Caching is
  presence-only: an IP is looked up once and reused thereafter, with no TTL or
  staleness refresh (`fetchedAt` is stored as metadata only). The consumer enriches
  source IPs at ingestion time when `IPINFO_API_KEY` is configured, and skips
  enrichment entirely when it is not. The consumer Lambda has read+write on the table
  and accepts an optional `ipInfoApiKey` CDK prop.
- `dmarc-consumer` also gains a per-domain backfill feature: a `BackfillSdk` (`./sdk`
  export) and an SQS-driven worker Lambda that paginates existing reports for a domain
  (never scans), collects unique source IPs, and populates the enrichment cache for
  historical data. Backfill state (a single latest-per-domain config record plus
  per-run history) is tracked in the table, writes are transactional, and the
  `DmarcConsumer` construct exposes `grantBackfill(lambda)` to let a caller (the
  dashboard) enqueue runs.
- `dmarc-dashboard` domain detail now shows an Origin (ASN · country) column, a
  plain-language Verdict per source IP (legitimate / forwarded / suspicious / likely
  spoofing), a "Spoofing Blocked" summary card, surfaced `headerFrom` / raw SPF+DKIM
  results / policy-override reasons, an Authorized Senders alignment panel, and a
  scope note clarifying that aggregate reports are domain-level only. The domains list
  gains a per-domain "Run backfill" button, gated by backfill status.
