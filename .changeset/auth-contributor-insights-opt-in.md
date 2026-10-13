---
"@beesolve/auth-service": minor
---

Make DynamoDB Contributor Insights opt-in. The `contributorInsights` prop on
`AuthGateway` and `AuthService` now defaults to `false` for every stage instead
of `true` in prod. Contributor Insights bills per DynamoDB event and can exceed
the cost of the rest of the service's infrastructure, so it is now an explicit
opt-in that applies to prod and/or non-prod.

Migration: deployments that relied on the implicit prod-on default will lose
Contributor Insights on their next deploy (the `contributorInsightsSpecification`
is removed from the sessions, accounts, and action-token tables). To keep it,
set `contributorInsights: true` explicitly.
