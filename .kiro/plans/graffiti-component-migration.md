# Graffiti Component Migration — Dashboards

## Status: Complete

## Problem Statement

Both SvelteKit dashboards (`packages/service-email-dashboard` and `packages/dmarc-dashboard`) use the `@drop-in/graffiti` design system, but several UI elements are hand-rolled with custom `<style>` CSS even though graffiti already ships an equivalent component or utility. This duplicates CSS, drifts from the design system, and — in at least one case (the timeline) — caused hand-rolled class names to collide with graffiti's own global rules.

Per steering (`.kiro/steering/sveltekit-lambda.md` → "UI Components — Graffiti First"), we must use graffiti components wherever a suitable one exists, and only hand-roll when graffiti has no equivalent (e.g. calendar, bar chart). This plan migrates every identified hand-rolled instance to its graffiti counterpart, and removes the now-redundant custom CSS.

The migration is grouped by graffiti target (Card Grid, Cluster, Card/Surface, Table wrapper, App Shell, Breadcrumbs, consistency fixes), ordered from lowest to highest risk. Each task is scoped so it can be reviewed and reverted independently.

## Architecture / Approach

### Graffiti components/utilities being adopted

- **Card Grid** — responsive auto-fill grid; replaces custom `.summary-cards` / `.rates` grid CSS.
- **Cluster** — horizontal wrapping flex row with gap; replaces custom `.toolbar` / `.actions` / `.month-picker` flex CSS.
- **Card** / **Surface** — bordered/tinted panel; replaces hand-rolled info/metadata panels (`.meta`, `.metadata`, `.setup-health`, `.recipient-timeline` wrapper) and the email overview `.rate-card` blocks (via **Stat Card**).
- **Table wrapper** — graffiti's `.table` (which provides `overflow-x: auto`); replaces bare `<table>` + the custom `.table-scroll` shim in `+layout.svelte`.
- **App Shell** — outer application scaffold; replaces custom `.app` / `.app-header` / `.app-main` in both `+layout.svelte`.
- **Breadcrumbs** — replaces plain hand-styled `← back` anchors on detail pages.
- **`.button.ghost`** — consistency fix for the one dmarc "Load more" that is a plain `<a>`.

### What stays hand-rolled (no graffiti equivalent — do NOT migrate)

- `calendar.svelte` (date picker) — no graffiti calendar.
- Stats stacked bar chart + legend (`routes/stats/+page.svelte`) — no graffiti chart primitive.
- Full-row status tints (`.row-warn` / `.row-fail`) and `.flagged` rate-card error tint — no graffiti utility; keep as small semantic-color modifiers layered on top of the graffiti component.
- `themeSwitcher.svelte` 3-state light/dark/system model — graffiti Toggle Switch is 2-state only.
- `monthPicker.svelte` date-bound-disabling logic — behavior, not styling.
- Panel-with-toolbar header rows — no graffiti "panel + toolbar" layout; keep the small head-row CSS on top of a graffiti Card.

### Verification of graffiti class names before use

Graffiti class names must be confirmed against `node_modules/@drop-in/graffiti/dist/index.css` before use, because the class names in this plan are derived from section comments, not verified selectors. The FIRST task establishes the exact class names and required markup for each component (Card Grid, Cluster, Card, Surface, Table, App Shell, Breadcrumbs) so later tasks use correct selectors. If a graffiti component's required markup differs materially from what a task assumes, prefer the graffiti markup and note the deviation in the review.

### Scoping / collision rule

- Never introduce or keep a hand-rolled class that collides with a graffiti global (`.card`, `.tag`, `.timeline`, `.table`, `.cluster`, `.stack`, etc.). Adopt the graffiti component instead. If a wrapper needs a distinct class for a small modifier, use an app-specific prefix (e.g. `.rate-card--flagged` or a scoped modifier that does not shadow a graffiti class).

### Key Design Decisions

- **Group by graffiti target, not by page** — so each task is a coherent, reviewable "adopt component X everywhere" change with a consistent diff shape.
- **Lowest-risk first** — layout utilities (Card Grid, Cluster) and consistency fixes before structural changes (Table wrapper, App Shell).
- **App Shell is last and isolated** — it touches both `+layout.svelte` files and the responsive nav; highest regression risk, so it is a standalone task the user can accept/reject on its own.
- **Preserve behavior** — dialogs (`showModal()` modality/focus-trap/Escape), dropdown popover behavior, tabs, and the month-picker bounds logic must not change; only presentational scaffolding is migrated.
- **One changeset per dashboard** at the end, or per-task changesets — decided at execution time. Package names: `@beesolve/email-service-dashboard` and `@beesolve/dmarc-dashboard` (differ from directory names — read `package.json`).

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task. After each task, the user reviews the rendered UI and diff, then signals "continue".

**Check gates** (run after every task, for each dashboard touched by the task):

1. `bun run fmt:check` and `bun run lint` (repo root — oxfmt + oxlint)
2. `bun run type-check` (in the touched dashboard package — runs `svelte-check`)
3. `bun run build` (in the touched dashboard package — SvelteKit build must succeed)

**Rules for subagents:**

- Each task must be self-contained.
- No commits — leave changes uncommitted for review.
- Follow `.kiro/steering/` (TypeScript, sveltekit-lambda "Graffiti First", no explanatory comments).
- Before using any graffiti class, confirm the exact selector and required markup in `node_modules/@drop-in/graffiti/dist/index.css`.
- When removing hand-rolled CSS, remove ONLY the rules made redundant by the graffiti component; keep semantic-tint modifiers and genuine-gap CSS.
- Do NOT change data loading, form actions, dialog modality, dropdown/tab behavior, or the month-picker bounds logic.
- If a graffiti component does not cleanly fit an element, leave it hand-rolled and note why in the review (do not force it).
- If check gates fail on unrelated pre-existing issues, note them but do not fix.

**Operational notes:**

- These are SvelteKit packages; there is no meaningful `bun test` UI coverage — verification is `type-check` + `build` + visual review via `bun run dev`.
- Graffiti is imported once in each `+layout.svelte` via `import "@drop-in/graffiti"`; its classes are global.
- Svelte scopes component `<style>`; global graffiti classes still apply to elements that use them.

## Tasks

### Task 1: Establish graffiti component reference (no UI change)

- [x] Read `node_modules/@drop-in/graffiti/dist/index.css` and record the exact selectors and required markup for: Card Grid, Cluster, Card, Surface, Stat Card, Table wrapper, App Shell, Breadcrumbs, `.button.ghost`.
- [x] Write a short reference at the top of this plan file (or a scratch note in the review) mapping each graffiti component → exact class name(s) + minimal markup example.
- [x] Flag any component whose real markup differs from the assumptions in this plan so later tasks adjust.

**Files:** none modified (research only); may append a "Verified graffiti reference" note to `.kiro/plans/graffiti-component-migration.md`.

**Acceptance criteria:** A verified list of graffiti class names + markup exists for every component used in later tasks. No source files changed.

---

### Task 2: Adopt Card Grid for summary/rate grids

- [x] Replace custom `.summary-cards` / `.rates` grid CSS with graffiti Card Grid markup in:
  - email: `routes/+page.svelte`, `routes/recipients/[email]/+page.svelte`
  - dmarc: `routes/+page.svelte`, `routes/domains/[domain]/+page.svelte` (summary cards portion), `routes/stats/+page.svelte` (summary cards portion only — NOT the bar chart)
- [x] Remove the now-redundant grid CSS rules from each file's `<style>`. Keep any per-card modifier CSS.

**Files:** `packages/service-email-dashboard/src/routes/+page.svelte`, `packages/service-email-dashboard/src/routes/recipients/[email]/+page.svelte`, `packages/dmarc-dashboard/src/routes/+page.svelte`, `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`, `packages/dmarc-dashboard/src/routes/stats/+page.svelte`

**Acceptance criteria:** Both dashboards `type-check` + `build` clean; summary cards render in a responsive grid using the graffiti Card Grid class; no custom grid CSS remains for these grids.

---

### Task 3: Adopt Cluster for toolbars / action rows

- [x] Replace custom horizontal flex rows with graffiti Cluster in:
  - email: `routes/messages/+page.svelte` (`.toolbar`), `routes/recipients/[email]/+page.svelte` (`.toolbar`)
  - shared/email component: `lib/components/monthPicker.svelte` (`.month-picker` row — replace the flex CSS only; keep prev/next bounds logic and selects)
  - dmarc: `routes/users/+page.svelte` (`.actions` inline row), and the equivalent toolbar rows on dmarc pages that use MonthPicker/search
- [x] Remove the redundant flex CSS. Keep gap/alignment only if Cluster does not already provide it.

**Files:** `packages/service-email-dashboard/src/routes/messages/+page.svelte`, `packages/service-email-dashboard/src/routes/recipients/[email]/+page.svelte`, `packages/service-email-dashboard/src/lib/components/monthPicker.svelte`, `packages/dmarc-dashboard/src/routes/users/+page.svelte`, plus any dmarc toolbar rows found in Task 1 reference.

**Acceptance criteria:** Both dashboards `type-check` + `build` clean; toolbars/action rows use the graffiti Cluster class; month-picker bounds behavior unchanged.

---

### Task 4: Consistency + Breadcrumbs (low-risk polish)

- [x] Change the dmarc `routes/domains/[domain]/+page.svelte` "Load more" plain `<a>` to `.button.ghost` to match the email dashboard.
- [x] Replace plain hand-styled `← back` anchors with graffiti Breadcrumbs on:
  - email: `routes/messages/[messageId]/+page.svelte`, `routes/recipients/[email]/+page.svelte`
  - dmarc: `routes/domains/[domain]/+page.svelte`, `routes/domains/[domain]/reports/[reportId]/+page.svelte`
- [x] Remove redundant back-link CSS (`.back`).

**Files:** the four route files above plus the email `messages/[messageId]` and `recipients/[email]` files.

**Acceptance criteria:** Both dashboards `type-check` + `build` clean; back navigation renders as graffiti Breadcrumbs; dmarc "Load more" matches email styling.

---

### Task 5: Adopt Card / Surface for info & metadata panels

- [x] Replace hand-rolled bordered/tinted panels with graffiti Card (or Surface where a subtle background is intended):
  - email: `routes/messages/[messageId]/+page.svelte` — `.meta` info card and the `.recipient-timeline` wrapper (do NOT touch the `.timeline` component itself, already graffiti)
  - dmarc: `routes/domains/[domain]/reports/[reportId]/+page.svelte` — `.metadata` panel; `routes/domains/[domain]/+page.svelte` — `.setup-health` panel (keep the small panel-toolbar head row on top of the Card)
- [x] Remove redundant panel CSS (border/radius/padding/background), keep semantic modifiers.

**Files:** `packages/service-email-dashboard/src/routes/messages/[messageId]/+page.svelte`, `packages/dmarc-dashboard/src/routes/domains/[domain]/reports/[reportId]/+page.svelte`, `packages/dmarc-dashboard/src/routes/domains/[domain]/+page.svelte`

**Acceptance criteria:** Both dashboards `type-check` + `build` clean; panels render as graffiti Card/Surface; timeline unaffected; setup-health toolbar row still functions.

---

### Task 6: Adopt Stat Card for email overview rate cards

- [x] Replace the hand-rolled `.rate-card` blocks in email `routes/+page.svelte` with graffiti Stat Card (same component `summaryCard.svelte` already uses, or the `.stat-card` class directly).
- [x] Preserve the "flagged" error state as a small non-colliding modifier layered on the Stat Card (e.g. an app-specific class that only sets the error border/background tint via graffiti tokens).
- [x] Remove the redundant `.rate-card` structural CSS.

**Files:** `packages/service-email-dashboard/src/routes/+page.svelte` (and `packages/service-email-dashboard/src/lib/components/summaryCard.svelte` only if a shared variant is cleaner).

**Acceptance criteria:** email dashboard `type-check` + `build` clean; rate cards render as Stat Cards; flagged cards still show the error tint.

---

### Task 7: Adopt graffiti Table wrapper for data tables

- [x] Replace bare `<table>` + the custom `.table-scroll` shim with graffiti's Table wrapper class across all list/detail tables in both dashboards:
  - email: `routes/+page.svelte`, `routes/messages/+page.svelte`, `routes/recipients/+page.svelte`, `routes/recipients/[email]/+page.svelte`
  - dmarc: `routes/+page.svelte`, `routes/domains/[domain]/+page.svelte` (all tables), `routes/domains/[domain]/reports/[reportId]/+page.svelte`, `routes/stats/+page.svelte`, `routes/users/+page.svelte`
- [x] Remove the global `.table-scroll` rule from both `+layout.svelte` files IF no longer referenced after migration. Keep row-tint modifiers (`.row-warn` / `.row-fail`) layered on the graffiti table.

**Files:** the table route files above, plus `packages/service-email-dashboard/src/routes/+layout.svelte` and `packages/dmarc-dashboard/src/routes/+layout.svelte` (remove `.table-scroll` shim if unused).

**Acceptance criteria:** Both dashboards `type-check` + `build` clean; tables use the graffiti Table wrapper with working horizontal scroll on narrow screens; `.table-scroll` shim removed where unused; row tints preserved.

---

### Task 8: Adopt App Shell for layout scaffold (highest risk — isolated)

- [x] Replace the custom `.app` / `.app-header` / `.app-main` scaffolding in both `+layout.svelte` with graffiti App Shell, IF App Shell's layout model cleanly supports the existing top nav (brand + links + actions) and responsive wrapping.
- [x] If App Shell imposes a layout that regresses the responsive nav (which wraps at `max-width: 40rem`), STOP and leave the scaffold hand-rolled, documenting why in the review. Do not force it.
- [x] Keep the nav content; only migrate the outer scaffold and, if a graffiti nav component fits, the nav row.

**Files:** `packages/service-email-dashboard/src/routes/+layout.svelte`, `packages/dmarc-dashboard/src/routes/+layout.svelte`

**Acceptance criteria:** Both dashboards `type-check` + `build` clean; app scaffold uses App Shell OR the task documents why App Shell was not suitable and the scaffold was left as-is; responsive nav still works at narrow widths.

---

### Task 9: Changesets + final verification

- [x] Read `package.json` `name` for each dashboard (`@beesolve/email-service-dashboard`, `@beesolve/dmarc-dashboard`).
- [x] Create a `patch` changeset per dashboard summarizing the graffiti migration (list the components adopted). Follow `.changeset` format used by existing entries.
- [x] Run full check gates for both dashboards: root `bun run fmt:check` + `bun run lint`, and per-package `bun run type-check` + `bun run build`.

**Files:** `.changeset/<name>.md` (one or two entries).

**Acceptance criteria:** Changesets exist for every dashboard actually changed; all check gates pass for both dashboards.

---

## Future Work (out of scope)

- A graffiti-based calendar/date-picker to replace `calendar.svelte` (no graffiti equivalent exists today).
- A graffiti chart primitive to replace the stats stacked bar chart (no equivalent today).
- Evaluating graffiti Toggle Switch for a redesigned 2-state theme control (current control is intentionally 3-state light/dark/system).
- Replacing the cursor "Load more" pattern with graffiti Pagination (would require switching from cursor to page-number pagination — a data-layer change, not styling).

## Verified graffiti reference

Verified against the graffiti CSS **actually loaded** by both dashboards. Source of truth confirmed:

- `import "@drop-in/graffiti"` → `dist/index.js` → `import "./drop-in.css"`.
- **Discrepancy vs. plan:** The plan (and Task 1 instructions) reference `dist/index.css`. The runtime-loaded stylesheet is `dist/drop-in.css`. Both files exist and `index.css` mirrors the same selectors, but `drop-in.css` is the authoritative one for what ships. All selectors below are verified in `drop-in.css`.
- Graffiti version: `@drop-in/graffiti@4.30.0`. Both dashboards resolve to the same copy (`.bun/@drop-in+graffiti@4.30.0+7a2629d9...`).
- Selector line numbers cited are from `packages/service-email-dashboard/node_modules/@drop-in/graffiti/dist/drop-in.css`.

### Summary of discrepancies to act on in later tasks

| Plan assumption                                                            | Verified reality                                                         | Impact                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| "Card Grid" → `.card-grid` (implied)                                       | **`.layout-card`** (no `.card-grid` exists)                              | **Task 2** must use `.layout-card`, not `.card-grid`.                                              |
| Verify against `index.css`                                                 | Runtime loads **`drop-in.css`**                                          | All tasks: verify against `drop-in.css`. Selectors are identical, but cite the right file.         |
| "Table wrapper `.table`"                                                   | Confirmed `.table` is a **wrapper div**; the `<table>` inside stays bare | **Task 7**: wrap `<table>` in `<div class="table">`; do NOT put `.table` on the `<table>` element. |
| Cluster/Stack/Surface/Card/Stat Card/Breadcrumbs/App Shell/`.button.ghost` | All confirmed with the assumed names                                     | No rename needed; note the exact required markup below.                                            |

All named components **exist** in graffiti except **Card Grid**, whose real class is `.layout-card` (the name `card-grid` does not appear anywhere in the CSS).

### Card Grid → `.layout-card`

`drop-in.css:2344` (comment: "Card Grid Layout - Auto-fill responsive card grid").

- Responsive auto-fill grid: `grid-template-columns: repeat(auto-fill, minmax(var(--layout-min-card-width, var(--min-card-width, 290px)), 1fr))`.
- Gap: `var(--layout-gap, var(--gap, 2rem))`. Override min card width via `--min-card-width` (or `--layout-min-card-width`); override gap via `--gap` / `--layout-gap`.
- No required child class — direct children are the grid items (typically `.card` / `.stat-card`).

```svelte
<div class="layout-card" style="--min-card-width: 220px;">
  <div class="stat-card"> ... </div>
  <div class="stat-card"> ... </div>
</div>
```

### Cluster → `.cluster`

`drop-in.css:2610`.

- `display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap)` with `--gap: 0.5rem` default.
- Modifier `.center` → `justify-content: center`. Override spacing with inline `--gap`.

```svelte
<div class="cluster">
  <button class="button">Prev</button>
  <select> ... </select>
  <button class="button">Next</button>
</div>
```

### Stack → `.stack`

`drop-in.css:2597` (not in the task list but useful for vertical grouping).

- `display: flex; flex-direction: column; gap: var(--gap, 1rem)`. Direct children get margins zeroed.

### Card → `.card`

`drop-in.css:2740`.

- `background: var(--bg); border: var(--border-1); border-radius: var(--br-l); box-shadow: var(--shadow-2); padding: var(--pad-l); display: flex; flex-direction: column; gap: var(--vs-s)`.
- Direct `> *` get `margin: 0`.
- **Optional edge-to-edge regions:** a direct `<header>` and/or `<footer>` child bleed to the card's padding edges and get a divider border (header → bottom border, footer → top border). Use `<header>`/`<footer>` for a titled panel with a separated head/foot row (relevant to the "panel + toolbar head row" cases in Task 5).
- Direct `<img>`/`<picture>`/`<figure>` also bleed edge-to-edge.
- Modifiers: `.card.linked` (hover/lift affordance for clickable cards), `.card.featured` (primary border + tinted header).

```svelte
<div class="card">
  <header><h2>Setup health</h2><button class="button ghost">Refresh</button></header>
  <p>body content…</p>
</div>
```

### Surface → `.surface`

`drop-in.css:3431`.

- **Minimal:** only sets `background: var(--surface-bg, var(--fg-05))`. No border, radius, or padding.
- Use for subtle section-background tinting, NOT as a bordered panel. For a bordered/elevated panel use `.card`. If a plan step expected `.surface` to give a full panel look, it must combine it with padding/border or just use `.card`.

### Stat Card → `.stat-card`

`drop-in.css:2859`.

- `background: var(--bg); border: var(--border-1); border-radius: var(--br-l); padding: var(--pad-l); display: flex; flex-direction: column; gap: var(--vs-xs)`.
- **Expected child markup:** a `<small>` (label — muted, medium weight) and a `<strong>` (value — large `--fl: 3`, bold). Direct `> *` get `margin: 0`.

```svelte
<div class="stat-card">
  <small>Delivered</small>
  <strong>1,284</strong>
</div>
```

For Task 6, the "flagged" tint should be an app-specific modifier layered on top (e.g. `.stat-card.rate-card--flagged { border-color: var(--red-6); }`) — do not shadow `.card`/`.stat-card`.

### Table wrapper → `.table` (wrapper element, table stays bare)

`drop-in.css:3116`.

- `.table` = wrapper: `overflow-x: auto; border: var(--border-2); border-radius: var(--table-border, var(--br-m))`.
- The `<table>` inside is styled by bare element selectors (`table`, `td`, `th`, `thead`, `tr`) — do NOT add a class to `<table>`.
- Zebra striping: `.table.zebra` on the **wrapper** stripes even `tbody` rows.

```svelte
<div class="table">
  <table>
    <thead><tr><th>Col</th></tr></thead>
    <tbody><tr><td>val</td></tr></tbody>
  </table>
</div>
```

Task 7: this wrapper replaces the custom `.table-scroll` shim (it already provides `overflow-x: auto`). Row-tint modifiers (`.row-warn`/`.row-fail`) applied to `<tr>` remain fine layered on top.

### App Shell → `.app-shell`

`drop-in.css:5521`.

- `display: grid; grid-template-rows: auto 1fr auto; min-height: 100dvh` (via `--app-shell-min-height`); honors safe-area insets.
- **Required direct children:** `<header>`, `<main>`, `<footer>` (footer optional; grid is rows auto/1fr/auto).
  - `> header` → `position: sticky; top: 0; z-index: var(--z-sticky)`, blurred `--bg` background.
  - `> main` → `overflow-y: auto; overscroll-behavior: contain` (main is the scroll container).
  - `> footer` → sticky bottom.

```svelte
<div class="app-shell">
  <header> …brand + nav + actions… </header>
  <main> <slot /> </main>
  <!-- footer optional -->
</div>
```

**Task 8 caveat:** `.app-shell > main` becomes the scroll container (`overflow-y: auto`) and the header is sticky. This is a structural change from the current `.app`/`.app-main` flow. The existing responsive nav (wraps at `max-width: 40rem`) lives inside `<header>` and is not governed by `.app-shell` — App Shell only lays out header/main/footer rows, so the nav's own wrapping CSS is preserved. This matches the plan's "keep nav content; migrate only the outer scaffold." If the sticky-header + main-scroll model regresses current whole-page scroll behavior, Task 8's stop-and-document rule applies.

### `.button.ghost`

`.button` at `drop-in.css:1526` (selector `button, .button` — applies to `<button>` **and** any element with class `button`, so `<a class="button">` is valid). `.ghost` modifier nested at `drop-in.css:1905`.

- `.ghost` → `--button-color: transparent; border: 1px solid var(--fg-3); background: transparent; box-shadow: none`, with hover/active tints.

```svelte
<a href={nextUrl} class="button ghost">Load more</a>
```

Task 4: the dmarc "Load more" plain `<a>` becomes `<a class="button ghost">` to match the email dashboard.

### Files modified in Task 1

- `.kiro/plans/graffiti-component-migration.md` (appended this "Verified graffiti reference" section only).
- No source files modified.

## Task 8 decision: App Shell rejected (both dashboards, no source change)

App Shell (`.app-shell`) was evaluated and **not adopted** for either dashboard. Both `+layout.svelte` files are left hand-rolled unchanged.

Reasons:

1. **Scroll-model regression (the plan's explicit STOP trigger).** `.app-shell > main` sets `overflow-y: auto` (main becomes the scroll container) and `.app-shell > header` is `position: sticky`. Both dashboards currently use whole-document scroll with a non-sticky header. Adopting App Shell would change scroll behavior app-wide.
2. **Centered containers fight the full-bleed grid.** `.app-header` and `.app-main` center content at `max-width: 72rem; margin: 0 auto`; App Shell's header/main are full-viewport grid rows, so a clean migration would require net-new inner centering wrappers — added scaffolding, not the CSS reduction the migration targets.
3. **No benefit, added risk.** Footer-less desktop dashboards gain nothing from App Shell's sticky header/footer, `100dvh`, and safe-area features.
4. **No collision forces the change.** `.app`, `.app-header`, `.app-main`, `.nav*` do not collide with any graffiti global, so the collision rule does not require adoption.

Responsive nav breakpoint verified as `@media (max-width: 40rem)` in both files; unchanged. Both dashboards treated identically (structurally identical scaffolds).
