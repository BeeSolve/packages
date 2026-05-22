---
"@beesolve/auth-service": minor
---

Security hardening based on OWASP Top 10:2025 review:

- **[Critical]** Fix open redirect via unvalidated `redirectTo` — decode + validate against `^/(?!/)`
- **[High]** Add `requireSessionV1`/`requireSessionV2` middleware and `withDevSession` dev helper
- **[High]** Add authorizer cache presets (`immediate`/`balanced`/`relaxed`) — default changed from 1h to `balanced` (45s)
- **[Medium]** Add optional WAF rule group for rate limiting (`waf` prop)
- **[Medium]** Reduce OTP `remainingUses` from 10 to 3
- **[Low]** Emit `UnsuccessfulAuth` event from `signInComplete`
- **[Low]** Replace `catch(asNull)` in sign-out with SQS retry for eventual session deletion
- **[Low]** Restrict CORS to `frontendUri` with explicit allowed headers
- **[Low]** Change `__Host-DataToken` to `SameSite=Strict`
- **[Low]** Remove validation error details from response (log server-side only)
- **[Low]** Add schema validation per type branch in `sdkHandler`
- **[Low]** Add `sessions.deleteAllForUser` and expose via SDK (`deleteAllSessions` command)
- **[Low]** Add origin verification token for CloudFront → Lambda

### Breaking changes

- `authorizerCacheTtl` prop replaced with `authorizerCache` (preset string or `Duration`)
- Default authorizer cache changed from 1h to 45s
- CORS no longer allows all origins — `frontendUri` is now required and used
- `UnsuccessfulAuth` event detail changed from `{ userId }` to `{ emailAddress, reason }`
- `ORIGIN_TOKEN` env var now required (auto-injected by CDK construct)
- SQS queue now always created (new `BEESOLVE_TASKS_MAIN_QUEUE_URL` env var)
