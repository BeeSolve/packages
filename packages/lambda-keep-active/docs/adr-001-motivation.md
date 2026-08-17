# ADR-001: Why This Package Exists

## Status

Accepted

## Context

AWS Lambda functions that receive no invocations for approximately 14 days transition to an "inactive" state. Reactivation from this state causes cold starts of up to 90 seconds — catastrophic for user-facing endpoints where a user might be the first visitor in weeks.

This is distinct from the well-known cold start problem (new execution environments spinning up under load). Provisioned concurrency addresses scaling cold starts but does nothing about inactivity-based deactivation. AWS does not provide a native setting to prevent this.

For small projects — personal tools, internal dashboards, early-stage products — going 14 days without traffic is normal. These are exactly the projects that can least afford a 90-second response time when a user finally does visit.

## Decision

Build a CDK construct that:

- Periodically invokes specified Lambda functions (every 3 days) to prevent them from becoming inactive
- Provides handler wrappers (`keptActive`, `keptActiveFetch`) that short-circuit keep-alive invocations immediately (no application logic executed, minimal cost)

## Rationale

### 1. The problem is invisible until it hurts

Most developers don't know about the inactive state until a user reports a 90-second page load. By then the damage (lost user, bad impression) is done. A preventive measure that costs effectively nothing is better than debugging a mystery timeout weeks later.

### 2. Minimal cost, maximal impact

One invocation every 3 days per function costs fractions of a cent per month. The handler wrapper adds ~1ms overhead to detect keep-alive events. The cost/benefit ratio is extreme.

### 3. Handler wrappers ensure no side effects

The keep-alive invocation must not trigger actual application logic (database writes, external API calls, email sends). The wrapper pattern detects the keep-alive event shape and returns immediately before any application code runs.

## Consequences

- Protected functions never go inactive, eliminating the 90-second reactivation cold start.
- Adds a scheduled EventBridge rule + tiny invoker Lambda to the stack per set of protected functions.
- Does not solve scaling cold starts — only inactivity deactivation. Projects with strict latency requirements under load still need provisioned concurrency.
- Every protected Lambda handler must be wrapped with `keptActive`/`keptActiveFetch` — forgetting the wrapper means the keep-alive invocation executes real application logic.

## Alternatives Considered

### Provisioned concurrency

Not a solution to this problem. Provisioned concurrency keeps execution environments warm for traffic spikes but costs significantly more (you pay for idle compute). It also doesn't address the specific "14 days of zero traffic" deactivation.

### CloudWatch synthetic monitoring / uptime checks

Could work for HTTP-accessible Lambdas behind API Gateway or function URLs, but doesn't work for event-driven Lambdas (SQS consumers, EventBridge targets) and adds unnecessary network hops. A direct invocation is simpler and more reliable.

### Accept the cold start

Rejected. 90 seconds is not an acceptable response time for any user-facing endpoint. The cost of prevention is near-zero.
