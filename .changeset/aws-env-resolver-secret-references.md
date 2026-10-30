---
"@beesolve/aws-env-resolver": patch
---

Fix: env vars set from `secret.secretValueFromJson(key)` were emitted as the literal `{{resolve:secretsmanager:...}}` text. They are now emitted as secret mappings (with `jsonKey` when it differs from the env var name) and `config.secretId`, so the CLI fetches the real value. References that pin a version stage or id, or omit the JSON key, fail with a clear error.
