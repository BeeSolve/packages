---
"@beesolve/auth-service": minor
---

Add `sessionRefreshInterval` prop to `AuthGateway` and `AuthService` constructs. The authorizer now skips session rotation when the current session is younger than the configured interval (default: 1 hour), reducing unnecessary DynamoDB writes while still running the authorizer on every request.
