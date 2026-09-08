# DMARC Domain View UX Cleanup

## Status: Complete

## Problem Statement

The deployed DMARC dashboard domain view (`packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`) has several UX problems reported after the latest release:

1. The domain view header is confusing. "Refresh DNS" is visually the most prominent control but is a secondary action. It — together with "Refresh IP details" (currently buried in the Source IPs tab) — should move into a vertical-dots (⋮) actions menu in the top-right corner, with an inline one-line explanation per item and a confirm dialog (proceed/cancel) carrying the fuller description.
2. The "Refresh IP details" button in the Source IP Analysis section is clunky and (separately) appears not to work. Relocating it into the ⋮ menu is in scope; **diagnosing why it does nothing is out of scope — the user will investigate that themselves.**
3. It is not obvious that the wide data tables scroll horizontally. Add a CSS-only right-edge scroll shadow, plus a "scroll →" hint on mobile/narrow viewports.
4. In the raw-report dialog (`rawJsonModal.svelte`) the close (×) button collides with the Copy button, and Copy gives no feedback. Fix the layout collision and add a "Copied" tooltip/confirmation on click.
5. Before the first DNS fetch (`data.dns == null`) the setup-health area is messy: it shows CRITICAL/WARNING findings that imply records are _absent_ when we simply have not looked yet, renders empty metric chips, and shifts layout between the pre-fetch and post-fetch states. Rework this into a clean, aligned state with a neutral onboarding prompt.

**Explicitly dropped from scope:** URL-driven / persisted tab selection. The current CSS-only `<details name="domain-tab">` tabs stay as-is — the user decided persistence is not a deal-breaker and not worth the complexity.

## Architecture / Approach

### Design system context

The app uses `@drop-in/graffiti` (v4.30). Relevant primitives already shipped by graffiti (no need to build these):

- **`.dropdown` + `.dropdown-menu[popover]`** — anchor-positioned, animated dropdown. Menu `a`/`button` children are styled automatically; supports `.dropdown.end` for right-alignment, `.dropdown-header`, and `hr` dividers. Use the native Popover API (`popovertarget` / `popover`).
- **`.tooltip` / `.tip`** — tooltip surface. `.tip[aria-label]` (standalone, engine-agnostic) shows `aria-label` on hover/focus via `::after`; supports `.bottom`/`.left`/`.right` position modifiers.
- **`<dialog>` + `dialog > .close`** — graffiti styles native dialogs (backdrop, radius, animation) and pins `.close` to `inset-block-start: -14px; inset-inline-end: var(--pad-m)` (top-right). This pinned position is the source of the Copy-button collision.
- **`.tabs > details`** — CSS-only tabs (kept as-is).
- Tokens used throughout: `--fg`, `--fg-5/-7`, `--bg`, `--border-1`, `--br-m`, `--pad-*`, `--vs-*`, `--primary`, `--success`, `--warning`, `--error`, `--shadow-*`.

`.table-scroll` is referenced in five places across the app but is **not defined** in graffiti's CSS or locally — currently a latent bug (no `overflow-x`). It must be defined as part of this work.

### Component / file changes

**Domain header actions menu (items 1 & 2)** — `domains/[domain]/+page.svelte`

- Add a ⋮ trigger button (`popovertarget`) + `<div class="dropdown-menu" popover>` in the header, top-right, using graffiti `.dropdown.end`.
- Two menu items: **Refresh DNS** and **Refresh IP details**, each with a short inline explanation (`.dropdown-header`-style secondary text under the label).
- Clicking a menu item opens a confirmation `<dialog>` (proceed/cancel) with the fuller description currently in the `title=` attributes. "Proceed" submits the existing hidden-input form (`intent=refresh-dns` / `intent=refresh-ips`) via `use:enhance` — server action is unchanged.
- Move `LastRunStatus` ("Updated · N selectors · date" / "· N IPs · date") next to each menu item (or into the confirm dialog).
- Remove the standalone `.dns-refresh` header form and the `.ip-refresh` form/button from the Source IPs tab body. Keep the explanatory `.scope-note` / `.hint` text in the tab body.
- Header becomes a stable layout: title + back-link + setup-health on the left, ⋮ menu pinned top-right, so nothing reflows between pre/post DNS-fetch states (supports item 5).
- Disabled state: if `!data.dnsRefreshStatus.canRun` / `!data.ipBackfillStatus.canRun`, render the menu item as `aria-disabled="true"` (graffiti dims it) and skip opening the confirm dialog.

**Horizontal scroll affordance (item 3)** — `domains/[domain]/+page.svelte` (and reuse pattern in `reports/[reportId]/+page.svelte`, `stats/+page.svelte`, `+page.svelte` if trivial; primary target is the domain view)

- Define `.table-scroll { overflow-x: auto; }` locally in the domain view (or a shared style) and add `scrollbar-gutter: stable`.
- CSS-only right-edge scroll shadow using the background-attachment scroll-shadow technique (linear-gradient "cover" layers + radial-gradient "shadow" layers with `background-attachment: local, local, scroll, scroll`) so the shadow appears only when content overflows and hides at the scroll extremes. No JS.
- Mobile hint: on `@media (max-width: 640px)`, show a small "scroll →" affordance (e.g. a `::after` label or a caption above the table). Keep it unobtrusive and remove it visually once scrolled (best-effort with CSS; a static hint is acceptable if pure-CSS "scrolled" detection is not feasible).

**Raw JSON dialog (item 4)** — `lib/components/rawJsonModal.svelte`

- Fix collision: give the `.modal-header` right padding/gutter so the pinned `×` (`dialog > .close`) does not overlap the Copy button, OR move Copy to the left of the title. Preferred: keep `×` at graffiti's default top-right and reserve header right space for it; place Copy left of / below the title so they never overlap.
- Copy feedback: add local `copied` state (`$state<boolean>`). On successful `navigator.clipboard.writeText`, set `copied = true`, swap the button label to "Copied ✓", and show a graffiti `.tip` ("Copied") on the button; reset after ~1500ms via `setTimeout` (clear any prior timeout). Handle clipboard rejection by leaving the label unchanged (no crash).

**Setup-health pre-fetch rework (item 5)** — `domains/[domain]/+page.svelte` + `lib/server/advisory.ts`

- In `advisory.ts`: when `dns == null` (never checked), do **not** emit the `policy-missing` (CRITICAL) / `spf-missing` (WARNING) / dkim-missing findings that imply records are absent. Instead emit a single neutral onboarding finding (e.g. `id: "dns-not-checked"`, `severity: "info"`, title "DNS not checked yet", detail prompting the user to run a DNS check). Report-derived findings (e.g. `spoofing-blocked`) still emit because they do not depend on DNS. Distinguish `dns == null` (never fetched) from `dns != null && dns.error != null` (fetched but failed) — the existing `dns-unavailable` finding stays for the error case.
  - Note: `buildAdvisory` currently takes `dns?: DomainDns`. The load function passes `dns ?? undefined` implicitly via `dns` (which is `domainRecord?.dns`). Ensure the "never checked" branch is driven by `dns == null`.
- In `+page.svelte`: only render the DNS metric chips (`p=`, `pct`, `SPF`, `DKIM found`, "Last checked") when `data.dns != null`. When null, render the neutral onboarding card/prompt in the setup-health block (with the Refresh DNS affordance reachable — via the ⋮ menu, or an inline prompt button that opens the same confirm dialog). Do not show empty `—` chips.
- Ensure the setup-health block and header use a fixed grid so the pre-fetch and post-fetch layouts align (no shifting cards / misaligned chips).

### Key design decisions

- Reuse graffiti `.dropdown`, `.tooltip`/`.tip`, `<dialog>` rather than hand-rolling — keeps the app's "graffiti-first, only fill genuine gaps" convention (see existing comments in the svelte files).
- Confirm dialogs use native `<dialog>` for free modality/focus-trap/Escape, matching the existing `rawJsonModal` pattern.
- No new dependencies.
- Server actions (`+page.server.ts`) are unchanged — only the client presentation of the refresh controls moves.
- Tabs remain CSS-only (`<details name>`); tab persistence is intentionally out of scope.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

This is a SvelteKit package. Follow the `sveltekit-lambda` and `typescript` steering. Prettier (not Biome/Oxfmt) formats Svelte files in this app — use the app's existing formatting conventions and run the app's own checks.

**Check gates** (run from `packages/dmarc-dashboard`, after every task):

1. `bun run type-check` (svelte-kit sync && svelte-check)
2. `bun test`
3. Manual: `bun run dev` and visually verify the affected view where practical.

**Rules for subagents:**

- Each task is self-contained.
- No commits — leave changes uncommitted for review.
- Do NOT add explanatory/narrating comments (workspace steering). Keep the existing "graffiti gap" rationale comments where they still apply; remove stale ones.
- Reuse graffiti primitives (`.dropdown`, `.dropdown-menu[popover]`, `.tooltip`/`.tip`, `<dialog>`) — do not hand-roll equivalents.
- Do not touch `+page.server.ts` actions or the tab structure (`<details name="domain-tab">`).
- Do NOT investigate/fix why "Refresh IP details" does nothing — the user owns that.
- No changeset yet; if one is added later, the package name is `@beesolve/dmarc-dashboard`.

## Tasks

### Task 1: Header actions menu (⋮) with confirm dialogs — items 1 & 2

- [x] Add a ⋮ trigger button + graffiti `.dropdown.end` / `.dropdown-menu[popover]` in the domain view header, pinned top-right.
- [x] Menu items: "Refresh DNS" and "Refresh IP details", each with a one-line inline explanation and its `LastRunStatus`.
- [x] Each item opens a native `<dialog>` confirm (proceed/cancel) carrying the fuller description from the current `title=` text; "proceed" submits the existing hidden-input form via `use:enhance` (unchanged intents `refresh-dns` / `refresh-ips`).
- [x] Honor disabled state via `aria-disabled` when `!canRun`; do not open the dialog when disabled.
- [x] Remove the header `.dns-refresh` form and the in-tab `.ip-refresh` form/button. Keep the `.scope-note` / `.hint` explanatory copy in the Source IPs tab body.
- [x] Keep the in-progress / error callouts (`formResult`) working for both intents.

**Files:** `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`

**Acceptance criteria:** Header shows a single ⋮ menu top-right; both refresh actions live inside it; each opens a proceed/cancel dialog that triggers the existing server action; no standalone Refresh buttons remain; `bun run type-check` passes.

---

### Task 2: Horizontal scroll affordance — item 3

- [x] Define `.table-scroll { overflow-x: auto; scrollbar-gutter: stable; }` (currently undefined) in the domain view.
- [x] Add a CSS-only right-edge scroll shadow (background-attachment scroll-shadow technique) that appears only when the table overflows and fades at scroll extremes. No JS.
- [x] Add a "scroll →" hint on `@media (max-width: 640px)` for the wide tables.
- [x] Apply the same `.table-scroll` behavior to the other tables that use it where trivial (reports detail, stats, domains list) — primary target is the domain view.

_Note: `.table-scroll` was already defined `:global()` in `+layout.svelte`; enhanced there instead of per-file, covering all 6 usages (incl. users list)._

**Files:** `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte` (+ optionally `reports/[reportId]/+page.svelte`, `stats/+page.svelte`, `routes/+page.svelte`)

**Acceptance criteria:** Wide tables show a visible right-edge shadow while horizontally overflowing; shadow disappears at the right extreme; mobile shows a "scroll →" hint; `bun run type-check` passes.

---

### Task 3: Raw JSON dialog — close/copy collision + copy feedback — item 4

- [x] Fix the `.modal-header` so the pinned `×` (`dialog > .close`) no longer overlaps the Copy button (reserve right gutter for `×`, or relocate Copy left of the title).
- [x] Add local `copied` state; on successful copy show "Copied ✓" label + a graffiti `.tip` ("Copied") on the button, reset after ~1500ms with a cleared timeout.
- [x] Handle clipboard write rejection gracefully (no unhandled rejection, label unchanged).

**Files:** `packages/dmarc-dashboard/src/lib/components/rawJsonModal.svelte`

**Acceptance criteria:** Close button and Copy button never visually overlap; clicking Copy shows a transient "Copied" confirmation; `bun run type-check` passes.

---

### Task 4: Setup-health pre-fetch rework — item 5

- [x] `advisory.ts`: when `dns == null`, suppress the record-absent CRITICAL/WARNING/dkim findings and emit a single neutral `dns-not-checked` (info) onboarding finding; keep report-derived findings (e.g. `spoofing-blocked`). Keep the existing `dns-unavailable` finding for the `dns != null && dns.error != null` case.
- [x] `+page.svelte`: render DNS metric chips only when `data.dns != null`; when null, show a neutral onboarding prompt in the setup-health block with the Refresh DNS action reachable (via the ⋮ menu or an inline button opening the same confirm dialog). No empty `—` chips.
- [x] Give the header + setup-health a stable grid so pre-fetch and post-fetch layouts align without shifting.

**Files:** `packages/dmarc-dashboard/src/lib/server/advisory.ts`, `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`

**Acceptance criteria:** With no DNS record on file, the view shows an aligned, calm onboarding state (no false "No DMARC record found" CRITICAL, no empty chips); after a DNS check the full findings render; layout does not shift between the two states; `bun run type-check` and `bun test` pass (update/extend `advisory` tests if present).

---

## Future Work (out of scope)

- Persist selected tab (URL param or otherwise) — intentionally dropped.
- Root-cause fix for "Refresh IP details" doing nothing — user is investigating.
- Broader table redesign for very wide tables (beyond the scroll affordance).
