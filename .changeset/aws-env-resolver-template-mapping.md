---
"@beesolve/aws-env-resolver": minor
---

Support env vars built with `Fn::Join` from literal text and resources (for example a JSON string embedding a queue url): the CDK emitter writes a template mapping with `parts`, and the resolver concatenates the resolved values. Hand-written `.ts` configs may use `{ envVar, parts }` too, and `stackName` on a mapping is no longer dropped when loading a `.ts` config.

The CDK emitter now reports every env var it cannot emit in a single error instead of stopping at the first one.
