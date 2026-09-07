---
"@beesolve/dmarc-consumer": minor
---

Add DNS setup data and DNS-refresh tooling; generalize the job-run tracker and rename the SDK.

**New**

- DNS record parsing and schema (`./dns-record` export): `parseSpfRecord`, `parseDmarcRecord`, and the `DomainDns`/`SpfMechanism`/`DmarcRecordDns`/`DkimSelector` types.
- Pure DNS resolver (`./dns` export): `resolveDomainDns` (SPF, `_dmarc`, and observed-DKIM-selector lookups via `node:dns/promises`) and `isDnsStale`.
- An optional `dns` field and a self-updating `selectors` String Set on the domain record. Selectors are unioned from each ingested report's DKIM auth results, so the DNS worker reads them directly instead of scanning report history. Both fields are optional and backward compatible.
- `Domains` accessors: `getByDomain`, `putDns`, `clearDns`, and `addSelectors`.
- A `refreshDomainDns` SQS task, a daily EventBridge cron that enqueues refreshes for stale domains, and a first-time bootstrap enqueue when a new domain is ingested. All three enqueue through the same guarded run-start so a domain cannot be double-started.

**Breaking (minor while 0.x)**

- `BackfillSdk` is renamed to `AdminSdk` with no deprecated alias. `start` → `startIpBackfill`, `getStatuses` → `getIpBackfillStatuses`, plus new `startDnsRefresh` / `getDnsRefreshStatuses`.
- The `DmarcConsumer` CDK method `grantBackfill` is renamed to `grantTasks`, and the internal SQS handler construct id changed from `Backfill` to `Tasks` (the worker now handles both IP-enrichment backfill and DNS refresh). The construct-id change replaces the tasks queues and worker Lambda on deploy.
- `Domains.upsert` now returns `{ created: boolean }`.
