# ADR-001: Why This Project Exists

## Status

Accepted

## Context

A site served behind CloudFront produces access logs, but raw logs are not insight. CloudFront's
own console gives only coarse, short-retention charts, and third-party analytics (Google
Analytics, Plausible, Fathom, etc.) require a client-side script, see only what the browser
reports, and ship your visitors' data to someone else's infrastructure. For a personal or
small-scale site, none of those is a good fit:

- **Client-side analytics miss server truth.** Bots, non-HTML assets, error responses, bytes
  transferred, and cache behavior never show up in a browser beacon. The access log is the
  authoritative record of what CloudFront actually served.
- **Third-party dashboards cost money and hold your data.** They charge per month or per
  pageview and store traffic data off your account.
- **Raw Athena-over-logs is not a dashboard.** You can query the logs directly, but every view
  is a hand-written SQL query with per-query cost and latency — not something to open daily.

The analytics data itself is produced by `@beesolve/cdk-constructs`
(`CloudFrontAccessLoggingSettings` standard logging v2) and `@beesolve/analytics-processor`
(Athena → DynamoDB aggregation). What was missing was the user-facing application that turns the
processor's pre-aggregated DynamoDB table into something a human opens and reads.

## Decision

Build a self-hosted, serverless analytics dashboard on AWS that:

- Reads the `@beesolve/analytics-processor` DynamoDB table **read-only** (bounded `Query` calls,
  never `Scan`)
- Renders overview totals (hits, success, errors, bytes) across hourly/daily/monthly/yearly
  grains with rolling prev/next windows
- Renders per-dimension breakdowns (HTTP status, country, device, top paths)
- Sits behind `@beesolve/auth-service` email-code authentication, so only invited users see it

It ships as a single published CDK construct (`./cdk` → `AnalyticsDashboard`) on
`kit-on-lambda`, mirroring `@beesolve/dmarc-dashboard`.

## Rationale

### 1. The processor already did the expensive work

The processor pre-aggregates every hour into DynamoDB with atomic counters. The dashboard's
reads are therefore cheap, bounded `Query` calls against prepared items — no Athena at read
time, no per-view SQL cost, instant page loads. Keeping the dashboard read-only also means it
cannot corrupt the aggregates.

### 2. Server-side truth, your account, near-zero cost

The data is CloudFront's own access log, so the dashboard reflects what was actually served
(including bots, assets, and errors), not what a browser chose to report. Everything runs in
your AWS account on Lambda + DynamoDB on-demand, with no subscription and no data leaving your
account.

### 3. Reuse the dmarc-dashboard shape

Auth, email-code sign-in, user management, remote functions, and the kit-on-lambda deployment
are already solved in `@beesolve/dmarc-dashboard`. Mirroring it keeps the two dashboards
consistent and avoids re-inventing the auth/deploy plumbing.

### 4. A dedicated users table, not the analytics table

`AnalyticsProcessor.grantRead` is intentionally read-only. The dashboard's own `Users`/`Setup`
records need writes, so the construct provisions its own small `TableV2` (+ reverse GSI) for
them. This keeps a clean separation: the analytics table is owned and written only by the
processor; the dashboard owns only its auth/user state.

## Consequences

- Requires an AWS account and CDK deployment knowledge (mitigated by the `@beesolve/samples`
  `analytics` stack).
- The dashboard is only as fresh and as complete as the processor's table. Long-range history
  exists only after the one-time v1 backfill is run.
- The dashboard is opinionated (SvelteKit, cookie-based auth via `@beesolve/auth-service`) — not
  a generic bring-your-own-frontend solution.
- Two DynamoDB tables exist in the deployment (processor analytics table + dashboard users
  table). This is deliberate for ownership clarity.

## Alternatives Considered

### Use a third-party analytics service

Rejected. Monthly cost, client-side-only visibility, and traffic data stored off your account —
for something that can run at near-zero cost on logs you already collect.

### Query Athena directly from the dashboard at read time

Rejected. Every page view would incur Athena cost and multi-second latency, and would re-scan
data the processor already aggregated. The processor exists precisely so reads are cheap DynamoDB
queries.

### Fold users/setup into the processor's analytics table

Rejected. It would force the processor to grant write access to the dashboard and blur ownership
of the analytics data. A dedicated, dashboard-owned users table keeps the read-only boundary
clean.
