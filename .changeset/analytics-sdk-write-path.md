---
"@beesolve/analytics-processor": minor
"@beesolve/analytics-dashboard": minor
---

Add a decoupled SDK write path to `@beesolve/analytics-processor` and route the
dashboard's sitemap-URL write through it.

`@beesolve/analytics-processor` now ships a processor-owned SDK handler Lambda
with read/write access to the analytics table, invoked through a typed
`AnalyticsClient` from the new `@beesolve/analytics-processor/sdk` export. The
client exposes `updateSitemapUrl({ sitemapUrl })`, which dispatches to the
handler via synchronous Lambda invocation (mirroring the `@beesolve/auth-service`
SDK pattern). The CDK construct's `grantRead(handler)` method is renamed to
`grantAccess(handler)`: it still grants read-only access to the table and sets
the `ANALYTICS_TABLE_NAME`/`ANALYTICS_REVERSE_INDEX` env vars, and additionally
grants invoke on the SDK handler and sets `BEESOLVE_ANALYTICS_SDK_HANDLER_ARN`.

`@beesolve/analytics-dashboard` keeps read-only table access and now routes the
`setSitemapUrl` form action through `AnalyticsClient.updateSitemapUrl` instead of
writing to DynamoDB directly (the dashboard handler has no write permission). The
dashboard now requires the `BEESOLVE_ANALYTICS_SDK_HANDLER_ARN` environment
variable, wired automatically by `AnalyticsProcessor.grantAccess`.
