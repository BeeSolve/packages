---
"@beesolve/dmarc-consumer": patch
"@beesolve/dmarc-dashboard": patch
---

Internal refactor after the DNS advisory feature; no public API or behaviour change.

- `dmarc-consumer`: extracted shared internals — `beginRun` (guarded run-start) now used by both `AdminSdk` start methods and the DNS cron, a `withJobFailure` wrapper shared by the backfill and DNS-refresh workers, and a shared `errorMessage` helper. Removed dead re-exports from the consumer handler module.
- `dmarc-dashboard`: extracted a shared `LastRunStatus` component, an `ipOrigin` helper, an `encodeReportKey`/`decodeReportKey` pair, and a `requireUser`/`requireDomainAccess` server access guard, deduplicating logic across routes.
