---
"@beesolve/action-tokens": minor
---

- Add `createNewWithThrottling` method — atomic transactional write of token + throttle record. Throws `TokenThrottledError` if cooldown window has not elapsed.
- Add `peek` method — read-only token inspection without decrementing `remainingUses`.
- Export `TokenThrottledError` class.
