---
"@beesolve/dmarc-consumer": patch
---

Fix: `DmarcConsumer.grantTasks` now also sets `REVERSE_INDEX_NAME` on the grantee. The tasks module reads `REVERSE_INDEX_NAME` at load (it instantiates `Domains` for the DNS-refresh worker), so any Lambda enqueuing tasks — notably the dashboard SSR handler, which imports `AdminSdk` — would otherwise crash on cold start with a Valibot "Expected REVERSE_INDEX_NAME but received undefined" error.
