# @beesolve/email-service-dashboard

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
