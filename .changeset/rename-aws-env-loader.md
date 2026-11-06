---
"@beesolve/aws-env-loader": minor
---

BREAKING: renamed from `@beesolve/aws-env-resolver` to `@beesolve/aws-env-loader`.

- Install `@beesolve/aws-env-loader` and remove `@beesolve/aws-env-resolver`. Import paths change to `@beesolve/aws-env-loader` and `@beesolve/aws-env-loader/cdk`.
- The CLI is now `aws-env-loader`. Replace `aws-env-resolver` in your scripts; flags are unchanged.
- The library API is unchanged (`resolveEnv`, `ResolverConfig`, `purgeCache`, ...).
- The cache directory and keychain service prefix follow the new name, so cached values are not reused. Each stage refetches once; run `aws-env-loader --stage <stage> --trusted` again if you used trusted mode. Old keychain items (service `aws-env-resolver:...`) can be removed from Keychain Access.
