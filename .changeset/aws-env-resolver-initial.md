---
"@beesolve/aws-env-resolver": minor
---

Initial release: resolve local dev env from CloudFormation + Secrets Manager, cache non-secrets in the OS temp dir and secrets in the macOS keychain (interactive by default, optional `--trusted`), inject into a spawned command, and optionally emit the config from a CDK app via `./cdk`.
