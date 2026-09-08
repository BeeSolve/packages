---
"@beesolve/email-service-dashboard": patch
---

Rebuild the per-recipient timeline on the message detail page using graffiti's built-in `.timeline` component instead of a hand-rolled layout.

- Each entry is now a graffiti timeline item with a small tone-coloured marker on a single continuous connector line (success/error/warning/info mapped from the event status).
- The status badge, timestamp, and detail sit inline on a single row, so graffiti's marker alignment keeps the dot level with the badge. This fixes the earlier misaligned dots, doubled connector lines, and mid-word text wrapping caused by custom timeline CSS colliding with graffiti's own `.timeline` rules.
- Removed the redundant "(at …)" timestamp from each detail line — the entry timestamp is already shown on the row.
- Also added the `DASHBOARD_REQUESTS_BUCKET` entry to `.env.local.example`.
