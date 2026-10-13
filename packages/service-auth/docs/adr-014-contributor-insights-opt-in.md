# ADR-014: Contributor Insights Opt-In

## Status

Accepted

## Decision

The `contributorInsights` prop on `AuthGateway` and `AuthService` now defaults to `false` for every stage. Previously it defaulted to `true` whenever `stage === "prod"` (`props.contributorInsights ?? isProd`); it is now `props.contributorInsights ?? false`. Enabling Contributor Insights is an explicit, per-deployment opt-in that applies regardless of stage, so a caller can turn it on for prod, non-prod, or both as needed.

The prop still threads through to the same DynamoDB tables as before - the local `Sessions` and `Accounts` tables and the composed `ActionTokens` table - via `contributorInsightsSpecification: enabled ? { enabled: true } : undefined`. Only the default changed; the wiring did not.

## Context

CloudWatch Contributor Insights for DynamoDB bills per DynamoDB item event rather than as a flat fee. On the tables this service owns (sessions, accounts, action tokens), the per-event charge can exceed the cost of the rest of the service's infrastructure, which is otherwise serverless and on-demand (Lambda, API Gateway, on-demand DynamoDB).

The previous default silently enabled Contributor Insights on all three tables for every prod deployment. Because the feature is a diagnostic aid - it helps spot hot partition keys and access-pattern anomalies - and not a correctness or security requirement, having it on by default meant prod deployments paid a recurring, often dominant cost for a tool most of them never consult.

The `ActionTokens` construct that this service composes already treats Contributor Insights as opt-in (`@default false`). The prod-on default in `service-auth` was the outlier.

## Rationale

### 1. Cost should not scale silently with traffic

An on-demand, serverless auth service is expected to cost roughly in proportion to use, dominated by Lambda and DynamoDB request charges. A per-event Contributor Insights charge on the busiest tables (sessions are written on every sign-in and session rotation) breaks that expectation and can become the largest line item, for a feature that produces no user-facing behavior.

### 2. Diagnostics are opt-in by nature

Contributor Insights answers "which keys are hot?" - a question you ask while investigating a specific problem, not continuously in steady state. It is cheap to enable on demand (and the prop makes that a one-line change per deployment) and expensive to leave on indefinitely. Defaulting it off matches how the tool is actually used.

### 3. Consistency with the composed construct

`ActionTokens` already defaults `contributorInsights` to `false`. Aligning `service-auth`'s default removes a surprising inconsistency where composing the same prop produced different behavior depending on which construct resolved it.

### 4. Stage is the wrong axis for this decision

Tying the default to `isProd` conflated "this is production" with "I want per-event access-pattern telemetry." Those are independent choices: a team may want Insights on a load-test non-prod stage and not want it on a low-traffic prod stage. A single explicit boolean, stage-independent, expresses that directly.

## Consequences

Positive:

- Prod deployments no longer incur Contributor Insights charges unless the operator opts in, removing what was often the dominant cost line.
- The default now matches the composed `ActionTokens` construct, so the prop behaves consistently across the stack.
- Enabling Insights is still a single prop (`contributorInsights: true`) and can be scoped to any stage.

Negative:

- Existing prod deployments that relied on the implicit default will lose Contributor Insights on their next deploy. This is a visible change in deployed infrastructure (the `contributorInsightsSpecification` is removed from the tables) and must be called out in the changeset so operators who want it can set `contributorInsights: true` explicitly.
- Hot-key diagnosis in prod now requires enabling the prop and redeploying first, rather than the data already being collected. This is accepted: the data is only useful during an active investigation, and the cost of always-on collection outweighs the convenience.

## Alternatives Considered

### Keep the prod-on default

Leave `?? isProd` in place. Rejected because it makes the single largest cost driver implicit and invisible, and because the diagnostic value does not justify a continuous per-event charge on every prod deployment.

### Add a separate per-stage shape (e.g. `{ prod?: boolean; nonProd?: boolean }`)

Expose richer configuration so callers can set prod and non-prod independently in one prop. Rejected as unnecessary: the construct is instantiated per deployment with a known `stage`, so a single stage-independent boolean already lets each deployment opt in or out. A structured prop would add API surface for a distinction the caller already controls by which stage they deploy.

### Default off only for non-prod, keep prod-on

Rejected because prod is precisely where the per-event cost is highest (highest traffic), so an opt-out-only-for-non-prod default would leave the expensive case unaddressed.

## References

- `packages/action-tokens/cdk.ts` - the composed construct whose `contributorInsights` default (`false`) this change aligns with.
- `packages/service-auth/cdk.ts` - `CoreProps.contributorInsights` and the `AuthGateway` / `AuthService` constructor defaults.
