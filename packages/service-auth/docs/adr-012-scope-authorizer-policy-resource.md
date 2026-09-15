# ADR-012: Scope Authorizer Policy Resource to the Requested Route

## Status

Proposed

> Not yet implemented. This ADR records the plan and rationale for later execution.
> It is low-risk hardening, not an urgent fix — see ADR-011 for why the current
> wildcard is not exploitable.

## Date

2026-09-14

## Context

`authorizer.ts::toIamPolicy` currently rewrites the incoming `methodArn` into a
method-wide wildcard resource:

```ts
const parts = methodArn.split(":");
const base = parts.slice(0, 5);
const pathParts = parts.at(5)?.split("/") ?? [];
const resource = [...base, [...pathParts.slice(0, 2), "*"].join("/")].join(":");
```

Authorizing `GET /api/users` therefore returns an `Allow` for `<stage>/GET/*`.
Combined with authorizer result caching (default `balanced` = 45s, `relaxed` =
1h), one successful authorization grants a method-wide `Allow` for the whole
cache window.

This is **not** exploitable as a privilege-escalation vector (see ADR-011):
downstream handlers derive identity from the validated `session` blob, never
from the policy ARN, and nothing in the package reads `policyDocument` /
`Resource`. But the wildcard is broader than necessary — a cached decision
applies to paths that were never individually authorized.

## Decision

Scope the returned policy `Resource` to the exact requested `methodArn` instead
of a `<stage>/<method>/*` wildcard. In practice this means returning `methodArn`
directly as the resource rather than reconstructing it with a trailing `*`.

Keep the response an IAM-policy response (unchanged shape); only the `Resource`
value narrows.

## Rationale

- A cached `Allow` should apply only to the path that was actually authorized,
  not to every path on the same HTTP method for the cache TTL.
- Shrinks the blast radius of a cached decision: session invalidation / sign-out
  affects a narrower resource set per cache entry.
- No downstream code depends on the wildcard (verified: `event.methodArn` is only
  an input to `toIamPolicy`; no consumer reads the policy or the ARN).

## Consequences

### Positive

- No method-wide wildcard `Allow` persists in the authorizer cache for up to an hour.
- No security regression; no code-level breaking change (function signature and
  response shape are unchanged).

### Negative — reduced cache hit rate (the main trade-off)

HTTP API caches the authorizer policy keyed on `identitySource`
(`$request.header.Cookie`) and evaluates the cached policy's `Resource` against
the current request's route ARN.

- **Today:** one authorization for a cookie serves same-cookie requests to _any
  path on that method_ within the TTL.
- **After:** the cached `Allow` matches a single path, so a same-cookie request
  to a _different_ path re-invokes the authorizer Lambda.

Net: more authorizer invocations (one per distinct path rather than one per
method) and a small first-request latency bump per new path, for consumers on
`balanced`/`relaxed` TTLs. Cost impact is minor (256MB, fast-resolving Lambda)
but non-zero and scales with path fan-out per window.

Impact by consumer:

- `authorizerCache: "disabled"` / `"immediate"` (TTL 0): **no change** — never
  cached (includes the SSR pattern in ADR-002).
- `"balanced"` (45s) / `"relaxed"` (1h): higher authorizer invocation count;
  mitigate a specific high-fan-out consumer with a shorter TTL rather than
  re-widening the policy.

## Implementation Plan

1. Edit `authorizer.ts::toIamPolicy` to use the exact `methodArn` as the policy
   `Resource` (remove the `pathParts.slice(0, 2)` + `*` reconstruction).
2. Add a test in `packages/service-auth/tests/` asserting the returned `Resource`
   equals the input `methodArn` for both the `Allow` (valid) and error/`invalid`
   paths — there is currently no test coverage on the policy resource shape.
3. Update ADR-011's "Residual Risk and Hardening" §2 to reference this ADR as the
   chosen resolution.
4. Add a changeset for `@beesolve/auth-service` (minor bump — cache behavior
   observably changes; API is backward-compatible). Verify the package name in
   `package.json` is `@beesolve/auth-service` before writing the changeset.
5. Run `bun test` and `bun run lint`.

## Alternatives Considered

### Keep the wildcard for cache efficiency

Rejected as the default. The broad cached `Allow` is unnecessary given identity
is re-derived from the `session` blob. Consumers who genuinely need wide-path
cache reuse can keep a short TTL instead of relying on a wildcard resource.

### Switch to a simple boolean (`isAuthorized`) response

Rejected. That changes the authorizer response contract and loses the ability to
scope resources at all; it also interacts with the `session` context we already
depend on. Out of scope for this hardening.

## References

- ADR-011: Resistance to Trailing-Slash / Greedy-Route Authorizer Bypass
  (why the current wildcard is not exploitable; this ADR resolves its §2).
- ADR-002: SSR Apps Cannot Use Cached Lambda Authorizer (cache/`identitySource` behavior).
- `authorizer.ts::toIamPolicy` — the function to change.
