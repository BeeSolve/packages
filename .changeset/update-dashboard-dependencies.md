---
"@beesolve/analytics-dashboard": patch
"@beesolve/dmarc-dashboard": patch
"@beesolve/email-service-dashboard": patch
---

Update dependencies. Bump `kit-on-lambda` to `^1.1.2`, which generates a Lambda
handler that imports `@beesolve/lambda-function-url-protection/runtime`; that
package is now declared as a dependency so the adapter's bundle resolves it.
Also refreshes `vite` to `^8.3.4`.
