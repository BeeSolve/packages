# ADR-001: Why This Project Exists

## Status

Accepted

## Context

Setting up DMARC on a custom domain with AWS is straightforward — you add the DNS records, point `rua` to an email address, and services like easydmarc.com will give you a 10/10 score. But that's where the easy part ends.

Once `rua` is configured, mailbox providers start sending you aggregate reports. These arrive as gzipped XML attachments that are effectively unreadable by a human. Within days, they become noise in your inbox. Most domain owners end up in one of two places:

1. **Remove `rua` from DNS** — losing all visibility into who's sending email on their behalf.
2. **Archive reports in the mailbox** — technically preserving the data but never actually reading it.

Neither outcome delivers the value DMARC reporting is supposed to provide: visibility into unauthorized senders, alignment tracking, and confidence to tighten policy from `none` → `quarantine` → `reject`.

Paid services (easydmarc.com, Postmark DMARC, dmarcian, etc.) solve this by ingesting your reports and showing a dashboard. But they charge monthly fees, your data lives on their infrastructure, and you're dependent on their continued operation.

## Decision

Build a fully self-hosted, serverless DMARC monitoring solution on AWS that:

- Receives aggregate reports via SES to a dedicated email address
- Parses the gzipped XML automatically
- Persists structured data in DynamoDB
- Provides a web dashboard to browse reports, track alignment rates per domain, and identify unauthorized senders

The solution is split into composable packages (`@beesolve/dmarc-reports`, `@beesolve/dmarc-parser`, `@beesolve/dmarc-consumer`) with this dashboard as the user-facing application that ties them together.

## Rationale

### 1. You control the infrastructure

No third-party service holds your email authentication data. Everything runs in your own AWS account — you can audit, extend, or tear it down at any time.

### 2. Serverless means predictable (near-zero) cost

For most domains, DMARC reports arrive once per day per reporting provider. The volume is tiny. With Lambda, DynamoDB on-demand, SES inbound receiving, and S3 — the entire stack can operate within AWS free tier for a long time. There are no per-user or per-domain subscription fees.

### 3. Reports become actionable

Instead of unreadable XML attachments buried in your inbox, you get a dashboard showing pass/fail rates, source IPs, alignment status, and trends over time. This makes it realistic to move from `p=none` to `p=reject` with confidence.

### 4. Transparent and auditable

The code is open source. You can read exactly how reports are parsed, what data is stored, and how aggregation works. Paid services are black boxes — you trust them to interpret RFC 7489 correctly and not lose your data.

## Consequences

- Requires an AWS account and basic CDK deployment knowledge (mitigated by the `@beesolve/samples` package showing full deployment examples).
- You are responsible for your own infrastructure — no vendor support team. Acceptable for the target audience (developers who already use AWS).
- Cost analysis is needed to confirm there are no hidden fixed fees (SES inbound receiving, Route 53 hosted zone, etc.) that would undermine the "free tier" claim.
- The dashboard is opinionated (SvelteKit, cookie-based auth via `@beesolve/auth-service`) — not a generic "bring your own frontend" solution.

## Alternatives Considered

### Use a paid DMARC monitoring service

Rejected. Monthly cost for something that could run at near-zero on AWS. Data lives on someone else's infrastructure. No control over retention, features, or integrations.

### Parse reports manually when needed

Rejected. "I'll read them eventually" never happens. The reports accumulate, the inbox grows, and the domain owner has zero visibility into their email authentication posture. The whole point of `rua` is continuous monitoring, not forensic archaeology.

### Build a CLI tool instead of a dashboard

Considered but insufficient. A CLI could parse individual reports but doesn't provide aggregate views, trend tracking, or alerting. The value is in the continuous, at-a-glance monitoring — not one-off parsing.
