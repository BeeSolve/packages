# @beesolve/analytics-dashboard

## 0.2.3

### Patch Changes

- Updated dependencies [09efb63]
  - @beesolve/cdk-constructs@0.6.0
  - @beesolve/analytics-processor@0.2.2
  - @beesolve/lambda-keep-active@2.1.9
  - @beesolve/auth-service@0.19.2
  - @beesolve/email-service@0.5.5

## 0.2.2

### Patch Changes

- Updated dependencies [b868372]
  - @beesolve/cdk-constructs@0.5.0
  - @beesolve/analytics-processor@0.2.1
  - @beesolve/lambda-keep-active@2.1.8
  - @beesolve/auth-service@0.19.1
  - @beesolve/email-service@0.5.4

## 0.2.1

### Patch Changes

- Updated dependencies [3666a2a]
  - @beesolve/auth-service@0.19.0

## 0.2.0

### Minor Changes

- e1fff17: Add `@beesolve/analytics-dashboard` — a SvelteKit app, published as a CDK construct, for
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

### Patch Changes

- Updated dependencies [6fc65b5]
- Updated dependencies [6fc65b5]
- Updated dependencies [029b8eb]
- Updated dependencies [dfc3824]
  - @beesolve/analytics-processor@0.2.0
  - @beesolve/cdk-constructs@0.4.0
  - @beesolve/lambda-keep-active@2.1.7
  - @beesolve/auth-service@0.18.1
  - @beesolve/email-service@0.5.3
