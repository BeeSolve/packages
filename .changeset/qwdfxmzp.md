---
"@beesolve/sqs-handler": patch
---

Fix floating promises in queued function invocations

- `localInvocation` mode now properly awaits the handler function
- SQS `send()` is now awaited, ensuring message delivery errors are caught
