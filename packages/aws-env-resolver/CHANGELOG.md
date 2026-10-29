# @beesolve/aws-env-resolver

## 0.3.0

### Minor Changes

- 54af02b: Support env vars built with `Fn::Join` from literal text and resources (for example a JSON string embedding a queue url): the CDK emitter writes a template mapping with `parts`, and the resolver concatenates the resolved values. Hand-written `.ts` configs may use `{ envVar, parts }` too, and `stackName` on a mapping is no longer dropped when loading a `.ts` config.

  The CDK emitter now reports every env var it cannot emit in a single error instead of stopping at the first one.

## 0.2.0

### Minor Changes

- 8c8703b: CDK emitter supports multiple stacks (same region): every stack with Lambda environment variables is emitted, `config.stackName` may be a list, and resource mappings may carry a `stackName`. `namespace` is removed from `AllowEnvResolutionProps` (it was unused), and `generateAndPersist` `path` is optional (default `aws-env.config.json`).

  `scope` also accepts an array of constructs (e.g. a list of stacks), and pseudo-parameter `Fn::Join` values such as default event bus ARNs are inlined as static env.

## 0.1.0

### Minor Changes

- 4e98ebd: Initial release: resolve local dev env from CloudFormation + Secrets Manager, cache non-secrets in the OS temp dir and secrets in the macOS keychain (interactive by default, optional `--trusted`), inject into a spawned command, and optionally emit the config from a CDK app via `./cdk`.
