---
"@beesolve/dmarc-dashboard": patch
"@beesolve/email-service-dashboard": patch
---

Add `@beesolve/lambda-keep-active` as a direct dependency.

The `kit-on-lambda` adapter generates a Lambda handler that imports `@beesolve/lambda-keep-active/runtime`. Without declaring the package as a dependency, esbuild fails to resolve the import during the production build under a clean install (as in CI), breaking the lambda bundle.
