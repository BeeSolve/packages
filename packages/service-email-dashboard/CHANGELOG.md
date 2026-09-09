# @beesolve/email-service-dashboard

## 0.3.6

### Patch Changes

- e20cd28: preview email

## 0.3.5

### Patch Changes

- cf7de0c: Add `@beesolve/lambda-keep-active` as a direct dependency.

  The `kit-on-lambda` adapter generates a Lambda handler that imports `@beesolve/lambda-keep-active/runtime`. Without declaring the package as a dependency, esbuild fails to resolve the import during the production build under a clean install (as in CI), breaking the lambda bundle.

- 9dfeceb: Migrate hand-rolled UI to graffiti design-system components across the dashboard.

  - Summary and rate grids now use graffiti's Card Grid (`.layout-card`) instead of custom grid CSS.
  - Toolbar and search rows on the messages and recipient pages use graffiti Cluster (`.cluster`).
  - Back links on the message and recipient detail pages are now graffiti Breadcrumbs.
  - The message-detail info panel and per-recipient timeline wrapper adopt graffiti Card (`.card`); the timeline component itself is unchanged.
  - The overview rate cards render via the shared `SummaryCard` (graffiti Stat Card), with the SES-threshold "flagged" error tint preserved as a small non-colliding modifier.
  - Data tables use graffiti's Table wrapper (`.table`), removing the custom `.table-scroll` shim from the layout.

  No behavior changes — data loading, forms, dialogs, and the month picker are untouched. The layout scaffold was intentionally left hand-rolled (graffiti App Shell would regress the whole-page scroll model).

- d098af7: Rebuild the per-recipient timeline on the message detail page using graffiti's built-in `.timeline` component instead of a hand-rolled layout.

  - Each entry is now a graffiti timeline item with a small tone-coloured marker on a single continuous connector line (success/error/warning/info mapped from the event status).
  - The status badge, timestamp, and detail sit inline on a single row, so graffiti's marker alignment keeps the dot level with the badge. This fixes the earlier misaligned dots, doubled connector lines, and mid-word text wrapping caused by custom timeline CSS colliding with graffiti's own `.timeline` rules.
  - Removed the redundant "(at …)" timestamp from each detail line — the entry timestamp is already shown on the row.
  - Also added the `DASHBOARD_REQUESTS_BUCKET` entry to `.env.local.example`.

## 0.3.4

### Patch Changes

- 245b751: Address a round of dashboard feedback across the overview, messages list, and message detail views.

  - Fix the per-recipient timeline showing every recipient's deliveries. The SES delivery consumer now fans out delivered events by `delivery.recipients` (the recipients that delivery notification actually covers) instead of `mail.destination` (all message recipients), so each recipient's timeline lists only its own delivery events.
  - Remove the meaningless "Total" summary card (an on-the-fly sum of overlapping counters) from both the overview and recipient detail pages.
  - Bound the messages list month picker by the setup completion date. The year/month selector no longer offers years before setup existed, months before the start month, or future months, and the previous-month arrow is disabled at the start month. Arrows now sit inline flanking the dropdowns on a single row.
  - Replace the exact-match recipient search with a datalist-backed autocomplete populated from a new keys-only recipients endpoint, so recipients can be found without typing the full address.
  - Restyle the message detail per-recipient timeline: normal-weight recipient headings, per-event markers on the rail, tighter spacing, and clearer separation between recipient sections.

## 0.3.3

### Patch Changes

- 8b821bc: chore: upgrade dependencies

## 0.3.2

### Patch Changes

- Updated dependencies [f02c1a4]
  - @beesolve/helpers@0.2.0
  - @beesolve/cdk-constructs@0.3.1
  - @beesolve/lambda-fetch-api@2.1.1
  - @beesolve/auth-service@0.15.1
  - @beesolve/email-service@0.5.1

## 0.3.1

### Patch Changes

- eeba945: Fix overlapping content in the per-recipient timeline on the message detail page. Each timeline entry now uses a grid layout with the status badge in its own column and the timestamp and detail text stacked vertically beside it, so they no longer collide when the timestamp wraps to multiple lines at narrow widths.
- Updated dependencies [936adc3]
  - @beesolve/email-service@0.5.0

## 0.3.0

### Minor Changes

- fb7b89a: Store the full email request on the dashboard's own S3 bucket (keyed `messages/<messageId>.json`) when the `EmailSentSuccess` event is consumed, and show it on demand in a modal on the message detail page.

  The message body is now fetched only when the user clicks "Request message body" (via a dedicated form action) and rendered as JSON in a dialog. This removes the previous dependency on the `@beesolve/email-service` SDK `getMessage` call from the dashboard's request path — the dashboard and email service stay decoupled through EventBridge, and the dashboard no longer needs a second email-service SDK instance to read message bodies.

## 0.2.1

### Patch Changes

- dc48a0d: Fix message list ordering and resilience in `messagesManyForMonth` and `messageManyByRecipient`. Results are now returned in the query order (newest-first) instead of the arbitrary order returned by DynamoDB `BatchGetItem`, duplicate index rows are de-duplicated so a single message is not fetched twice, and index rows whose message item is missing are skipped instead of throwing.

## 0.2.0

### Minor Changes

- 5c417d7: Scope auth EventBridge events per application to prevent cross-app OTP email cross-talk.

  `AuthGateway`/`AuthService`:

  - New optional `appId` prop — the only knob. When set, the auth event `source` becomes `beesolve.auth.<appId>` instead of the default `beesolve.auth.api`, so two apps sharing an event bus no longer both receive each other's `EmailCodeAuth` events. The source string is computed once by the construct, exposed as the public `eventSource` field, and injected into the auth handler as `EVENT_SOURCE`.
  - Expose the resolved `eventSource` and the resolved `eventBus` (`IEventBus`) as public fields so consumers can subscribe to the exact source and bind rules to the exact bus the deployment uses.
  - No exported source helpers and no explicit `eventSource` input prop — the source format lives in a single place.

  `EmailServiceDashboard` / `DmarcDashboard`:

  - Their auth-events rule binds to `props.auth.eventBus` and filters on `props.auth.eventSource`, so it matches whether the auth deployment uses the default bus, a custom bus (`eventBusArn`), and/or a distinct `appId`. Previously the rule was hardcoded to `source: ["beesolve.auth.api"]` on the default bus, which silently stopped delivering OTP emails when auth was moved to a custom bus.
  - `EmailServiceDashboard` drops its `eventBusName` prop. SES configuration-set event destinations can only target the account `default` bus, so the email-events rule (and the internal `Emails` construct) must stay on `default`; auth isolation is configured via the `auth` construct instead. Isolate the dashboard's own sign-in flow by giving its `AuthGateway` a dedicated `eventBusArn` (and/or `appId`); the displayed delivery-status events continue to arrive on the default bus.

### Patch Changes

- ed1840f: Fix the message projection so lifecycle events are recorded correctly.

  - `requestId` is now written only on the `requested` event and is optional on read (defaults to `"unknown"`), so later lifecycle events no longer overwrite a real request id with `"unknown"`.
  - The recipient and monthly query records are written only for non-`requested` events, matching the query schemas that back the message and recipient listings.
  - The `requested` entry is excluded from the per-message log rendered in the UI, so the displayed status reflects the latest delivery lifecycle state.

- Updated dependencies [5c417d7]
  - @beesolve/auth-service@0.15.0

## 0.1.1

### Patch Changes

- 22f3dce: Fix the users page returning a 500. `Users.listAll()` queries the `reverse` GSI and validates each item against the full user schema (`email`, `type`, `createdAt`), but the index projected only the message/recipient stats attributes, so those fields were missing and every user record failed validation with "Malformed stored user record". The `reverse` GSI now also projects `email`, `type`, and `createdAt`.

  Note: applying this requires DynamoDB to recreate the `reverse` GSI (projection changes are not in-place), during which the index is briefly unavailable while it backfills.

  Also widened the email event consumer's `commonHeaderString` helper to tolerate SES events that omit `mail.commonHeaders`.

- Updated dependencies [b827446]
- Updated dependencies [22f3dce]
  - @beesolve/email-service@0.4.1

## 0.1.0

### Minor Changes

- Add `@beesolve/email-service-dashboard` — a prebuilt kit-on-lambda SvelteKit dashboard for viewing `@beesolve/email-service` delivery status. It ships a single `./cdk` construct (`EmailServiceDashboard`) that provisions the SSR Lambda behind CloudFront, wires `@beesolve/auth-service` email-code auth, provisions its own OTP `Emails`, and runs an event-ingest Lambda that projects the email delivery lifecycle (from EventBridge) into its own DynamoDB table — giving the UI durable, queryable message, status, and aggregate-stats data.
