---
"@beesolve/email-service-dashboard": patch
---

Address a round of dashboard feedback across the overview, messages list, and message detail views.

- Fix the per-recipient timeline showing every recipient's deliveries. The SES delivery consumer now fans out delivered events by `delivery.recipients` (the recipients that delivery notification actually covers) instead of `mail.destination` (all message recipients), so each recipient's timeline lists only its own delivery events.
- Remove the meaningless "Total" summary card (an on-the-fly sum of overlapping counters) from both the overview and recipient detail pages.
- Bound the messages list month picker by the setup completion date. The year/month selector no longer offers years before setup existed, months before the start month, or future months, and the previous-month arrow is disabled at the start month. Arrows now sit inline flanking the dropdowns on a single row.
- Replace the exact-match recipient search with a datalist-backed autocomplete populated from a new keys-only recipients endpoint, so recipients can be found without typing the full address.
- Restyle the message detail per-recipient timeline: normal-weight recipient headings, per-event markers on the rail, tighter spacing, and clearer separation between recipient sections.
