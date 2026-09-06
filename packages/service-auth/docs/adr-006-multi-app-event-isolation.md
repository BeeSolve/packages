# ADR-006: Multi-App Event Isolation

## Status

Accepted

## Context

`@beesolve/auth-service` publishes all auth events (including `EmailCodeAuth`,
which carries the sign-in OTP) to EventBridge. By default events go to the
account `default` bus with source `beesolve.auth.api`. Consumers subscribe with a
`Rule` whose `eventPattern` filters on `source` + `detailType`.

EventBridge rules are a broadcast model: every rule on a bus whose pattern matches
an event fires independently. When two applications deploy on the same AWS account
and both:

1. publish to the `default` bus, and
2. leave the source at the default `beesolve.auth.api`, and
3. each register a rule matching that source + `EmailCodeAuth`,

then a single sign-in in one app matches **both** rules. Each app's consumer sends
its own OTP email, so the user receives a code from every app. The event `detail`
has no application/tenant/client identifier, so EventBridge cannot route
selectively without an additional discriminator. This ADR records how apps are
meant to be isolated.

## Decision

Support two isolation mechanisms and document both. Neither is mandatory — the
default (shared bus, shared source) is retained for the common single-app case.

1. **Separate event bus.** Pass `eventBusArn` to the auth construct so its events
   publish to a dedicated bus, and create the consumer `Rule` on that same bus
   (`new Rule(this, ..., { eventBus })`). Events never reach rules on another bus.
   The construct exposes the resolved bus as `auth.eventBus` so consumers bind to
   the correct bus without duplicating the resolution logic.

   **SES limitation:** this option applies only to auth events (plain
   `EventBridge.putEvents`). SES delivery events (`aws.ses`) emitted by
   `@beesolve/email-service` can only target the account `default` bus — SES
   configuration-set event destinations reject custom buses. Any consumer of
   `aws.ses`/`beesolve.email.api` events must keep its rule on the default bus.

2. **Distinct source via `appId`.** An optional `appId` prop makes the event
   source `beesolve.auth.<appId>` (otherwise `beesolve.auth.api`). The construct
   computes this string once, exposes it as the public `eventSource` field (which
   consumers match in their rule pattern), and injects it into the auth handler as
   the `EVENT_SOURCE` env var. The runtime publisher uses that value verbatim. There
   is no exported helper and no explicit `eventSource` input prop — `appId` is the
   only knob, and the source-string format lives in exactly one place (the construct).

## Rationale

### 1. `source` is the right discriminator, not `detail` fields

EventBridge is optimized to filter on the top-level `source` + `detail-type`.
Routing on a nested `detail` field (e.g. `baseUri`) is possible but couples
routing to payload data that can legitimately change, and overloads a field whose
purpose is informational (locale/link building). Keeping the discriminator in
`source` keeps routing cheap and self-evident.

### 2. `appId` over a raw source string

Exposing a full `eventSource` input would force each app to invent and keep in
sync a source string on both the publisher and every consumer. `appId` is a single
short identifier that the construct deterministically composes into the source
(`beesolve.auth.${appId ?? "api"}`) in one place, then injects to the handler and
exposes for consumer rules — no drift, no helper, no hand-built strings. There is
no explicit `eventSource` input prop; `appId` is the sole knob.

### 3. Two mechanisms, not one

The separate-bus option needs no new package version and can be applied
immediately to an existing deployment. The `appId` option is lighter (shared bus,
no extra infra) but ships in a new version. Keeping both lets teams pick based on
whether they want hard bus-level isolation or a lightweight source split.

## Consequences

- Backward compatible: apps that set neither `appId` nor `eventBusArn` keep the
  `default` bus and `beesolve.auth.api` source — existing behavior is unchanged.
- Bundled `EmailServiceDashboard` and `DmarcDashboard` now subscribe to
  `props.auth.eventSource` and bind their auth rule to `props.auth.eventBus`
  instead of a hardcoded string on the default bus, so they follow the auth
  deployment's configuration automatically (custom bus and/or `appId`).
- `EmailServiceDashboard` no longer accepts an `eventBusName` prop: its
  email-events rule must stay on the default bus (SES limitation), and its own
  `Emails` construct publishes there too. The auth side is configured through the
  `auth` construct's `eventBusArn`/`appId` instead.
- Consumers using the separate-bus option must remember to bind their `Rule` to
  the custom bus; a rule left on `default` will silently receive nothing.
- Two documented paths is slightly more surface area to explain, mitigated by the
  how-to guide describing when to use each.

## Alternatives Considered

### Add an `appId`/`tenantId` field to the event detail

Rejected as the primary mechanism: it forces a schema change across publisher,
consumer, and Valibot validation, grows every payload, and reintroduces the risk
of an app forgetting to populate it (silently colliding) — whereas a missing
`source`/bus is visibly the default rather than an ambiguous collision. Content
filtering on `detail` is also a less natural EventBridge routing key than `source`.

### Route on `baseUri`

Rejected: `baseUri` is informational, may change, and an app can have more than
one origin. Using it for routing overloads its purpose.

### Exported `authEventSource()` helper + runtime recomputation

An earlier iteration exported an `authEventSource(appId?)` helper and a
`defaultAuthEventSource` constant, and had the runtime recompute the source from an
injected `APP_ID`. Rejected: it duplicated the source-string format across the
construct and the runtime, and added public API surface consumers had to import.
The final design computes the string once in the construct and injects the resolved
`EVENT_SOURCE`, so the format exists in exactly one place and the only public knob
is `appId`.

## References

- `docs/how-to/consuming-events.md` — "Isolating multiple apps on a shared account"
- `adr-auth-service-package-extraction.md` §7 (configurable EventBridge source)
