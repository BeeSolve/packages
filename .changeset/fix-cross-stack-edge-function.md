---
"@beesolve/auth-service": minor
---

Fix cross-stack CloudFormation export error for Lambda@Edge version ARN. Add `createAuthBehavior(scope)` method to create the edge function within the consuming stack, avoiding export update conflicts. Fix session refresh drift check to compare against `createdAt` instead of `startedAt`.
