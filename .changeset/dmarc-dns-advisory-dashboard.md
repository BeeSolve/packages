---
"@beesolve/dmarc-dashboard": minor
---

Add DNS setup guidance and reframe the pass-rate presentation.

- New "Setup health" panel on the domain detail page: plain-language findings derived from live DNS (DMARC policy, SPF qualifier and lookup count, DKIM selector presence) combined with observed report behaviour, plus a positively-framed "spoofing blocked" note. Degrades gracefully when DNS has not been read.
- A compact resolved-DNS summary with a "Refresh DNS" button that enqueues a background refresh (SSR only reads the cached DNS field — it never resolves DNS in the request path).
- The "Refresh IP details" control moves from the overview to the domain detail page, next to the Source IP table. Both refresh controls post a single default form action distinguished by a hidden `intent` field (no named actions, per the CloudFront/Lambda constraint).
- The overview drops the "Sender origins" column and no longer alarm-colours the disposition-based "pass rate". That metric is relabelled "Delivered / not actioned" and shown neutrally across the overview, domain detail, and single-report pages, so a heavily-spoofed domain that DMARC is correctly rejecting no longer reads as broken.
