# ADR-002: Opt-In Enforcement by Environment

## Status

Accepted (supersedes the "fail-closed only" rationale in ADR-001 section 1)

## Context

ADR-001 specified that the runtime wrappers are fail-closed in all cases: if `ORIGIN_TOKEN` is unset or empty, every request is rejected. That stance assumed the wrapped handler only ever runs behind the token-protected Function URL, so a missing token could only mean a misconfiguration.

That assumption does not hold for a handler that is shared across deployment shapes. In `kit-on-lambda`, a single handler file is deployed behind two kinds of origin:

- the default Function URL origin created by `protectedFunctionUrlOrigin`, which sets `ORIGIN_TOKEN` and sends the `x-origin-token` header from CloudFront; and
- an overridden origin (for example an API Gateway origin, or an IAM-authorizer-fronted Lambda) that deliberately does not use the token mechanism and never sets `ORIGIN_TOKEN`.

With the original fail-closed-when-unset behavior, wrapping the shared handler broke every non-token deployment: with no `ORIGIN_TOKEN` in the environment, the wrapper rejected all traffic with a 403. The integration test for the API Gateway configuration surfaced this directly.

## Decision

Make enforcement opt-in by the presence of the token in the environment:

- When `ORIGIN_TOKEN` is set to a non-empty value, enforce the token. This remains fail-closed: a missing or mismatched `x-origin-token` header is rejected with a 403.
- When `ORIGIN_TOKEN` is unset or empty, pass the request through to the wrapped handler unchanged.

The presence of the environment variable is the signal that the token mechanism is in use for this deployment. `protectedFunctionUrlOrigin` sets it; a non-token origin does not.

## Rationale

### 1. One handler, many origins

A shared handler must behave correctly behind both a token-protected origin and a non-token origin. Gating on `ORIGIN_TOKEN` lets the same code do both without the handler needing to know which origin fronts it. The CDK side already encodes that choice by setting (or not setting) the environment variable.

### 2. Enforcement is still fail-closed where it matters

The security property that ADR-001 cared about is preserved: on a deployment that uses the token (`protectedFunctionUrlOrigin` set `ORIGIN_TOKEN`), a request that reaches the Function URL without the correct header is still rejected. Opt-in only changes the behavior for deployments that never opted in.

### 3. The environment variable is a deliberate, server-side signal

`ORIGIN_TOKEN` is set by infrastructure code at deploy time, not by the caller. A request cannot cause enforcement to turn off; only the deployment configuration can. This keeps the gate out of reach of an attacker hitting the endpoint.

## Consequences

- The same handler file can be wrapped unconditionally and deployed behind any origin. Token-protected origins enforce; others pass through.
- A genuine misconfiguration on a token-protected deployment (the environment variable dropped) now fails open rather than closed for that deployment. This is the accepted trade-off for supporting shared handlers; the CDK helper and the environment variable are set together, so dropping only the variable is unlikely. Deployments that require hard fail-closed semantics regardless should assert `ORIGIN_TOKEN` is present at startup.
- ADR-001 section 1 ("Fail-closed only") no longer describes the behavior; this ADR does.

## Alternatives Considered

### Keep strict fail-closed and ship separate protected and unprotected handler variants

Maintain two handler files (or a build flag) so the protected variant is only used behind the Function URL. Rejected because it doubles the handler surface and pushes the origin choice into the handler layer, when the CDK side already expresses that choice. The environment-variable gate keeps a single handler and a single source of truth.

### Add an explicit boolean option to the wrappers instead of reading the environment

Pass something like `{ enforce: true }` to `protectFetch` / `protectHandler`. Rejected because the consumer would have to thread the same deploy-time knowledge (is this the token origin?) into the handler by hand, re-creating the drift risk ADR-001 set out to remove. Reading `ORIGIN_TOKEN` ties enforcement to the exact signal the CDK helper controls.
