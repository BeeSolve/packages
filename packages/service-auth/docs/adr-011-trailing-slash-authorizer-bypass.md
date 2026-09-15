# ADR-011: Resistance to Trailing-Slash / Greedy-Route Authorizer Bypass

## Status

Accepted

## Date

2026-09-14

## Context

A security write-up ([_"I bypassed AWS API Gateway auth with a trailing slash. Got $12K bounty."_](https://theguptalog.blogspot.com/2026/04/i-bypassed-aws-api-gateway-auth-with.html)) describes an auth-bypass against an AWS HTTP API (v2) deployment. The attack chain is:

1. The API runs on **HTTP API (v2)**, which does greedy prefix path matching by default.
2. A request with a trailing slash (`GET /v1/accounts/`) matched the `/v1/accounts` route as a prefix. The Lambda authorizer ran and returned `Allow`, but the integration then executed on a rewritten path and the **authorizer context was dropped** — the downstream Lambda saw `userId: undefined`.
3. The backend **trusted `context.authorizer.userId` without re-validating it**, and an undefined `userId` fell through to a system/default account. This turned a routing quirk into unauthorized reads and even wire transfers.

`@beesolve/auth-service` targets HTTP API (v2) (see ADR-002) and exposes greedy `{proxy+}` catch-all routes, so it satisfies preconditions (1) and (2). This ADR records why the package does **not** satisfy precondition (3) — the step that causes damage — and what the residual risk surface is for consumers.

## Decision

The package treats a missing or dropped authorizer context as **unauthenticated**, never as a privileged default. This is enforced by two design choices that we commit to preserving:

1. **The authorizer emits an opaque, self-describing session, not a scalar identity.** `authorizer.ts` sets `context.session = JSON.stringify(session)`, where `session` is a discriminated union (`none | invalid | expired | valid`). There is no `context.authorizer.userId` for a rewrite to silently blank out. `userId` only exists _inside_ a `valid` session object.

2. **Context consumption fails closed.** `src/sessionContext.ts::getSessionContext()`:
   - returns `{ type: "none" }` when no authorizer context is present (exactly the article's "context dropped" scenario) — an unauthenticated marker, not a user;
   - otherwise Valibot-parses the `session` string against `sessionContextSchema`. A `valid` session whose `userId` is missing/undefined **fails validation and throws**, rather than degrading to `userId: undefined`.

There is no code path anywhere in the package that maps a missing/undefined identity to a system, admin, or default account. The only hardcoded identity (`devValidSession`, `userId: "dev-user"` in `sveltekit.ts`) is gated behind `if (!isLambda)` and is unreachable in a deployed Lambda.

The standalone auth handler (`api.ts`) is not behind this authorizer at all — it sits behind an OAC-signed Function URL, dispatches on exact path equality (a trailing slash yields `NotFoundError`, not a fallthrough), and its authenticated endpoints re-derive the user from the session cookie against DynamoDB (`resolveSessionUserId`), throwing `UnauthorizedError` when the SID is absent.

## Rationale

### 1. Opaque session beats scalar identity

The article's victim exposed each authenticated attribute as a separate authorizer context key (`userId`). When the rewrite dropped the context, each key independently became `undefined`, and the backend had no single point at which to notice "the whole session is gone." By packing the entire session into one `session` blob with an explicit `type` discriminant, the absence of authentication is a first-class, testable state (`{ type: "none" }`) rather than a scatter of `undefined` fields.

### 2. Fail-closed validation removes the dangerous default

The damage in the article came from `undefined` being coerced into a system account. Valibot validation makes `undefined` unrepresentable for an authenticated session: either the context parses into a well-formed `valid` session with a real `userId`, or it does not parse and we throw. There is no third state that looks authenticated but carries no identity.

## Consequences

### Positive

- The damaging final step of the attack cannot occur: a dropped authorizer context degrades to "unauthenticated," never "system user."
- Consumers reading `event.locals.session` must branch on `session.type`; there is no `validSession.userId` to read on a `none`/`invalid`/`expired` session, so the failure mode is a visible unauthenticated branch rather than a silent privilege grant.

### Negative

- Consumers are still responsible for their own route topology. The package cannot prevent a consumer from mixing overlapping authorized and public routes on the same `HttpApi` in a way that greedy matching resolves to the wrong integration (see residual risk below).

## Residual Risk and Hardening

These are not exploitable as the article's privileged-default bypass, but they are the adjacent surface worth tightening.

### 1. Consumer route layout (highest priority, consumer-owned)

`addAuthorizedEndpoint` defaults to `/api/{proxy+}` (authorized) and `addPublicEndpoint` defaults to `/{proxy+}` (public). Both are greedy catch-alls with no trailing-slash normalization. If a consumer registers an authorized route and a _less specific_ public route on the same `HttpApi`, HTTP API's greedy matching can route a request to the public integration.

Guidance for consumers:

- Do not mix authorized and public `{proxy+}` routes that overlap on the same path prefix.
- Prefer distinct, non-overlapping path prefixes for public vs. authorized integrations.
- Because downstream handlers read `event.locals.session` and branch on `session.type`, a request that lands on a public integration is surfaced as `{ type: "none" }` — treat that as unauthenticated and reject rather than assuming the authorizer already gated it.

### 2. Broad `Allow` resource in `toIamPolicy` (package-owned)

`toIamPolicy` currently wildcards the resource to `<stage>/<method>/*`:

```ts
const resource = [...base, [...pathParts.slice(0, 2), "*"].join("/")].join(":");
```

Combined with authorizer result caching (default `balanced` = 45s, `relaxed` = 1h), an `Allow` for one path grants a wildcard `Allow` on that method for the cache window. This is _not_ a privilege-escalation vector here because downstream code re-derives identity from the validated `session` blob rather than trusting the ARN — but it is broader than necessary.

Resolution is tracked in **ADR-012 (Proposed)**: scope the `Resource` to the actual requested `methodArn` so the cached decision applies only to the path that was authorized. The trade-off is reduced authorizer-cache granularity for long-TTL consumers; see ADR-012 for the full impact analysis and implementation plan.

### 3. No trailing-slash normalization (accepted)

The package intentionally does not normalize trailing slashes. `api.ts` dispatches on exact equality, so a trailing slash there fails closed (`NotFoundError`). For gateway-routed handlers, normalization is a consumer/framework concern (SvelteKit routing). We accept this rather than adding a normalization layer that could mask, rather than fix, route-overlap mistakes.

## Alternatives Considered

### Expose `userId` (and other fields) as individual authorizer context keys

Rejected. This is precisely the shape that made the article's attack damaging: individual keys silently become `undefined` when context is dropped, with no single point to detect a missing session. The opaque `session` blob with an explicit `type` is safer.

### Add trailing-slash normalization inside the package

Rejected as a general fix. Normalizing paths at the authorizer or handler layer would hide route-overlap misconfigurations instead of surfacing them, and correct behavior depends on the consumer's framework. Fail-closed session handling plus clear route-layout guidance is more robust.

### Switch to REST API (v1) for stricter path matching

Rejected, consistent with ADR-002: higher per-request cost, no native JWT support, and the project is standardized on HTTP API (v2). The fail-closed context handling already neutralizes the attack's impact, so the gateway change is unnecessary.

## References

- Original write-up: [I bypassed AWS API Gateway auth with a trailing slash. Got $12K bounty.](https://theguptalog.blogspot.com/2026/04/i-bypassed-aws-api-gateway-auth-with.html) — content summarized/paraphrased for compliance with licensing restrictions.
- ADR-002: SSR Apps Cannot Use Cached Lambda Authorizer (HTTP API `identitySource` behavior).
- ADR-004: CloudFront Function Ensure-Cookie (placeholder cookie so the authorizer always runs).
- `authorizer.ts` (`toIamPolicy`), `src/sessionContext.ts` (`getSessionContext`), `api.ts` (`resolveSessionUserId`), `sveltekit.ts` (`devValidSession` gating).
