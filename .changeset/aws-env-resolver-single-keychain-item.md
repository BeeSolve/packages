---
"@beesolve/aws-env-resolver": minor
---

BREAKING: store all secrets in one keychain item instead of one item per secret env var.

- The macOS keychain holds a single generic-password item per `{ projectKey, stage, fingerprint }` whose value is a JSON object of every secret. A read costs one keychain access, so macOS prompts once per run (or never with `--trusted`) no matter how many secrets there are.
- If the stored item lacks a configured secret, all secrets are refetched and the item is rewritten.
- `purgeCache` no longer takes `secretKeys`; it deletes the single item. Items written by earlier versions are not read and not deleted; remove them from Keychain Access (service `aws-env-resolver:<projectKey>:<stage>:<fingerprint>`) if you want them gone. The next run refetches the secrets once.
