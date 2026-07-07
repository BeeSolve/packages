---
"@beesolve/auth-service": minor
---

Split `Auth` CDK construct into `AuthGateway` (with API Gateway authorizer) and `AuthService` (standalone, no API Gateway). Add `./sessionAuthorizer` export with `SessionAuthorizer` class and `withSession` wrapper for in-process session verification. Extract shared authorize logic into `src/authorize.ts` and refactor CDK code into composable helper functions.
