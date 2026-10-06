---
"@beesolve/action-tokens": patch
---

`TokenThrottledError` now carries `retryAfterSeconds`, the number of seconds until the throttle window clears.

When `createNewWithThrottling` is rejected by an active throttle, the error exposes `retryAfterSeconds` (computed from the existing throttle record's `expiresAt`), so callers can surface an accurate retry delay. The field is `undefined` when the remaining window cannot be determined.
