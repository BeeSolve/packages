# Unified Analytics: Watch Model, Cache Counts, Uniques, URL Directory, and Data Transparency

## Status: Implemented (uncommitted, awaiting review)

> Supersedes `.kiro/plans/watched-url-patterns-and-cache-ratio.md`. That plan's two
> features (additive cache counts + watched URL patterns) are folded into the unified
> watch model below. Do not execute the old plan; execute this one.

## Problem Statement

The CloudFront analytics pipeline (`@beesolve/analytics-processor`) and dashboard
(`@beesolve/analytics-dashboard`) have several gaps the operator wants fixed, without
rebuilding the cheap pre-aggregation model that already works (hourly additive writes,
rolled up to permanent day/month aggregates).

Concrete problems:

1. **Path breakdown collapses the long tail into `__other__`.** The top-N path
   breakdown (default 100) folds everything else into a single bucket, destroying
   exactly the long-tail signal (scanner probes, unexpected URLs) the operator cares
   about. We remove the `path` breakdown dimension entirely.
2. **No catalog of URLs served.** There is no list of every distinct URL CloudFront
   has served, so there is nothing to browse or to "add to watchlist".
3. **Cache hit ratio is broken above hourly grain.** `cacheHitRatio` is a non-additive
   hourly-only field, dropped by day/month rollups and never shown. We want additive
   hit/miss/error counts correct at every grain.
4. **No per-URL detail, and no safe way to add it.** Per-URL hourly records would be
   unbounded (junk-URL cardinality). Instead, per-URL/pattern detail is strictly
   opt-in via a bounded watchlist.
5. **No unique-visitor metric surfaced.** Athena computes a site-wide `approx_distinct`
   today but the dashboard ignores it; there is no per-country uniques.
6. **Dashboard does not explain its own data characteristics** (processing lag, hourly
   retention window, sitemap sync cadence, watch-forward semantics, approximate
   uniques, bucket state), so partial/empty views look like bugs.

## Key Design Decisions (locked)

- **Keep the write-cheap model.** Hourly writes stay lean and additive; permanent
  aggregates live at day/month. No fat per-URL-per-hour documents.
- **Drop the `path` breakdown dimension** (`dimensions` in `src/keys.ts`) and its
  `__other__` logic. Site-wide breakdowns keep only `status`, `country`, `device`.
- **URL directory**: `PK=<normalized url>, SK="url"`, metric-free catalog carrying
  only `firstSeen`. Written once per day in the daily rollup via a blind
  `SET firstSeen = if_not_exists(firstSeen, :today)` upsert (Option 1). No `lastSeen`
  (would churn). Repeat no-op writes cost ~1 WCU each at daily cadence — acceptable.
- **Unified watch model** subsumes both the old sitemap feature and the old plan's
  "watched patterns". A watch entry is a bounded, operator-or-sitemap-sourced
  collection instruction. Matcher modes: `exact` (one URL), `split` (prefix `*`, each
  path under it its own bucket), `group` (prefix `+`, one collapsed bucket). Every
  watch entry collects the SAME metrics and renders in the SAME view.
- **Watch entry lifecycle**: `status` = `active` | `stopped`. `stopped` keeps all
  history and stops collecting; reversible. `source` = `sitemap` | `manual`.
  - Sitemap sync sets dropped-from-sitemap URLs to `stopped` (not deleted); re-adds
    flip back to `active`.
  - Manual entries: user can `stop` (reversible) or `delete` (explicit, rare).
  - Hard-deletion of a watch entry's historical metric records is OUT OF SCOPE (see
    Future Work). `delete` for now removes only the config/watch row; metric records
    are left to be cleaned up by future work.
- **Watch metrics are hourly-collected** (justified because the watch set is bounded),
  stored at `dNN` day grain in a `(pk, YYYY-MM)` record — the durable aggregate tier,
  so **no TTL** on these. Metrics: `hits`, `bytesSent`, `cacheHits`, `cacheMisses`,
  `cacheErrors`, `bytesSaved`, `errors` (4xx+5xx), `redirects` (3xx). Day grain for
  `hits` (drives trend); byte/cache/error/redirect totals may be month-level only to
  bound item size (default: day-level `dNN` for hits, month-level scalars for the rest
  — tiny either way, decide in the task).
- **Cache counts are additive raw counts** (`cacheHits` = Hit+RefreshHit,
  `cacheMisses` = Miss, `cacheErrors` = Error+LimitExceeded+CapacityExceeded), added
  to site-wide totals `additiveFields` so they roll up correctly to every grain. The
  dashboard computes the ratio. The old non-additive `cacheHitRatio` is removed.
- **Uniques are Athena `approx_distinct(ip)`**, non-additive, no per-IP storage:
  - Site-wide + per-country uniques for a **day** computed in the **daily rollup**
    (which gains Athena access).
  - Per-month uniques computed by a **fresh Athena scan over the whole month** in the
    **monthly rollup** (NOT summed from daily — non-additive).
  - **No yearly uniques.** Year views show hits (additive) but omit unique counts.
  - Stored as plain numbers per period; `== null`-safe; kept forever (day/month grain).
- **Sitemap sync once per day** (in the daily rollup) plus immediately on config
  change (via the SDK write path). The hourly handler stops touching the sitemap.
  Sitemap URLs become watch entries with `source="sitemap"`.
- **TTL policy unchanged and intentional**: hourly totals/breakdowns + hourly/watch
  idempotency markers keep the 90-day TTL (`hourlyTtlDays`, cost control; raw logs in
  Athena allow recompute). ALL aggregate tiers — day/month totals, day/month
  breakdowns, watch metric records, URL directory, uniques — have **no TTL** and are
  kept indefinitely.
- **Data-transparency UX**: the dashboard surfaces processing lag, hourly retention
  window, sitemap cadence, watch-forward semantics, approximate/non-summable uniques,
  and bucket-state meaning. Lag hours and retention days are rendered from the
  deployed config values (new dashboard env vars), not hardcoded.
- **UI cleanup**: the dashboard shows ONLY the agreed views. Remove the legacy
  top-paths/`__other__` view and any dead UI. Final nav/route inventory is fixed below.

## Pipeline placement summary

| Work                                                                     | Handler                           | Cost                  |
| ------------------------------------------------------------------------ | --------------------------------- | --------------------- |
| Totals + status/country/device breakdowns (additive, incl. cache counts) | hourly                            | cheap, unchanged      |
| Watch metric collection (bounded set)                                    | hourly                            | cheap (bounded)       |
| URL directory upsert (`firstSeen`)                                       | daily rollup                      | cheap (once/day)      |
| Sitemap fetch + diff → watch entries                                     | daily rollup (+ on config change) | cheap (once/day)      |
| Site-wide + per-country **day** uniques (Athena)                         | daily rollup                      | one Athena scan/day   |
| **Month** uniques (fresh Athena scan)                                    | monthly rollup                    | one Athena scan/month |
| Day/month additive rollups (hits/bytes/cache/etc.)                       | daily/monthly rollup              | cheap DynamoDB sum    |

Daily and monthly rollup handlers GAIN Athena access (env + IAM) — the construct
already grants Athena/Glue/S3 to hourly and sitemap; extend the same grants to the two
rollup handlers.

## Final Dashboard Inventory (what the user sees — nothing else)

- **Overview `/`**: grain switcher (hour/day/month/year), PeriodPicker, window nav,
  totals trend bar chart, summary cards (Hits, Success, Errors, Bytes Sent), **cache
  hit/miss/error ratio panel** (from additive counts, correct at every grain),
  **site-wide unique visitors** (day/month; omitted at year). Bucket-state legend with
  explanation.
- **Country**: hits per country per day/month/year (additive, kept) + **unique
  visitors per country** (day/month; omitted at year). Data shape ready for a future
  map.
- **Device**: bot/mobile/desktop/other at day/month/year aggregate. Unchanged.
- **Status**: site-wide status breakdown (kept) + **"URLs that errored / were
  redirected"** derived from watch entries' `errors`/`redirects` metrics (class only —
  redirect / client-error / server-error; no exact per-URL codes).
- **URLs `/urls`** (new): the URL directory list (every URL served, `firstSeen`), with
  an **"Add to watchlist"** action per row. Metric-free list.
- **Watchlist `/watch`** (new, unifies sitemap + patterns): ranked table per watch
  bucket — bucket / hits / bytes transferred / cache hit-miss-error ratio / bytes
  saved — plus per-bucket trend chart. Shows `active` and `stopped` entries with a
  status badge and `source` (sitemap/manual). Grain switcher + PeriodPicker.
- **Settings `/settings`**: sitemap URL config (via SDK write path) + watchlist
  management (add manual entries with `*`/`+` sugar; stop/resume; delete manual). All
  admin-gated, all writes via the processor SDK handler.
- **About / Data notes**: a single reference panel (graffiti disclosure) stating lag,
  hourly retention, sitemap cadence, watch-forward, approximate uniques, bucket states.
- **Removed**: the legacy top-paths breakdown view and the `__other__` bucket;
  the standalone `/sitemap` route (absorbed into `/watch`); any now-dead components,
  remotes, labels, and nav entries.

## Execution Instructions

Executed by a main session spawning one subagent per task. After each task the user
reviews and signals "continue". No commits — leave changes uncommitted for review.

**Check gates (run after every task):**

1. `bun run check` (oxfmt + oxlint; run `bun run fmt` to fix formatting)
2. `bun run type-check`
3. `bun test`
4. `bun run build` (for tasks touching handlers/CDK/exports)

**Rules for subagents:**

- Self-contained tasks; no commits.
- Follow `.kiro/steering/` style: no narrating comments; `== null`/`!= null`;
  `v.picklist` for string-literal unions; named object params; marshall options on the
  document client; `attribute_not_exists(pk) AND attribute_not_exists(sk)` on
  composite-key guards. Barrel exports (`index.ts`) ARE used — wire new exports through
  them.
- Package names differ from directory names — read `package.json` `name` before any
  changeset (`@beesolve/analytics-processor`, `@beesolve/analytics-dashboard`).
- If a gate fails on a pre-existing unrelated issue, note it, don't fix it.
- Reference implementations: sitemap feature (`src/sitemap.ts`, `sitemap.ts`,
  `command/sitemap-backfill.ts`) and the SDK write path already added
  (`sdk.ts`/`sdkHandler.ts`, `grantAccess`).

## Tasks

### Task 1: Additive cache counts in the hourly query + totals rollup

- Extend `src/athena.ts` `buildHourlyQuery()` to emit `cache_hits` (Hit+RefreshHit),
  `cache_misses` (Miss), `cache_errors` (Error+LimitExceeded+CapacityExceeded).
  Extend `ResultRow`/`parseRow` (new column indices) and `HourlyAthenaTotals` with
  `cacheHits`/`cacheMisses`/`cacheErrors`. Remove `cacheHitRatio` (replaced by counts);
  update `assembleResult` for found and zero-row paths.
- In `src/totals.ts` add the three counts to `totalsSchema`, `TotalsInput`, and
  `additiveFields` (NOT `hourlyDetailFields`); drop `cacheHitRatio`. In `reduce.ts`
  add them to `SummedTotals`/`sumTotals`; in `resolveLive.ts` `pickTotals`/`emptyTotals`.
  Thread them through `processHour.ts` `buildHourlyUpdate`.
- Define the three result-type CASE expressions ONCE (shared helper) for reuse by the
  watch query (Task 5).
- Tests: SQL contains the three CASE sums; counts parse; day/month rollup sums them.
- **Files:** `src/athena.ts`, `src/totals.ts`, `src/reduce.ts`, `src/resolveLive.ts`,
  `src/processHour.ts`, `tests/*`.

### Task 2: Remove the `path` breakdown dimension

- Remove `"path"` from `dimensions` in `src/keys.ts`. Stop emitting the per-path
  GROUPING SET / `byPath` rows in `src/athena.ts` and the `path` dimension in
  `processHour.ts` `buildBreakdownUpdates` and the rollups. Remove `topNWithOther`
  usage for paths (keep the helper only if still used elsewhere; otherwise remove).
  Remove `topPaths` plumbing if it becomes unused (verify `cdk.ts` prop + env).
- Existing stored `breakdown#path#...` records are left to age out (hourly TTL) /
  sit unused (day/month) — harmless. Note this in the changeset.
- Tests: updated breakdown tests no longer expect `path`.
- **Files:** `src/keys.ts`, `src/athena.ts`, `src/processHour.ts`, `src/reduce.ts`
  (if path-only), `cdk.ts` (topPaths), `tests/*`.

### Task 3: Unified watch model (types, schema, config)

- New `src/watch.ts` (or rename/extend `src/sitemap.ts` — decide; recommend new
  `src/watch.ts` and retire sitemap stats model): matcher modes
  `watchModes = ["exact","split","group"] as const`; sources
  `watchSources = ["sitemap","manual"] as const`; statuses
  `watchStatuses = ["active","stopped"] as const` (all `v.picklist`). A
  `WatchEntry` config row: `{ matcher: string, mode, source, status, label?, firstSeen }`.
- Config (`src/config.ts`): keep `sitemapUrl`. Watch entries are their own rows (NOT a
  config array) so there can be many — `PK=watch#<matcher>, SK="config"` (or similar),
  listable via reverse index. Methods: `listWatch()`, `upsertWatch(...)`,
  `setWatchStatus(...)`, `deleteWatch(...)` (config row only).
- Tests: round-trip; status transitions; `*`/`+` sugar parsing lives at the dashboard
  boundary (Task 9) — model stores structured values only.
- **Files:** `src/watch.ts`, `src/config.ts`, `tests/*`.

### Task 4: Watch metric storage model

- `WatchStats` in `src/watch.ts` mirroring `SitemapUrlStats`: `(pk, YYYY-MM)` +
  `dNN` day attributes for `hits`; month-level scalars for `bytesSent`, `cacheHits`,
  `cacheMisses`, `cacheErrors`, `bytesSaved`, `errors`, `redirects`.
  pk: `watch#<matcher>` (group/exact) or `watch#<prefix>#<path>` (split).
  `buildAdd` (incremental ADD, hourly), `buildOverwrite`/`overwriteMany` (idempotent
  SET, backfill), `getForMonth` (reverse index), `getForEntry` (ranged read),
  `parseOne` reshaping `dNN`→`days`. `looseObject` schema so `dNN` survive. No TTL.
- Tests: buildAdd expression; overwrite idempotence; parseOne reshaping.
- **Files:** `src/watch.ts`, `tests/*`.

### Task 5: Watch Athena query + hour/month processors

- `buildWatchHourlyQuery`/`runWatchHourlyQuery` + monthly backfill equivalents.
  group/exact: single aggregate row (`WHERE canonicalUri = matcher` for exact,
  `WHERE cs_uri_stem LIKE prefix || '%'` for group). split: same prefix WHERE +
  `GROUP BY canonicalUri`. Each row: hits, bytes_sent, cache_hits, cache_misses,
  cache_errors, bytes_saved (`sum(scb) WHERE rt IN Hit/RefreshHit`), errors (4xx+5xx),
  redirects (3xx). Reuse the shared cache CASE helper (Task 1) and
  `canonicalUriExpr`/`escapeSqlString`/`toCount` from `src/sitemap.ts` (export/lift to
  shared module).
- `processWatchHour` (applied-marker grain `"watch"`, incremental ADD) and
  `processWatchMonth` (overwrite SET). Add `"watch"` to `MarkerGrain` in
  `src/appliedMarkers.ts`. Watch markers keep the 90-day TTL.
- Tests: SQL shape per mode; hour processor skips on applied marker; month overwrites.
- **Files:** `src/watch.ts`, `src/appliedMarkers.ts`, `tests/*`.

### Task 6: URL directory model + daily/monthly rollup extensions (incl. uniques)

- URL directory in `src/watch.ts` (or `src/urls.ts`): `PK=<url>, SK="url"`,
  `firstSeen` only; `upsertManyFirstSeen({ urls, day })` doing blind
  `SET firstSeen = if_not_exists(firstSeen, :day)`; `listUrls()` via reverse index
  (`sk = "url"`). No TTL.
- Add site-wide + per-country uniques: new Athena `approx_distinct(ip)` builders
  (site-wide for a day, grouped-by-country for a day, and whole-month variants).
  Store uniques as numbers: site-wide on the day/month totals record (new optional
  `uniqueVisitors` field — NON-additive, so written by the rollup, never ADDed);
  per-country as a `uniqueVisitors` attribute on the country breakdown day/month
  records (or a parallel record — decide; keep it read-cheap for the country view).
- Extend `applyDailyRollup` (in `processHour.ts`): after the additive DynamoDB sum,
  run the URL-directory upsert, the sitemap fetch+diff→watch sync, and the day uniques
  Athena scans. Extend `applyMonthlyRollup`: run the fresh month-uniques Athena scan.
  Daily/monthly handlers (`dailyRollup.ts`, `monthlyRollup.ts`) gain Athena env +
  client; `cdk.ts` grants Athena/Glue/S3 to both (clone the hourly grants).
- Sitemap sync: fetch `config.sitemapUrl`, diff against existing `source="sitemap"`
  watch entries — add new as `active`, set dropped ones `stopped`, re-activate
  returning ones.
- Tests: directory idempotence; rollup wires uniques; sitemap diff transitions.
- **Files:** `src/watch.ts`/`src/urls.ts`, `src/athena.ts`, `src/totals.ts`,
  `src/breakdowns.ts`, `src/processHour.ts`, `dailyRollup.ts`, `monthlyRollup.ts`,
  `cdk.ts`, `tests/*`.

### Task 7: Retire sitemap stats model; hourly stops touching sitemap; SDK + backfill + schedule + exports + ADR

- Remove the hourly `SitemapSchedule` and the standalone `sitemap.ts` hourly handler's
  per-run sitemap processing (sitemap sync now lives in the daily rollup). Retire
  `SitemapUrlStats` (replaced by `WatchStats`); keep `fetchSitemapPaths`/parsing (now
  used by the daily sync). Remove/repoint `command/sitemap-backfill.ts` →
  `command/watch-backfill.ts` (per-watch monthly backfill, bounded set).
- Add SDK handler commands for watch management (`upsertWatch`, `setWatchStatus`,
  `deleteWatch`, and sitemap-triggered sync-now) to `sdkHandler.ts`; add matching
  `AnalyticsClient` methods in `sdk.ts`.
- `cdk.ts`: remove `SitemapSchedule`; keep daily/monthly schedules (now Athena-enabled);
  no new CloudFront record fields (confirm `sc_bytes`, `x_edge_result_type` already in
  `requiredRecordFields`). Export new public API through `index.ts`. Add
  `docs/adr-NNN-unified-watch-model.md` (per ADR convention) covering the watch model,
  the directory, the uniques/non-additive decision, and the TTL policy.
- **Files:** `cdk.ts`, `sitemap.ts` (remove/trim), `src/watch.ts`, `sdkHandler.ts`,
  `sdk.ts`, `command/watch-backfill.ts`, `index.ts`, `build.ts`,
  `docs/adr-NNN-unified-watch-model.md`, `tests/*`.

### Task 8: Dashboard service wiring + config transparency env

- `hooks.server.ts`: instantiate `WatchStats` + URL directory model once; add to
  `event.locals.services`; update `app.d.ts`. Route all writes through
  `AnalyticsClient` (SDK), never direct table writes.
- `cdk.ts` (dashboard): `grantAccess` already wires table read + SDK ARN. Add two env
  vars for transparency copy — `ANALYTICS_PROCESSING_LAG_HOURS`,
  `ANALYTICS_HOURLY_TTL_DAYS` — sourced from the processor construct's configured
  values (expose them as readonly fields on `AnalyticsProcessor` and have
  `grantAccess` set them, or pass through dashboard props). Add to dashboard `env.ts`.
- **Files:** dashboard `hooks.server.ts`, `app.d.ts`, `env.ts`, `cdk.ts`; processor
  `cdk.ts` (expose lag/ttl + set env in `grantAccess`).

### Task 9: Dashboard — URLs route, Watchlist route, Settings watch management

- `/urls`: directory list from `listUrls()` with per-row "Add to watchlist" (manual
  `exact` entry via SDK). Metric-free list; graffiti table.
- `/watch`: unified ranked table (bucket / hits / bytes / cache hit-miss-error ratio /
  bytes saved) + per-bucket trend chart; `active`/`stopped` badge + `source`; grain
  switcher + PeriodPicker; reuse window helpers. Replaces the old `/sitemap` route.
- `/settings`: sitemap URL config + watchlist management (add with `*`/`+` sugar parsed
  HERE into `{matcher, mode}`; validate prefix starts with `/`; stop/resume; delete
  manual only). Admin-gated; writes via SDK; non-admin 403.
- Remotes: `watch.remote.ts` (period + trend), `urls.remote.ts` (list + add),
  `watchConfig.remote.ts` (admin list/save/status/delete). Remove `sitemap.remote.ts`,
  `sitemapConfig.remote.ts`, `/sitemap` route, and `sitemapWindow.ts` if superseded
  (or rename to `watchWindow.ts`).
- **Files:** dashboard `routes/urls/`, `routes/watch/`, `routes/settings/`,
  `lib/remote/*`, `lib/*Window.ts`, nav component.

### Task 10: Dashboard — overview cache panel, uniques, status-URL views

- Overview `/`: add cache hit/miss/error ratio panel (counts + percentages from
  additive totals at the selected grain) and site-wide unique-visitor figure
  (day/month; omit at year). Bucket-state legend tooltip.
- Country: render per-country uniques (day/month; omit at year) alongside hits.
- Status: add "URLs that errored / were redirected" view driven by watch
  `errors`/`redirects` metrics (class only).
- Use graffiti components; format bytes human-readable.
- **Files:** dashboard `routes/+page.svelte` + remote, country/status views, remotes.

### Task 11: Dashboard — data-transparency UX + UI cleanup

- Add an "About / Data notes" panel (graffiti disclosure) stating: processing lag
  (~`ANALYTICS_PROCESSING_LAG_HOURS`h — latest hours legitimately empty), hourly
  retention (last `ANALYTICS_HOURLY_TTL_DAYS` days; older → use daily/monthly),
  sitemap refetched daily (+ on config change), watch-forward (no retroactive
  backfill), uniques approximate & not summable & no year grain, and the
  sealed/partial/pending meaning. Render lag/retention from env, rest static.
- Inline cues: "data ~Nh delayed" near period headers; hourly-grain hint when the
  selected period is older than retention; ensure the partial/pending legend has an
  explanation.
- **UI CLEANUP:** remove the legacy top-paths/`__other__` view, the old `/sitemap`
  route and nav entry, and any now-dead components/remotes/labels/helpers. Confirm the
  final nav matches the Final Dashboard Inventory exactly — nothing more.
- **Files:** dashboard `lib/components/*`, `routes/*`, nav, `labels.ts`; delete dead
  files.

### Task 12: Changesets + end-to-end verification

- Read each package `name` before writing changesets. Minor bump for
  `@beesolve/analytics-processor` (cache counts, path-breakdown removal, unified watch
  model, URL directory, uniques, rollup Athena, sitemap retirement, SDK commands) and
  `@beesolve/analytics-dashboard` (new URLs/Watchlist routes, cache/uniques surfaces,
  transparency UX, removed sitemap route). Note the breaking removals (path breakdown,
  `cacheHitRatio`, `/sitemap`) explicitly.
- Full gates across the monorepo: `bun run check`, `bun run type-check`, `bun test`,
  `bun run build`.
- **Files:** `.changeset/*.md`.

## Future Work (out of scope)

- Hard-deletion / purging of a watch entry's historical metric records (currently
  `delete` removes only the config row; metric records linger).
- Per-watch on-demand Athena backfill action in the dashboard ("backfill this watch").
- Country map visualization (data shape is prepared by per-country uniques).
- Yearly uniques (would need a yearly Athena pass or HLL sketches).
- Exact per-URL status codes (kept to class only; use Athena ad-hoc for forensics).
- Exact origin-egress bytes (needs extra CloudFront columns); finer cache taxonomy via
  `x_edge_detailed_result_type`; regex/glob matchers beyond prefix; cache-ratio alerts.
