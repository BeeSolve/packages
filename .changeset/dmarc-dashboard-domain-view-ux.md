---
"@beesolve/dmarc-dashboard": minor
---

Clean up the domain detail view and its setup-health presentation.

- The "Refresh DNS" and "Refresh IP details" controls move into a single vertical-dots (⋮) actions menu in the top-right of the domain view. Each item carries a short inline explanation and its last-run status, and opens a proceed/cancel confirmation dialog before enqueuing the background refresh. The header no longer surfaces these secondary actions as prominent buttons.
- Before a domain's DNS has ever been checked, the setup-health area no longer shows misleading "No DMARC record found" / "No SPF record found" findings. Instead it renders a neutral "DNS not checked yet" onboarding state with an inline "Check DNS" action, while report-derived findings (e.g. spoofing blocked) still show. Empty DNS metric chips are hidden until DNS is read.
- Setup-health is now presented in its own card panel, and the advisory findings align their severity pills and text into a consistent column.
- The raw-report JSON dialog no longer overlaps its close and Copy buttons, and Copy now shows a transient "Copied" confirmation.
- Wide data tables keep a stable scrollbar gutter and, on narrow screens, show a "scroll →" hint.
