---
"@beesolve/aws-env-resolver": minor
---

CDK emitter supports multiple stacks (same region): every stack with Lambda environment variables is emitted, `config.stackName` may be a list, and resource mappings may carry a `stackName`. `namespace` is removed from `AllowEnvResolutionProps` (it was unused), and `generateAndPersist` `path` is optional (default `aws-env.config.json`).

`scope` also accepts an array of constructs (e.g. a list of stacks), and pseudo-parameter `Fn::Join` values such as default event bus ARNs are inlined as static env.
