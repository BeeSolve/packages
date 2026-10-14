# Sitemap URL Stats

## Status: Implemented (pending review)

## Problem Statement

The analytics system aggregates CloudFront access logs into per-period totals and a top-N `path` breakdown. Any path outside the top-100-by-hits per hour collapses into a single `__other__` bucket at ingestion time, permanently losing its identity. Because bots and attack traffic hammer junk URLs (`/wp-login.php`, `/.env`, random probes), those junk paths frequently win the top-100 slots and genuine blog articles get swept into `__other__`. Filtering at query time cannot recover this — the data is already lost once stored.

This feature adds a **separate, parallel data model** for a known set of "real" URLs defined by the site's sitemap (e.g. `https://barlog.sk/sitemap.xml`). The sitemap is fetched every hour and its URL list stored on the config item. A dedicated processor recomputes, per sitemap URL, per-day hit counts for the current month from Athena and **overwrites** them into one DynamoDB item per `(path, year-month)`. This lets the dashboard answer "which article was read most in May 2026 vs June 2025" without junk and without `__other__` loss.

The design is intentionally decoupled from the existing hourly/rollup pipeline. It is additive: no existing key schema or logic changes. The package is 0.x and this model has no existing consumers, so there is no backward-compatibility constraint.

## Architecture / Approach

### Data model (DynamoDB, same shared table)

One item per `(path, year-month)`, flat day attributes incremented/overwritten via `SET` on recompute:

```
pk:   "sitemapurl#<path>"      e.g. "sitemapurl#/blog/how-to-run-bun-on-lambda"
sk:   "<YYYY-MM>"              e.g. "2026-05"
path: "<path>"                 denormalized for the reverse-index read
month:"<YYYY-MM>"
d01:  <hits>                   flat per-day attributes, d01..d31 (only days with data)
d02:  <hits>
...
hits: <month total>           denormalized month rollup
updatedAt: <epoch ms>
```

- **PK = `sitemapurl#<path>`** → query one URL across many months (main table, `KeyConditionExpression: #pk = :pk`, SK `BETWEEN` for a month range).
- **Reverse GSI (`sk` → `pk`, already exists on the table)** → query all URLs for one `YYYY-MM` (`KeyConditionExpression: #sk = :sk` on the reverse index, where reverse pk is the original `sk`).
- Flat `d01..d31` chosen over a nested `days` map: DynamoDB `SET dNN = :v` on a top-level attribute needs no parent-map bootstrapping and avoids the nested-map init race. One `GetItem` still returns the whole month.
- No TTL on these items (long-lived historical comparison data). This differs from hourly totals/breakdowns which carry `ttl`.

### Ingestion model (decision: recompute-and-overwrite, decoupled)

A dedicated **sitemap processor** Lambda runs hourly and does two jobs:

1. **Refresh the sitemap URL set**: fetch the configured sitemap URL, parse `<loc>` entries, normalize each to a path, and store the set on the config item.
2. **Recompute current-month per-day hits**: run one Athena query for the current month grouped by `(day, path)` restricted to the sitemap paths, then for each `(path, month)` **overwrite** `d01..dNN` and `hits` with `SET`.

Overwrite (not `ADD`) makes the job idempotent by construction and makes backfill a non-event: point it at any month and it recomputes from the still-present CloudFront/Athena logs. All hits are counted (no bot filtering — decision locked).

### Path normalization

Sitemap `<loc>` values are absolute (`https://barlog.sk/blog/foo`). CloudFront logs `cs-uri-stem` as the path. Canonicalization (applied identically on both sides so they match):

- Parse the URL and take `pathname` (strips scheme + host + query + fragment).
- **Collapse a trailing slash**: `/blog/` → `/blog`, but root `/` stays `/`. The site 301-redirects `/blog/` → `/blog`; the redirect itself is a logged hit, so both the redirect request (`/blog/`) and the canonical request (`/blog`) must count against `/blog`. Canonicalizing both the stored path and the logged path to the slash-stripped form folds them into one bucket.
- No lowercasing, no percent-decoding beyond what `URL` already does — keep it minimal and deterministic.
- Root `https://barlog.sk/` → `/`; `https://barlog.sk/blog` → `/blog`; `https://barlog.sk/blog/` → `/blog`.
- The sitemap for barlog.sk is a flat `<urlset>` (no sitemap-index); the parser handles `<urlset>` only, and throws a clear error if it encounters a `<sitemapindex>` (future work).

A single `canonicalPath(path: string): string` helper performs the slash-collapse and is used by both the sitemap normalizer and the Athena query (as a SQL expression that strips a trailing slash before the `IN`/`GROUP BY`), so the two sides are guaranteed to agree.

### Types and Schemas

In a new `packages/analytics-processor/src/sitemap.ts`:

```ts
export const sitemapUrlStatSchema = v.object({
  pk: v.string(), // "sitemapurl#<path>"
  sk: v.string(), // "<YYYY-MM>"
  path: v.string(),
  month: v.string(),
  hits: v.number(),
  updatedAt: v.number(),
  // d01..d31 are dynamic numeric attributes, validated loosely (see note)
});
export type SitemapUrlStat = v.InferOutput<typeof sitemapUrlStatSchema>;

export interface SitemapDayCounts {
  readonly path: string;
  readonly month: string; // YYYY-MM
  readonly days: Record<string, number>; // { "01": n, "02": n, ... }
  readonly hits: number;
}
```

Day attributes are dynamic; parse with `v.looseObject` (or parse known fields and read `d01..d31` separately) so unknown `dNN` keys pass. The read helper reshapes `dNN` back into a `days` record and a per-day array for the UI.

Config extension in `packages/analytics-processor/src/config.ts` (same `system#config` / `analytics` item):

```ts
// added to configSchema (all optional for back-compat with existing item):
sitemapUrl: v.optional(v.string()),
sitemapPaths: v.optional(v.array(v.string())),
sitemapFetchedAt: v.optional(v.string()),
```

### Public API Surface

`packages/analytics-processor/src/sitemap.ts`:

- `canonicalPath(path: string): string` — collapse a trailing slash (`/blog/` → `/blog`), leave root `/` intact. Shared by the normalizer and the Athena query.
- `normalizeSitemapLoc(loc: string): string` — URL → `canonicalPath(pathname)`.
- `parseSitemap(xml: string): string[]` — `<urlset>` XML → normalized paths; throws on `<sitemapindex>`.
- `fetchSitemapPaths(url: string): Promise<string[]>` — fetch + parse.
- `class SitemapUrlStats` — DynamoDB access:
  - `buildOverwrite({ path, month, days, hits }): UpdateMembers` — `SET` of `path`, `month`, `hits`, `updatedAt`, and each `dNN`.
  - `overwriteMany(stats: SitemapDayCounts[]): Promise<void>`
  - `getForUrl({ path, startMonth, endMonth }): Promise<SitemapUrlStat[]>` — one URL across months (main table).
  - `getForMonth({ month }): Promise<SitemapUrlStat[]>` — all URLs for a month (reverse index, `queryAll`).
- `buildSitemapMonthlyQuery({ table, source, monthKey, paths }): string` — Athena SQL: group by `(day, path)` for the month, `WHERE` path IN the sitemap set. Reuse `columnMaps`, `hourKeyParts`-style parsing, and the v2/v1 predicate shape from `athena.ts`.
- `runSitemapMonthlyQuery({ athena, database, table, workgroup, outputLocation, source, monthKey, paths }): Promise<SitemapDayCounts[]>`.

Config methods added to `Config`:

- `getSitemapConfig(): Promise<{ sitemapUrl?: string; sitemapPaths?: string[]; sitemapFetchedAt?: string }>`
- `setSitemapUrl({ sitemapUrl }): Promise<void>` — editable from the dashboard.
- `setSitemapPaths({ paths }): Promise<void>` — written by the processor each run.

New handler `packages/analytics-processor/sitemap.ts` (sibling of `hourly.ts`): env-parse, build clients, fetch+store sitemap paths, run the monthly recompute for the current month, overwrite.

Barrel: export `sitemap.ts` and the new config methods from `packages/analytics-processor/index.ts`.

### Cross-Package Dependencies

- No new external deps for parsing: implement a minimal regex/`DOMParser`-free `<loc>` extractor, or add a small pinned XML parser only if needed. Prefer a dependency-free `<loc>` regex extractor given the flat, well-formed sitemap. (Decision: dependency-free extractor; document in the task.)
- Dashboard already depends on `@beesolve/analytics-processor` via `workspace:^` and gets `config` + a new `sitemapUrlStats` service through `event.locals.services`.

### CDK Constructs

In `packages/analytics-processor/cdk.ts`, mirror the `Hourly` function:

- New `Nodejs24Function` "Sitemap" with `entry: ${builtDir}sitemap/`, `handler: "sitemap.handler"`, same `memorySize`/`timeout`, env = `sharedEnvironment` + Athena env (needs `ATHENA_DATABASE`, `ATHENA_V2_TABLE`, `ATHENA_WORKGROUP`, optional `ATHENA_OUTPUT_LOCATION`).
- `this.table.grantReadWriteData(sitemap)` and the same Athena + Glue + S3 (log bucket, results bucket) policy statements as `hourly`.
- Egress: the function makes an outbound HTTPS call to the sitemap URL. No VPC is configured on these functions today, so default internet egress applies — no extra wiring needed. Note this in the task.
- New `Rule` "SitemapSchedule" `Schedule.rate(Duration.hours(1))` targeting the sitemap function.
- Add the new handler to `packages/analytics-processor/build.ts` handlers array (`{ entry: "./sitemap.ts", outDir: "./dist/sitemap" }`).

### Dashboard

- `hooks.server.ts`: construct `const sitemapUrlStats = new SitemapUrlStats({ dynamo, tableName: ANALYTICS_TABLE_NAME, reverseIndexName: ANALYTICS_REVERSE_INDEX })` and add it (plus the already-present `config`) to `event.locals.services`.
- New remote query `packages/analytics-dashboard/src/lib/remote/sitemap.remote.ts`:
  - `getSitemapComparison({ monthA, monthB })` — reads `getForMonth` for both months, joins by path, returns rows `{ path, hitsA, hitsB, delta }` sorted by `hitsB` desc.
  - `getSitemapUrl({ path, startMonth, endMonth })` — one URL's monthly series with per-day arrays.
- **Settings route (admin-only).** Today `/users` is the admin area (list + `[email]` detail + `invite`). Rename this surface to **Settings** (`/settings`) with two sections on one page: **User management** (existing users list/invite, preserved) and **Sitemap** (view + edit the sitemap URL). The nav link changes from "Users" to "Settings" and points at `/settings`.
  - Keep the user-management sub-routes working: either move `users/[email]` and `users/invite` under `settings/users/...`, or keep the deeper routes where they are and only relocate the index page. Preferred: move everything under `settings/` so the admin area is cohesive, updating all internal `href`s and form `action`s. Decide during the task based on least-churn, but the user-facing entry point must be `/settings`.
  - The sitemap URL is editable here **after** initial `/setup` — this is the long-lived settings home, not a one-time setup step. The `/setup` flow itself does not need the sitemap field (sitemap config is optional and set later from Settings).
- New route `packages/analytics-dashboard/src/routes/sitemap/` with a page that renders the two-month comparison. Use graffiti components (Table wrapper, Stack, Card) per the sveltekit-lambda steering — do not hand-roll table CSS.

### Key Design Decisions

- **Recompute-and-overwrite** over incremental `ADD`: trivially idempotent, trivially backfillable, fully decoupled from the hourly pipeline. End numbers identical.
- **Flat `dNN` attributes** over nested `days` map: no parent-map bootstrapping, atomic `SET` per day, single-read whole month.
- **PK = path, SK = month, reverse = month → path**: both access patterns (URL over time, all URLs in a month) from the shared table + existing reverse GSI.
- **All hits counted** (no bot filtering): locked by the user. A `humanHits` dimension is explicit future work.
- **Sitemap URL on the config item, refetched hourly, editable from the dashboard**: locked by the user.
- **Verbatim-origin, slash-collapsed path matching**: strip origin to `pathname`, then collapse a trailing slash on both the stored path and the logged path so `/blog` and the 301-redirect hit on `/blog/` both count against `/blog`. Root `/` is preserved.
- **Separate entity, no backward-compat concern**: 0.x, no existing consumers.
- **No TTL** on sitemap stat items (historical comparison data must persist).

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task. After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check` (tsc per workspace package)
3. `bun test`

**Rules for subagents:**

- Each task must be self-contained.
- No commits — leave changes uncommitted for review.
- Follow project code style (see `.kiro/steering/`): no narrating comments, `== null`/`!= null`, `v.picklist` for string unions, named object params, flat `dNN` not `SNAKE_CASE`, descriptive array-callback names, DynamoDB marshall options already provided by `toDynamoClient`.
- Use `queryAll` from `@beesolve/dynamo-helpers` for paged reads; never expose `ExclusiveStartKey`; Query never Scan.
- No external XML parser dependency — use a dependency-free `<loc>` extractor.
- Mirror existing patterns in the same package (`hourly.ts`, `athena.ts`, `breakdowns.ts`, `config.ts`, `command/backfill.ts`).
- Run `bun install` / `bun run recalculate-dependencies` only if deps change (none expected).

**Operational notes:**

- Build tool is bunup; handlers are built per-entry in `build.ts`.
- Barrel exports via `index.ts` (this repo allows them).
- ADRs live in `packages/analytics-processor/docs/` — create one for this decision.
- Package name is `@beesolve/analytics-processor` (dir `analytics-processor`) and `@beesolve/analytics-dashboard` (dir `analytics-dashboard`) — read `package.json` before writing changesets.

## Tasks

### Task 1: Config schema + sitemap config methods

- [ ] Extend `configSchema` in `packages/analytics-processor/src/config.ts` with optional `sitemapUrl: v.optional(v.string())`, `sitemapPaths: v.optional(v.array(v.string()))`, `sitemapFetchedAt: v.optional(v.string())`. Keep existing fields; existing items without these must still parse.
- [ ] Add `getSitemapConfig()` returning `{ sitemapUrl?, sitemapPaths?, sitemapFetchedAt? }` (reads the same `system#config`/`analytics` item; returns empty object if item missing).
- [ ] Add `setSitemapUrl({ sitemapUrl }: { sitemapUrl: string }): Promise<void>` — `UpdateCommand` `SET #sitemapUrl = :url` on the config key (no condition).
- [ ] Add `setSitemapPaths({ paths }: { paths: string[] }): Promise<void>` — `SET #sitemapPaths = :paths, #sitemapFetchedAt = :now`.
- [ ] Tests: `packages/analytics-processor/tests/config.test.ts` (extend if exists, else create) — set url, read it back; set paths, read back with fetchedAt; existing minimal config item still parses.

**Files:** `packages/analytics-processor/src/config.ts`, `packages/analytics-processor/tests/config.test.ts`

**Acceptance criteria:** `bun test` passes the config tests; `getSitemapConfig` returns stored values and tolerates a legacy item lacking the new fields.

---

### Task 2: Sitemap fetch + path canonicalization (pure functions)

- [ ] Create `packages/analytics-processor/src/sitemap.ts` with `canonicalPath(path: string): string` — collapse a single trailing slash (`/blog/` → `/blog`); leave root `/` unchanged; leave already-unslashed paths unchanged.
- [ ] Add `normalizeSitemapLoc(loc: string): string` — parse URL, apply `canonicalPath(pathname)`; root → `/`; throw on unparseable input.
- [ ] Add `parseSitemap(xml: string): string[]` — extract every `<loc>...</loc>` via a dependency-free matcher, trim, XML-unescape (`&amp;`→`&`, `&lt;`, `&gt;`, `&quot;`, `&#39;`), normalize each; dedupe preserving order (so `/blog` and `/blog/` collapse to one entry). Throw a clear error if the document contains `<sitemapindex` (unsupported; future work).
- [ ] Add `fetchSitemapPaths(url: string): Promise<string[]>` — `fetch`, assert `res.ok`, read text, `parseSitemap`.
- [ ] Tests: `packages/analytics-processor/tests/sitemap.test.ts` — use a fixture copied from the real barlog.sk sitemap (flat `<urlset>`, ~55 entries incl. `https://barlog.sk/` → `/` and `https://barlog.sk/blog` → `/blog`). Assert: `canonicalPath("/blog/") === "/blog"`, `canonicalPath("/") === "/"`, `canonicalPath("/blog") === "/blog"`; count, root mapping, trailing-slash collapse, dedupe of a slash/no-slash pair, and that a `<sitemapindex>` input throws.

**Files:** `packages/analytics-processor/src/sitemap.ts`, `packages/analytics-processor/tests/sitemap.test.ts`, `packages/analytics-processor/tests/fixtures/barlog-sitemap.xml`

**Acceptance criteria:** `bun test` passes parsing tests; `canonicalPath` collapses trailing slashes (root excepted) and `/blog` vs `/blog/` dedupe to a single stored path.

---

### Task 3: Athena monthly-by-day-by-path query

- [ ] In `packages/analytics-processor/src/sitemap.ts`, add `buildSitemapMonthlyQuery({ table, source, monthKey, paths }: { table: string; source: AppliedSource; monthKey: string; paths: string[] })`.
  - Reuse `columnMaps` and the v2/v1 predicate style from `athena.ts` (import or re-export shared helpers; do not duplicate `columnMaps`).
  - Predicate: restrict to the month. v2 uses `year`/`month` Hive partitions; v1 uses `"date"` within the month. Group by `(day, canonicalUri)` — derive the day-of-month from the partition (`day` for v2) or from the timestamp (v1).
  - **Collapse trailing slash in SQL** so `/blog` and `/blog/` fold together, matching `canonicalPath`. Define a `canonicalUriExpr(uriColumn)` SQL fragment, e.g. `CASE WHEN length(uri) > 1 AND substr(uri, -1) = '/' THEN substr(uri, 1, length(uri) - 1) ELSE uri END` (root `/` preserved). Use this expression in both the `GROUP BY` and the `WHERE ... IN` match.
  - `WHERE canonicalUriExpr IN (...)` over the normalized (already slash-collapsed) `paths`, properly single-quote-escaped. If `paths` is empty, return a query that yields no rows (or short-circuit upstream).
  - Select `day`, `canonicalUriExpr AS path_value`, `count(*) AS hits`.
- [ ] Add `runSitemapMonthlyQuery({ athena, database, table, workgroup, outputLocation, source, monthKey, paths }): Promise<SitemapDayCounts[]>` — start query, poll, fetch rows (reuse the `waitForQuery`/`fetchRows` pattern from `athena.ts`; extract shared helpers if practical, else mirror them), reshape into `SitemapDayCounts[]` keyed by path with a `days` record and summed `hits`.
- [ ] Define `SitemapDayCounts` interface in `sitemap.ts`.
- [ ] Tests: `packages/analytics-processor/tests/sitemap-query.test.ts` — assert the SQL string shape for v2 and v1 (month predicate, trailing-slash-collapse expression in both `GROUP BY` and `WHERE IN`, `IN` list escaping, grouping), and empty-paths behavior. (SQL-string assertions, no live Athena.)

**Files:** `packages/analytics-processor/src/sitemap.ts`, `packages/analytics-processor/tests/sitemap-query.test.ts`

**Acceptance criteria:** `bun test` passes query-builder tests; generated SQL restricts to the month and the sitemap path set and groups by day+path.

---

### Task 4: SitemapUrlStats DynamoDB model

- [ ] In `packages/analytics-processor/src/sitemap.ts`, add `sitemapUrlStatSchema` (loose object: known `pk`, `sk`, `path`, `month`, `hits`, `updatedAt` plus dynamic `dNN`) and `SitemapUrlStat` type.
- [ ] Add `class SitemapUrlStats` with constructor `{ dynamo: Pick<DynamoDBDocumentClient,"send">; tableName: string; reverseIndexName?: string }`.
  - `pk = sitemapurl#<path>`, `sk = <YYYY-MM>` (helpers `partitionKey(path)`, keys verbatim).
  - `buildOverwrite({ path, month, days, hits })`: `UpdateExpression` `SET #path=:path, #month=:month, #hits=:hits, #updatedAt=:now, d01=:d01, ...` only for days present in `days`. Use `ExpressionAttributeNames` for `path`/`month`/`hits`.
  - `overwriteMany(stats: SitemapDayCounts[])`: send one `UpdateCommand` per stat (counts are tens-hundreds; no transaction needed).
  - `getForUrl({ path, startMonth, endMonth })`: main-table Query `#pk = :pk AND #sk BETWEEN :start AND :end` via `queryAll`, parse each.
  - `getForMonth({ month })`: reverse-index Query (`IndexName: reverseIndexName`, `#sk = :month`) via `queryAll`, parse each. Reshape `dNN` into a `days` record on read.
- [ ] Tests: `packages/analytics-processor/tests/sitemap-model.test.ts` — unit-test `buildOverwrite` expression members (names/values, only present days) and the key helpers. Reshape-on-read: given an item with `d01`/`d05`, the parsed result exposes those day counts.

**Files:** `packages/analytics-processor/src/sitemap.ts`, `packages/analytics-processor/tests/sitemap-model.test.ts`

**Acceptance criteria:** `bun test` passes model tests; overwrite builds a valid single-item `SET` and both read methods target the correct key/index.

---

### Task 5: Sitemap processor orchestration + handler

- [ ] Add `processSitemapMonth({ monthKey, source, paths, models, athena }): Promise<{ urls: number }>` to `sitemap.ts` (or a sibling `processSitemap.ts` mirroring `processHour.ts`): run `runSitemapMonthlyQuery`, then `models.sitemapUrlStats.overwriteMany(...)`.
- [ ] Add `refreshSitemapPaths({ config, sitemapUrl }): Promise<string[]>` — `fetchSitemapPaths`, `config.setSitemapPaths`, return paths.
- [ ] Create handler `packages/analytics-processor/sitemap.ts` (sibling of `hourly.ts`): parse env (`TABLE_NAME`, `REVERSE_INDEX_NAME`, `ATHENA_DATABASE`, `ATHENA_V2_TABLE`, `ATHENA_WORKGROUP`, optional `ATHENA_OUTPUT_LOCATION`), build `toDynamoClient`, `Config`, `SitemapUrlStats`, `AthenaClient`. Read `config.getSitemapConfig()`; if no `sitemapUrl`, log and return. Else refresh paths, compute `monthKey(new Date())`, `processSitemapMonth` for the current month with `source: "v2"`, log `sitemap <monthKey> urls=<n>`.
- [ ] Guard: if the refreshed path set is empty, skip the Athena query.
- [ ] Tests: `packages/analytics-processor/tests/process-sitemap.test.ts` — `processSitemapMonth` with a fake Athena runner and fake model asserts `overwriteMany` receives the reshaped counts; empty paths short-circuits.

**Files:** `packages/analytics-processor/sitemap.ts`, `packages/analytics-processor/src/sitemap.ts` (or `src/processSitemap.ts`), `packages/analytics-processor/tests/process-sitemap.test.ts`

**Acceptance criteria:** `bun test` passes orchestration tests; handler wiring type-checks against the same env/client pattern as `hourly.ts`.

---

### Task 6: Barrel exports + build entry

- [ ] Add `export * from "./src/sitemap.ts";` (and `./src/processSitemap.ts` if split) to `packages/analytics-processor/index.ts`.
- [ ] Add `{ entry: "./sitemap.ts", outDir: "./dist/sitemap" }` to the handlers array in `packages/analytics-processor/build.ts`.
- [ ] Verify `bun run build` (bunup) emits `dist/sitemap/sitemap.js` with a `handler` export.

**Files:** `packages/analytics-processor/index.ts`, `packages/analytics-processor/build.ts`

**Acceptance criteria:** `bun run build` produces the sitemap handler bundle; `bun run type-check` passes; barrel re-exports resolve.

---

### Task 7: CDK — sitemap Lambda + hourly schedule

- [ ] In `packages/analytics-processor/cdk.ts`, add a `Sitemap` `Nodejs24Function` mirroring `Hourly`: `entry: ${builtDir}sitemap/`, `handler: "sitemap.handler"`, `memorySize`/`timeout`, env = `sharedEnvironment` + `ATHENA_DATABASE`, `ATHENA_V2_TABLE`, `ATHENA_WORKGROUP`, optional `ATHENA_OUTPUT_LOCATION`.
- [ ] Grant `this.table.grantReadWriteData(sitemap)` and attach the same Athena, Glue, and S3 (log bucket + optional results bucket) policy statements used by `hourly`.
- [ ] Add `new Rule(this, "SitemapSchedule", { schedule: Schedule.rate(Duration.hours(1)), targets: [new LambdaFunctionTarget(sitemap)] })`.
- [ ] Note in a comment-free way (ADR, not code) that the function needs outbound HTTPS to fetch the sitemap; default egress applies (no VPC).
- [ ] Tests: extend `packages/analytics-processor/tests/cdk.test.ts` — assert a Lambda with `Handler: "sitemap.handler"` exists, has the Athena env vars, and that an `AWS::Events::Rule` with `rate(1 hour)` targets it.

**Files:** `packages/analytics-processor/cdk.ts`, `packages/analytics-processor/tests/cdk.test.ts`

**Acceptance criteria:** `bun test` passes CDK synth assertions for the new function + schedule + policies.

---

### Task 8: ADR + docs

- [ ] Create `packages/analytics-processor/docs/adr-003-sitemap-url-stats.md` (next free number — verify against existing `docs/`) covering: the `__other__` loss problem, the separate `sitemapurl#<path>` / `YYYY-MM` model, flat `dNN` vs nested map, recompute-and-overwrite vs incremental `ADD`, PK/reverse access patterns, no-TTL, all-hits (bot filtering as future work), and the slash-collapsing path canonicalization applied to both the sitemap paths and the logged `cs-uri-stem` (so `/blog` and the 301 hit on `/blog/` both count against `/blog`). Follow the repo ADR format (Status/Context/Decision/Rationale/Consequences/Alternatives Considered).
- [ ] Update `packages/analytics-processor/DOCS.md` and `docs/how-to/` per the agentic-package-docs convention if the package ships how-to guides: add a short "sitemap URL stats" entry describing config, the processor, and the read model.

**Files:** `packages/analytics-processor/docs/adr-003-sitemap-url-stats.md`, `packages/analytics-processor/DOCS.md` (+ `docs/how-to/*` if applicable)

**Acceptance criteria:** ADR exists and follows the template; DOCS index references the new capability.

---

### Task 9: Dashboard wiring + Settings route (users + sitemap config)

- [ ] `packages/analytics-dashboard/src/hooks.server.ts`: construct `SitemapUrlStats` (table + reverse index) and add `sitemapUrlStats` to `event.locals.services`. `config` is already present.
- [ ] Update the `app.d.ts` / locals service type to include `sitemapUrlStats` (find where `services` is typed).
- [ ] Add a remote module `packages/analytics-dashboard/src/lib/remote/sitemapConfig.remote.ts` with `getSitemapConfig` (query) and `setSitemapUrl` (form), both `requireUser`-guarded and admin-restricted, following `setup.remote.ts`/`breakdowns.remote.ts` patterns.
- [ ] **Rename the admin area from Users to Settings.** Create `packages/analytics-dashboard/src/routes/settings/+page.svelte` as an admin-only page with two sections:
  - **User management** — the existing users list + invite behavior from `routes/users/+page.svelte`.
  - **Sitemap** — a form to view and edit the sitemap URL, calling `getSitemapConfig` / `setSitemapUrl`. Editable here after initial setup. Use graffiti form/input and Stack/Card classes.
- [ ] Move the user sub-routes under settings: relocate `routes/users/[email]` → `routes/settings/users/[email]` and `routes/users/invite` → `routes/settings/users/invite` (or the least-churn variant), updating all internal `href`s and form `action`s accordingly. Remove the old `/users` route (or redirect it to `/settings`).
- [ ] Update `routes/+layout.svelte` nav: change the admin link from `Users` → `Settings` pointing at `/settings` (keep the `data.user.type === "admin"` guard).
- [ ] Leave the `/setup` flow unchanged — the sitemap field lives in Settings, not in one-time setup.

**Files:** `packages/analytics-dashboard/src/hooks.server.ts`, `packages/analytics-dashboard/src/lib/remote/sitemapConfig.remote.ts`, dashboard locals type file, `packages/analytics-dashboard/src/routes/settings/**`, `packages/analytics-dashboard/src/routes/+layout.svelte`, (removed) `packages/analytics-dashboard/src/routes/users/**`

**Acceptance criteria:** `bun run type-check` passes for the dashboard; the admin nav link reads "Settings" and routes to `/settings`; user management (list/invite/detail) still works under the new location; the sitemap URL can be read and saved and round-trips through `config.getSitemapConfig`.

---

### Task 10: Dashboard sitemap comparison view

- [ ] New remote `packages/analytics-dashboard/src/lib/remote/sitemap.remote.ts`:
  - `getSitemapComparison({ monthA, monthB })` (Valibot `YYYY-MM` strings): call `sitemapUrlStats.getForMonth` for each month, join by path, return `{ monthA, monthB, items: Array<{ path, hitsA, hitsB, delta }> }` sorted by `hitsB` desc then `hitsA` desc.
  - `getSitemapUrl({ path, startMonth, endMonth })`: `getForUrl` → monthly series with per-day arrays.
  - Guard with `requireUser`, map errors via `toRemoteError`.
- [ ] New route `packages/analytics-dashboard/src/routes/sitemap/+page.svelte` (+ `+page.server.ts` if needed): month-A / month-B pickers defaulting to current month vs same month last year, render the comparison as a graffiti Table (Table wrapper + Stack/Card). No hand-rolled table CSS; use graffiti components/tokens per the sveltekit-lambda steering.
- [ ] Add a nav entry/link to the sitemap view alongside the existing breakdowns/overview navigation.

**Files:** `packages/analytics-dashboard/src/lib/remote/sitemap.remote.ts`, `packages/analytics-dashboard/src/routes/sitemap/+page.svelte` (+ server if needed), nav/layout file

**Acceptance criteria:** `bun run type-check` passes; the page renders a two-month comparison joined by path, sorted by the later month's hits, excluding anything not in the sitemap set (naturally, since only sitemap items exist in this model).

---

### Task 11: Backfill command

- [ ] Create `packages/analytics-processor/command/sitemap-backfill.ts` mirroring `command/backfill.ts`: args `--from <YYYY-MM>` `--to <YYYY-MM>` (month range), `--source v1|v2` (default v2). For each month in range, `refreshSitemapPaths` once (or read `--sitemap-url`), then `processSitemapMonth` and overwrite. Pool with a small concurrency.
- [ ] Both sources must work: v2 uses the `year`/`month` partitions + `day` partition; v1 uses `"date"` within the month + timestamp-derived day. Both flow through `buildSitemapMonthlyQuery`'s `source` param, so no per-source code paths beyond that. Document the overwrite caveat: for a month whose logs are split across both v1 and v2 tables, running both sources means the later run overwrites rather than sums; backfill each month from the single source that owns it (barlog.sk has a clean v1→v2 date cutover).
- [ ] Add a `sitemap-backfill` script to `packages/analytics-processor/package.json` (`"sitemap-backfill": "bun run command/sitemap-backfill.ts"`).
- [ ] Tests: `packages/analytics-processor/tests/sitemap-backfill.test.ts` — arg parsing (month range validation, source default, invalid range throws), mirroring `backfill` arg-parse tests.

**Files:** `packages/analytics-processor/command/sitemap-backfill.ts`, `packages/analytics-processor/package.json`, `packages/analytics-processor/tests/sitemap-backfill.test.ts`

**Acceptance criteria:** `bun test` passes arg-parse tests; the command recomputes and overwrites a given month range (overwrite semantics make reruns idempotent).

---

### Task 12: Changesets + end-to-end verification

- [ ] Read `package.json` `name` for both packages before writing changesets. Add a `.changeset/*.md` for `@beesolve/analytics-processor` (minor: sitemap URL stats model, processor, CDK, backfill) and one for `@beesolve/analytics-dashboard` (minor: sitemap config form + comparison view).
- [ ] Run full gates across the workspace: `bun run check`, `bun run type-check`, `bun test`, `bun run build`.
- [ ] Confirm no regressions in existing analytics-processor tests and the dashboard build.

**Files:** `.changeset/*.md`

**Acceptance criteria:** All gates green workspace-wide; changesets reference correct package names and bump levels.

---

## Future Work (out of scope)

- **Bot-excluded (`humanHits`) per-day counts** — add a non-bot `device` filter to the monthly Athena query and store a parallel `hNN`/`humanHits`, with a UI toggle.
- **`<sitemapindex>` fan-out** — follow child sitemaps for sites with multiple sitemaps.
- **Multi-site / per-tenant** — the model and config are single-site today.
- **Automatic monthly scheduling of prior-month finalization** — current design recomputes only the current month hourly; prior months are updated only via backfill or if the running month rolls over mid-run.
