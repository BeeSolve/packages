---
"@beesolve/action-tokens": patch
"@beesolve/auth-service": patch
"@beesolve/cdk-constructs": patch
"@beesolve/cdk-email-alarms": patch
"@beesolve/dmarc-consumer": patch
"@beesolve/dmarc-dashboard": patch
"@beesolve/dmarc-parser": patch
"@beesolve/dmarc-reports": patch
"@beesolve/dynamo-helpers": patch
"@beesolve/email-service": patch
"@beesolve/email-service-dashboard": patch
"@beesolve/helpers": patch
"@beesolve/hmac": patch
"@beesolve/lambda-fetch-api": patch
"@beesolve/lambda-keep-active": patch
"@beesolve/lint-config": patch
"@beesolve/sqs-handler": patch
---

Publish agent-readable documentation inside the package tarball.

Each package now ships a `DOCS.md` index at its root and, for user-facing packages, how-to guides under `docs/how-to/`, so AI agents can read usage directly from `node_modules`. The `files` allowlist was extended to include `DOCS.md` (and `docs/how-to` for user-facing packages); ADRs remain unpublished. Every `DOCS.md` carries a keyword line for grep-based discovery, a directive to prefer the installed docs over prior knowledge, and absolute links to the GitHub repository for full working examples. No runtime code changed.
