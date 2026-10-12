---
"@beesolve/analytics-dashboard": minor
---

Add `@beesolve/analytics-dashboard` — a SvelteKit app, published as a CDK construct, for
viewing CloudFront traffic analytics.

The dashboard reads the `@beesolve/analytics-processor` DynamoDB table read-only (bounded
`Query` calls, never `Scan`) and renders overview totals (hits, success, errors, bytes) across
hourly/daily/monthly/yearly grains with rolling prev/next windows, plus per-dimension
breakdowns (HTTP status, country, device, top paths). It runs on `kit-on-lambda` behind
`AuthGateway` email-code authentication and uses `@drop-in/graffiti` for UI.

`./cdk` exports the `AnalyticsDashboard` construct, which provisions the SvelteKit Lambda,
CloudFront distribution with auth-cookie enforcement and an `/auth/*` behavior, an SES-backed
auth-events consumer for OTP emails, and a dedicated DynamoDB table (+ reverse GSI) for the
dashboard's own `Users`/`Setup` records (wired via `ANALYTICS_USERS_TABLE` /
`ANALYTICS_USERS_REVERSE_INDEX`), while taking read-only access to the processor's analytics
table through `processor.grantRead(handler)`.
