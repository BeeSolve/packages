# ADR-001: Daily DMARC Alert Email

## Status

Proposed

## Context

Users need visibility into DMARC report trends without logging into the dashboard daily. A scheduled daily email summarizing the previous day's activity provides proactive monitoring.

## Decision

Implement a daily alert email Lambda triggered by EventBridge on a cron schedule.

### Architecture

```
EventBridge Scheduled Rule (cron: 0 8 * * ? *)
       ↓
Daily Alert Lambda
       ↓
┌─────────────────────────────────────────┐
│ 1. Query Domains.list()                 │
│ 2. Call Reports.getDailyAggregateAll-   │
│    Domains({ domains, date: yesterday })│
│ 3. Filter domains with zero activity    │
│ 4. Render HTML email template           │
│ 5. Send via @beesolve/email-service     │
│    to users with access to each domain  │
└─────────────────────────────────────────┘
```

### Data Layer (implemented)

- `Reports.getDailyAggregate({ domain, date })` — returns structured summary for one domain/day
- `Reports.getDailyAggregateAllDomains({ domains, date })` — parallel aggregation, filters zero-activity
- Returns: `{ domain, date, totalMessages, totalPass, totalFail, reportCount, topFailingIps }`

### Email Content

- Subject: "DMARC Daily Summary — {date}"
- Per-domain section: messages processed, pass rate, failing IPs
- Highlight domains with pass rate below threshold (e.g. < 95%)
- Link to dashboard for each domain

### Trigger

- EventBridge scheduled rule: `cron(0 8 * * ? *)` (daily at 08:00 UTC)
- Lambda queries previous day's data (`yesterday = new Date(); yesterday.setUTCDate(...)`)

### Recipients

- Query Users service to find users with access to each domain
- Admins receive summary for all domains
- Regular users receive summary for their assigned domains only

## Consequences

- Requires `@beesolve/email-service` for sending
- Lambda needs read access to the DMARC table (via `DmarcConsumer.grantRead()`)
- Email template will be implemented as a React Email component
