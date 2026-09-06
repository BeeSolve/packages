---
"@beesolve/auth-service": minor
"@beesolve/email-service-dashboard": minor
"@beesolve/dmarc-dashboard": minor
---

Scope auth EventBridge events per application to prevent cross-app OTP email cross-talk.

`AuthGateway`/`AuthService`:

- New optional `appId` prop — the only knob. When set, the auth event `source` becomes `beesolve.auth.<appId>` instead of the default `beesolve.auth.api`, so two apps sharing an event bus no longer both receive each other's `EmailCodeAuth` events. The source string is computed once by the construct, exposed as the public `eventSource` field, and injected into the auth handler as `EVENT_SOURCE`.
- Expose the resolved `eventSource` and the resolved `eventBus` (`IEventBus`) as public fields so consumers can subscribe to the exact source and bind rules to the exact bus the deployment uses.
- No exported source helpers and no explicit `eventSource` input prop — the source format lives in a single place.

`EmailServiceDashboard` / `DmarcDashboard`:

- Their auth-events rule binds to `props.auth.eventBus` and filters on `props.auth.eventSource`, so it matches whether the auth deployment uses the default bus, a custom bus (`eventBusArn`), and/or a distinct `appId`. Previously the rule was hardcoded to `source: ["beesolve.auth.api"]` on the default bus, which silently stopped delivering OTP emails when auth was moved to a custom bus.
- `EmailServiceDashboard` drops its `eventBusName` prop. SES configuration-set event destinations can only target the account `default` bus, so the email-events rule (and the internal `Emails` construct) must stay on `default`; auth isolation is configured via the `auth` construct instead. Isolate the dashboard's own sign-in flow by giving its `AuthGateway` a dedicated `eventBusArn` (and/or `appId`); the displayed delivery-status events continue to arrive on the default bus.
