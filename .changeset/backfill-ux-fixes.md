---
"@beesolve/dmarc-consumer": patch
"@beesolve/dmarc-dashboard": patch
---

Fix the IP-details backfill and improve the dashboard.

- `dmarc-consumer`: the first backfill on a fresh table always failed with
  "already running" because `startRun` assigned into a nested `domains` map that
  was never seeded. The map is now seeded idempotently before the guarded
  transaction. `BackfillSdk.start` no longer treats every
  `TransactionCanceledException` as already-running — it inspects the
  cancellation reasons and only reports already-running on a genuine
  conditional-check failure, rethrowing real errors. A `started` run older than
  the worker's max lifetime is now treated as re-runnable so a crashed or
  timed-out worker no longer pins a domain forever. Also removed the unused
  `Backfill.putRunHistory` and the unused `BackfillSdk.complete`/`fail` methods,
  extracted a shared `toDynamoClient`, and dropped unused ipinfo response fields.
- `dmarc-dashboard`: the backfill button is renamed to "Refresh IP details" with
  clarifying help text, restyled to match the app, and disabled while its request
  is in flight. The domain detail page groups Source IPs, Authorized senders, and
  Reports into tabs and uses a stable card grid. The date calendar now navigates
  months correctly, disables future days, and clearly distinguishes today, the
  selected day, and disabled days.
