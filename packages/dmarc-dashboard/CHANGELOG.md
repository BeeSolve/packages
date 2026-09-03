# @beesolve/dmarc-dashboard

## 0.4.6

### Patch Changes

- c83156a: Make the dashboard mobile friendly.

  - Wrap all data tables (domain overview, source IPs, authorized senders,
    reports, report records, processing stats, users) in a shared
    `.table-scroll` container so wide tables scroll horizontally within their
    own bounds instead of forcing the whole page to scroll sideways on narrow
    screens.
  - Make the header nav responsive: below 40rem it wraps onto multiple rows and
    tightens spacing so the brand, links, and actions stay reachable.
  - Add a viewport guard (`min-width: 0` on the main container) so no child can
    force the page wider than the viewport.

## 0.4.5

### Patch Changes

- 105a989: Support running the dashboard locally against the real backend.

  - Inject a DEV-only fake session (guarded by `import.meta.env.DEV`) built from a
    `DEV_USER_EMAIL` env var, so `bun run dev` resolves a real user without a
    sign-in flow. Compiled out of the deployed Lambda bundle.
  - `dev` script now runs `bun --env-file=.env.local vite dev` so the local env is
    loaded into `process.env` before the SDK clients parse it at import.
  - Add `.env.local.example` documenting the full env surface and a Local
    Development section to the README.
  - Add `docs/ipinfo-setup.md` explaining how to obtain and configure an
    ipinfo.io Lite API key for source IP enrichment, locally and in a deployment.

- Updated dependencies [7b49cc3]
  - @beesolve/auth-service@0.14.2

## 0.4.4

### Patch Changes

- 8bcf6d8: Bump `kit-on-lambda` to `^0.7.0`, which serves static assets from a REST S3
  origin with Origin Access Control instead of an S3 website origin. Missing
  assets now return a clean 404 with the correct Content-Type instead of an HTML
  fallback, so a version skew or partial upload no longer manifests as
  "Importing a module script failed" / silent styling breakage. The assets
  bucket also becomes fully private.

## 0.4.3

### Patch Changes

- f7f484c: Fix the theme toggle in the production build. Vite 8 uses lightningcss as its
  CSS transformer, and SvelteKit's SSR build defaults `build.cssTarget` to a Node
  target, which lightningcss interprets as an ancient browser set and uses to
  lower `light-dark()` into a `prefers-color-scheme` polyfill. That polyfill only
  tracks the OS preference and ignores the `color-scheme` property, so the toggle
  (which flips `color-scheme` on `<html>`) had no visual effect in the deployed
  app even though it worked in `vite dev`. Pin the CSS transformer targets and
  `build.cssTarget` to browsers with native `light-dark()` support so the built
  CSS keeps `light-dark()` intact and the toggle works.

## 0.4.2

### Patch Changes

- Republish the dashboard build under a new version. The theme-toggle and
  native-dialog fix was assigned to `0.4.1`, but `0.4.1` had already been
  published to npm with an older build, so the fix never shipped. Bump to
  `0.4.2` so the corrected build is publishable and deployable.

## 0.4.1

### Patch Changes

- 55f5c55: Fix the theme toggle and use graffiti's native dialog for the raw-JSON viewer.

  - Initialise the theme override and system scheme synchronously and re-read the
    OS preference on click, so the first toggle persists the correct value.
  - Map the toggle icons explicitly: light → sun, dark → moon.
  - Render the raw-JSON report viewer with graffiti's native `<dialog>`
    (`showModal`/`close`) for a real modal backdrop, Escape-to-close and focus
    trapping.

## 0.4.0

### Minor Changes

- d7d3d62: Add a light/dark theme toggle and polish the dashboard UI.

  - Add a two-state color-scheme toggle in the header (single sun/moon icon).
    It flips to the opposite of the resolved scheme, stores an explicit
    `light`/`dark` override, and reverts to the system default when the target
    matches the OS preference. A no-flash inline script applies any stored
    override before first paint.
  - Fix summary cards on the domain overview and domain detail pages so they lay
    out in a responsive row instead of stacking full-width.
  - Switch the domain detail tabs from the pill variant to plain underline tabs
    and render the per-tab counts as compact tags.
  - Colour the Authorized Senders alignment column (green "Aligned" vs neutral).
  - Pin visited link colour so content links no longer show the browser default.
  - Use a graffiti callout for the IP-refresh notice and a ghost button for the
    refresh action.
  - Vertically centre the header "Sign out" button with the rest of the nav.

## 0.3.1

### Patch Changes

- aa280e0: Set `paths.relative: false` so CSS and JS assets use root-relative paths (`/_app/...`) instead of relative paths (`./_app/...`). Because kit-on-lambda serves routes dynamically, relative asset paths were resolved against the current route depth (e.g. `/domains/_app/...`), returning the SPA fallback HTML instead of the stylesheet and leaving nested routes unstyled.

## 0.3.0

### Minor Changes

- fe9c8e7: Restyle the dashboard to be graffiti-first and add IP enrichment to the report view.

  - Adopt `@drop-in/graffiti` component classes and design tokens throughout: `.stat-card` for summary cards, `.tag` (driven by `--tag-color`) for verdict/status/disposition badges, `.button` variants for actions, and graffiti's global table/input/form styling. Custom CSS remains only for genuine gaps (top-bar layout, calendar widget, stats bar chart, JSON modal shell, full-row tints).
  - Replace the hand-rolled JS tab control on the domain view with graffiti's native `<details name>` `.tabs.pill` component (no JavaScript, accessible by default).
  - Fix the domain view layout so the summary cards and calendar sit together in the top bar and no longer overlap the tabs.
  - Show the enriched source IP origin (network operator · country) in the report detail view, matching the domain view.

### Patch Changes

- e2eee3c: Pin `typescript` to `~6.0.3` for the dashboard. `svelte-check` does not support TypeScript 7 without the `--tsgo` flag and a dual TS6/TS7 install, which was breaking the `type-check` CI step.
- f7e28a0: Update dev dependencies: `@sveltejs/kit` ^2.70.3, `svelte` ^5.57.0, `vite` ^8.2.2, and `typescript` ^7.0.2.
- Updated dependencies [f7e28a0]
- Updated dependencies [f7e28a0]
  - @beesolve/auth-service@0.14.1
  - @beesolve/dmarc-parser@0.1.1

## 0.2.1

### Patch Changes

- 5148324: Fix the IP-details backfill and improve the dashboard.

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

- Updated dependencies [5148324]
  - @beesolve/dmarc-consumer@0.2.1

## 0.2.0

### Minor Changes

- 46113a7: Add optional source IP enrichment (ASN + country) via ipinfo.io Lite, plus a
  per-domain backfill job for historical data.

  - `dmarc-consumer` gains an `IpInfoCache` (`./ip-info` export) that caches per-IP
    ASN/country lookups as `ipinfo#<ip>` items in the existing table. Caching is
    presence-only: an IP is looked up once and reused thereafter, with no TTL or
    staleness refresh (`fetchedAt` is stored as metadata only). The consumer enriches
    source IPs at ingestion time when `IPINFO_API_KEY` is configured, and skips
    enrichment entirely when it is not. The consumer Lambda has read+write on the table
    and accepts an optional `ipInfoApiKey` CDK prop.
  - `dmarc-consumer` also gains a per-domain backfill feature: a `BackfillSdk` (`./sdk`
    export) and an SQS-driven worker Lambda that paginates existing reports for a domain
    (never scans), collects unique source IPs, and populates the enrichment cache for
    historical data. Backfill state (a single latest-per-domain config record plus
    per-run history) is tracked in the table, writes are transactional, and the
    `DmarcConsumer` construct exposes `grantBackfill(lambda)` to let a caller (the
    dashboard) enqueue runs.
  - `dmarc-dashboard` domain detail now shows an Origin (ASN · country) column, a
    plain-language Verdict per source IP (legitimate / forwarded / suspicious / likely
    spoofing), a "Spoofing Blocked" summary card, surfaced `headerFrom` / raw SPF+DKIM
    results / policy-override reasons, an Authorized Senders alignment panel, and a
    scope note clarifying that aggregate reports are domain-level only. The domains list
    gains a per-domain "Run backfill" button, gated by backfill status.

### Patch Changes

- Updated dependencies [46113a7]
  - @beesolve/dmarc-consumer@0.2.0

## 0.1.5

### Patch Changes

- Updated dependencies [562809c]
  - @beesolve/email-service@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [ebd8317]
  - @beesolve/auth-service@0.14.0

## 0.1.3

### Patch Changes

- ce36c9d: UI fixes: sign-out button styling, calendar month selection indicator, form spacing, verify page reference code and expiry timer

## 0.1.2

### Patch Changes

- b81b76f: Add admin promotion/demotion, invite email notification, and session revocation on user deletion

## 0.1.1

### Patch Changes

- bd74fdf: Add sign out button to the navigation header

## 0.1.0

### Minor Changes

- a08175b: feat: dashboard UX, processing stats & daily aggregation (Phase 6)

  **dmarc-parser**

  - Export `dmarcRecordSchema` for downstream validation

  **dmarc-reports**

  - Handler no longer throws on auth/spam/virus failures — emits `DmarcProcessingStats` EventBridge events instead
  - Removed DynamoDB dependency from handler (stats persisted by consumer)
  - Export `statsDetailType`, `statsCounters`, `StatsCounter`, `dmarcProcessingStatsEventSchema`

  **dmarc-consumer**

  - Subscribe to `DmarcProcessingStats` events and persist daily counters via `ProcessingStats` class
  - Add `ProcessingStats` entity (pk=`stats#daily`, sk=date, atomic ADD counters)
  - Add `getReport()` method (O(1) GetItem with full composite key)
  - Add `getDailyAggregate()` and `getDailyAggregateAllDomains()` for future alert emails
  - Add `ReportNotFoundError` for explicit not-found handling
  - Export `./processing-stats` subpath

  **dmarc-dashboard**

  - Visual overhaul: theme, nav, summary cards, status badges
  - Source IP analysis table on domain detail page
  - Report drill-down page with full per-record auth results
  - Calendar date filter with server-side time-range queries
  - Processing stats admin page (last 30 days, daily breakdown)
  - Aggregate helper for computing per-domain metrics

### Patch Changes

- Updated dependencies [a08175b]
  - @beesolve/dmarc-parser@0.1.0
  - @beesolve/dmarc-consumer@0.1.0

## 0.0.7

### Patch Changes

- 747300c: Run vite build in prepublishOnly to include SvelteKit output in published package, remove buildDirectory prop

## 0.0.6

### Patch Changes

- c0d250e: Build cdk.ts via bunup, pre-build authConsumer lambda, output SvelteKit to dist/build via adapter config
- @beesolve/dmarc-consumer@0.0.4

## 0.0.5

### Patch Changes

- Fix published files — include cdk.ts, src/authConsumer.ts, and build directory instead of empty dist

## 0.0.4

### Patch Changes

- Fix dependency version ranges for workspace packages (dmarc-consumer was unresolvable at ^0.0.1)

## 0.0.3

### Patch Changes

- 67f4065: Pin TypeScript to v6 for svelte-check compatibility (svelte-check does not yet support TS7 as sole version)
- @beesolve/dmarc-consumer@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [d54dca7]
- Updated dependencies [f8e3f7b]
- Updated dependencies [d54dca7]
- Updated dependencies [d674ccd]
  - @beesolve/auth-service@0.13.0
  - @beesolve/cdk-constructs@0.3.0
  - @beesolve/lambda-fetch-api@2.1.0
  - @beesolve/dmarc-consumer@0.0.2
  - @beesolve/email-service@0.3.6
