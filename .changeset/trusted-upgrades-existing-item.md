---
"@beesolve/aws-env-resolver": patch
---

Fix: `--trusted` now upgrades a keychain item that was first stored without it.

- The trust list is only applied when the item is written, and the item used to be written only when it was missing. An item stored without `--trusted` therefore kept prompting on every run even after adding the flag. With `--trusted` the resolver now rewrites the item on every run, so the next run prompts once and later runs are silent.
- `--trusted` without a command now resolves, stores the item as trusted, and exits `0` (like `--purge`). Previously it failed with "a command is required".
