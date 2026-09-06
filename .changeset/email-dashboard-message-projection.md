---
"@beesolve/email-service-dashboard": patch
---

Fix the message projection so lifecycle events are recorded correctly.

- `requestId` is now written only on the `requested` event and is optional on read (defaults to `"unknown"`), so later lifecycle events no longer overwrite a real request id with `"unknown"`.
- The recipient and monthly query records are written only for non-`requested` events, matching the query schemas that back the message and recipient listings.
- The `requested` entry is excluded from the per-message log rendered in the UI, so the displayed status reflects the latest delivery lifecycle state.
