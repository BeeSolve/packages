# CloudFront Analytics (v2 logging + processor + dashboard)

## Status: Not Started

## Problem Statement

We want analytics for a site served behind CloudFront. Logs are delivered to S3 via the `CloudFrontAccessLoggingSettings` construct (`packages/cdk-constructs/src/cloudFrontAccessLoggingSettings.ts`), which today provisions legacy (v1) tab-delimited standard logs plus a Glue table + Athena workgroup over them.

This project has three parts, in strict order:

1. **Modernize `CloudFrontAccessLoggingSettings` to add CloudFront standard logging v2** (Apache Parquet + Hive partitioning + field selection) delivered to a `/v2/...` prefix in the SAME existing log bucket, with a SECOND Glue table over the v2 Parquet data. The v1 logging stays in place untouched (no bucket deletion, no data loss). This must land first because the dashboard is built around v2 from day one.
2. **`@beesolve/analytics-processor`** — a single-table DynamoDB design (+ reverse GSI) and scheduled Lambdas. An hourly Lambda runs ONE Athena query over a just-closed hour's **v2** partition and writes detailed hourly totals + per-dimension breakdowns using ATOMIC counter updates. Daily and monthly rollup Lambdas read earlier DynamoDB items back and sum them (never re-query Athena). A ONE-TIME standalone backfill script walks the historic **v1** data (there is no historic v2 data) and fills the table using the same write path. Country is derived from top-N client IPs via an `IpInfoCache` (CloudFront logs — v1 and v2 — contain no viewer-country field).
3. **`@beesolve/analytics-dashboard`** — a SvelteKit app published as a CDK construct, on kit-on-lambda behind `AuthGateway`, reading the processor table (read-only) and rendering breakdowns with graffiti. All reads are bounded `Query` calls (never `Scan`); window sizes are clamped server-side; pagination keys are computed deterministically from the time anchor (no DynamoDB cursors).

Single-site: each `CloudFrontAccessLoggingSettings` deployment has its own log bucket/Glue tables, so one processor instance serves one distribution. No `siteId` in the keys.

## Architecture / Approach

### Part 1 — Standard logging v2 (cdk-constructs)

Confirmed available in the installed `aws-cdk-lib` 2.267.0: `CfnDeliverySource`, `CfnDeliveryDestination`, `CfnDelivery` in `aws-cdk-lib/aws-logs`. No raw CloudFormation / custom resources needed.

Wiring (all additive to the existing construct; v1 path left intact):

- `CfnDeliverySource` — `logType: "ACCESS_LOGS"`, `resourceArn` = the CloudFront distribution ARN. (The construct currently returns `cloudFrontLoggingSettings` for the distribution; it must also accept or be told the distribution ARN. Add a prop `distributionArn?: string` OR expose a method `enableV2Logging({ distributionArn })` called after the distribution exists, to avoid a cyclic dependency. Prefer a method, since the ARN is only known once the distribution is constructed by the consumer.)
- `CfnDeliveryDestination` — `destinationResourceArn` = the existing log bucket ARN, `outputFormat: "parquet"`.
- `CfnDelivery` — ties source→destination with:
  - `s3EnableHiveCompatiblePath: true` (native Hive-style partitioning)
  - `s3SuffixPath: "v2/{DistributionId}/{yyyy}/{MM}/{dd}/{HH}"` — v2 data lands under a `v2/` prefix in the same bucket, partitioned by distribution + hour; v1 keeps landing at the existing root/`logFilePrefix`.
  - `recordFields` — select ONLY the columns the processor needs, in a fixed order: `timestamp`, `sc-status`, `sc-bytes`, `cs-bytes`, `time-taken`, `x-edge-result-type`, `x-edge-detailed-result-type`, `cs-uri-stem`, `c-ip`, `cs-user-agent`. (Smaller Parquet → cheaper Athena scans. Exact v2 field names per the CloudFront standard-logs reference; the construct is the source of truth for the chosen list.)
- A SECOND Glue table (`cf_logs_v2_table`, configurable) over `s3://<logBucket>/v2/<distributionId>/`:
  - Parquet SerDe (`org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat` / `...parquet.serde.ParquetHiveSerDe`), NOT the v1 LazySimpleSerDe.
  - `partitionKeys`: `year`, `month`, `day`, `hour` (all string), matching the Hive path. Enable partition projection via table parameters (`projection.enabled=true`, range/format for each key) so Athena needs no `MSCK REPAIR` / Glue crawler — the processor can query any hour by predicate immediately.
  - Columns = the selected `recordFields`, typed (status/bytes/time as the appropriate numeric types where Parquet allows, else string).

New `athena` sub-props on `CloudFrontAccessLoggingSettingsProps` (all optional, additive): `v2?: { enabled: boolean; glueV2TableName?: string (default cf_logs_v2_table); outputPrefix?: string (default "v2") }`. Keep the existing v1 `athena` behavior exactly as-is when `v2` is absent.

The upgraded construct is **v2-only for collection**: it sets `enableLogging: false` in the returned `cloudFrontLoggingSettings` (and wires only the v2 delivery pipeline), so deploying the new version stops new v1 log collection and starts v2 Parquet under `/v2/`. Already-collected v1 objects and the v1 Glue table remain in the bucket untouched (the backfill reads them as a frozen historic dataset). There is no v1/v2 toggle and no cutover runbook; losing a seam hour at the switch is acceptable (single-user, personal use).

The construct exposes the v2 Glue db/table names + the log bucket + Athena workgroup so a consuming stack can pass them to `AnalyticsProcessor`.

An ADR in `packages/cdk-constructs/docs/` records: why v2 (Parquet/partitioning/field-selection → cheaper, faster Athena), why same bucket + `/v2/` prefix (no destruction of v1 data), partition-projection choice, and that v2 still has no country field.

### Part 2 — DynamoDB single-table design (analytics-processor)

One `TableV2`, composite `pk` + `sk` (STRING), on-demand billing, `timeToLiveAttribute: "ttl"`, one reverse GSI `"reverse"` (GSI pk=`sk`, GSI sk=`pk`, `ProjectionType.ALL`) — same shape as `packages/dmarc-consumer/cdk.ts`.

Fixed-width, lexicographically sortable UTC time keys: hour `YYYY-MM-DD-HH`, day `YYYY-MM-DD`, month `YYYY-MM`, year `YYYY`. `grain ∈ hour | day | month`.

**Item type 1 — time-series totals (time in `sk`, one partition per grain):**

```
pk = totals#<grain>          grain ∈ hour | day | month
sk = <timeKey>               2026-02-14-09 | 2026-02-14 | 2026-02
```

Additive attributes (ALL grains, written via atomic `ADD`): `hits`, `success` (2xx+3xx), `errors`, `errors4xx`, `errors5xx`, `bytesSent`, `bytesReceived`.
Metadata (written via `SET`): `grain`, `timeKey`.
Hourly extra detail (`SET`, not additive — percentiles/ratios cannot be summed on re-run): `p50TimeTaken`, `p95TimeTaken`, `cacheHitRatio`, `uniqueIpCount`.
Hourly items carry `ttl`; day/month do not.

Rationale for time-in-`sk`: tiny volumes (hourly ≤ `24 × ttlDays`), no hot partition at single-digit RPS, and all buckets of a grain in one partition make rolling cross-boundary windows a single `Query`.

**Item type 2 — breakdowns (period folded into `pk`, bounded, bare `pk =` fetch):**

```
pk = breakdown#<dimension>#<grain>#<periodKey>     dimension ∈ status | country | device | path
sk = <value>                                       US | 404 | mobile | /pricing
```

Additive attributes (atomic `ADD`): `hits`, `bytes`. Metadata (`SET`): `dimension`, `grain`, `periodKey`, `value`. `country`/`status`/`device` stored in full; `path` top-N (default 100) + a single `__other__` item. Hourly-grain breakdown items carry `ttl`; day/month do not.

**Item type 3 — idempotency / exactly-once marker:**

```
pk = applied#<grain>#<periodKey>     e.g. applied#hour#2026-02-14-09
sk = "applied"
```

Written CONDITIONALLY (`attribute_not_exists(pk) AND attribute_not_exists(sk)`) as part of the SAME `TransactWriteCommand` that performs the additive `ADD` updates for that period. If the marker already exists the transaction is cancelled and the whole write is skipped — so re-running an hour (hourly cron overlap, backfill re-run, SQS redelivery in future) never double-counts. The marker carries a `ttl` for hourly grain matching the hourly data TTL. Attributes: `source` (`"v1" | "v2"`), `appliedAt`.

**Dimension values:** `status` = sc-status string; `device` = classifier over user-agent → `mobile|desktop|bot|other`; `path` = `cs-uri-stem` top-N + `__other__`; `country` = ISO code from `c-ip` via `IpInfoCache`, unresolved → `ZZ`.

### Atomic write path (`processHour`)

All counter writes go through atomic `UpdateCommand` with `ADD` for numeric fields and `SET` for metadata/non-additive detail (mirrors `Domains.upsert` / `ProcessingStats.increment` in dmarc-consumer). The hourly totals row + all its breakdown items + the idempotency marker for that hour are written so that the hour is applied exactly once:

- `processHour({ hourKey, source, models, athena })` is the single shared entry point used by BOTH the hourly Lambda and the backfill script.
  1. Pre-check the marker (`applied#hour#<hourKey>`); if present, return early (no Athena, no writes).
  2. Run the Athena hourly query against the table for `source` (v2 Parquet table for ongoing, v1 table for backfill), partition-pruned to that hour.
  3. Resolve top-N IPs → country via `IpInfoCache.enrichMany` (skip/`ZZ` when no API key).
  4. Write via a `TransactWriteCommand` containing: the conditional marker put, the totals `ADD`/`SET` update, and the breakdown `ADD`/`SET` updates. (DynamoDB transactions cap at 100 items; breakdowns per hour are bounded — status ~dozens, device ≤4, country ≤~200, path ≤ topN+1. If the total exceeds 100 items, chunk: write the marker + totals in the first transaction, then breakdowns in follow-up transactional/batched writes guarded by the marker already being set. The task must handle the >100 case explicitly.)

Daily/monthly rollups similarly use `ADD` into the coarser `totals#day`/`totals#month` + breakdown partitions, each guarded by an `applied#day#<dayKey>` / `applied#month#<monthKey>` marker, reading finer-grain items via `queryAll` (never Athena).

### Athena query (dual-table: v2 ongoing, v1 backfill)

`buildHourlyQuery({ table, source, hourKey, topPaths })` emits ONE statement scoped to a single UTC hour:

- **v2 source**: predicate on the Hive partition columns (`year/month/day/hour`) → partition pruning on Parquet (cheap). Column names = the v2 selected fields.
- **v1 source**: predicate on `"date"` + `time` columns of the legacy tab-delimited table; LazySimpleSerDe column names/quoting (the 33-column schema).

Both compute the same aggregates: conditional sums for status classes, `approx_percentile(time_taken, 0.5/0.95)`, cache-hit ratio from `x_edge_result_type`, `count(distinct c_ip)`, grouped top-N `cs_uri_stem`, grouped `sc_status`, derived device bucket, and top-N `c_ip` for country. Execution: `StartQueryExecution` → poll `GetQueryExecution` with backoff → paginate `GetQueryResults`. A column-name/quoting map per source lives in the Athena module (source of truth).

A ~2-hour processing lag is applied to the ongoing hourly schedule/handler (process hour `H` at ≈`H+2`) because v2 delivery can lag up to ~an hour; configurable.

### Backfill script (one-time, standalone)

`packages/analytics-processor/src/backfill.ts`, run via `bun run backfill -- --from <ISO> --to <ISO>` (uses `toDynamoClient()` which honors `AWS_PROFILE`). Iterates the historic hour range, calling `processHour({ hourKey, source: "v1", ... })` for each hour sequentially (small bounded concurrency allowed). No timeout concern (it is a loop, not a Lambda). Fully resumable + exactly-once via the idempotency marker — already-applied hours skip instantly. Prints progress (processed/skipped/failed counts). After the per-hour v1 fill, it can optionally invoke the daily/monthly rollups over the backfilled range so coarse aggregates exist for history.

### Public API surface

`@beesolve/analytics-processor` barrel: schemas/types (`totalsSchema`/`TotalsItem`, `breakdownSchema`/`BreakdownItem`, `appliedMarkerSchema`, `grains`/`Grain`, `dimensions`/`Dimension`), time-key + window helpers (`hourKey`/`dayKey`/`monthKey`, `maxWindowFor`, `windowKeys`, `shiftAnchor`), model classes (`Totals`, `Breakdowns`, `AppliedMarkers`, `IpInfoCache` + `lookupIpInfo` + `IpInfo`/`IpInfoCacheItem`), the pure helpers (`buildHourlyQuery`, `classifyDevice`, `sumTotals`/`sumBreakdown`/`topNWithOther`), and `processHour`. Handlers/`backfill` are NOT exported from the barrel. `./cdk` exports `AnalyticsProcessor`.

`@beesolve/analytics-dashboard/cdk` exports `AnalyticsDashboard` (only published entry).

### Model class conventions

Copy dmarc-consumer: plain class, constructor `{ dynamo: Pick<DynamoDBDocumentClient,"send">; tableName: string; reverseIndexName? }`, `readonly` arrow methods with named props, Valibot `schema` + private `parseOne` (log `v.flatten`, throw `Malformed stored <X> record`), private `toItem`. Marshall options via `toDynamoClient()` from `@beesolve/helpers-dynamo`; range reads via `queryAll`.

### Dashboard query rules (server-side)

Clamp window size from URL: hourly ≤24, daily ≤30, monthly ≤12, yearly ≤10. Compute boundary keys from `{ anchor, size }` (stateless, no DynamoDB cursor); `next`/`prev` shift the anchor by window size (rolling, cross-boundary allowed). Always `queryAll` to drain any >1MB page. NEVER `Scan`.

### Cross-package dependencies

- `cdk-constructs`: no new runtime deps (uses `aws-cdk-lib/aws-logs` already available).
- `analytics-processor`: `@beesolve/helpers`, `@beesolve/helpers-dynamo` (`workspace:^`), `@beesolve/cdk-constructs` (`workspace:^`), `@aws-sdk/client-athena`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `valibot`, `aws-cdk-lib`, `constructs` (match dmarc-consumer versions / `catalog:`).
- `analytics-dashboard`: `@beesolve/analytics-processor` (`workspace:^`, for `/cdk` + shared helpers + model classes), `@beesolve/auth-service`, `@beesolve/email-service`, `@beesolve/cdk-constructs`, `kit-on-lambda`, `@drop-in/graffiti`, `@beesolve/lambda-fetch-api`, `valibot`, SvelteKit toolchain (mirror `packages/dmarc-dashboard/package.json`).

The dashboard reuses the processor's model classes for reads; no app-local analytics models — only app-local `Users`/`Setup` copied from dmarc-dashboard.

### CDK constructs

**`AnalyticsProcessor`** (modeled on `DmarcConsumer`): props `{ athenaDatabase; athenaV2Table; athenaV1Table?; athenaWorkgroup; athenaOutputLocation?; logBucketArn; athenaResultsBucketArn?; ipInfoApiKey?; topPaths?; hourlyTtlDays? (default 90); processingLagHours? (default 2); removalPolicy?; processorProps? }`. Creates the table + reverse GSI; three `Nodejs24Function`s (`Hourly`/`DailyRollup`/`MonthlyRollup`) with entries at built dirs; env wiring (`TABLE_NAME`, `REVERSE_INDEX_NAME`, `HOURLY_TTL_DAYS`, `TOP_PATHS`, `PROCESSING_LAG_HOURS`, and for hourly: `ATHENA_DATABASE`, `ATHENA_V2_TABLE`, `ATHENA_WORKGROUP`, optional `ATHENA_OUTPUT_LOCATION`, optional `IPINFO_API_KEY`); `table.grantReadWriteData` to all three; hourly handler IAM for `athena:StartQueryExecution|GetQueryExecution|GetQueryResults|StopQueryExecution`, `glue:GetTable|GetDatabase|GetPartitions`, and `s3:GetObject|ListBucket|GetBucketLocation` on the log bucket + `s3:PutObject` on the Athena results location (least-privilege; broader documented policy acceptable with a TODO). Schedules: `Schedule.rate(Duration.hours(1))` for hourly, daily cron (`minute:15 hour:0`), monthly cron (`minute:30 hour:1 day:1`). Public `grantRead(handler)` → `grantReadData` + `ANALYTICS_TABLE_NAME` / `ANALYTICS_REVERSE_INDEX`. Expose `table`, `reverseIndexName`. (The backfill script is NOT a Lambda; it is a package bin run by an operator and needs no construct wiring beyond the table/Athena already existing.)

**`AnalyticsDashboard`** (modeled on `DmarcDashboard`): props `{ auth: AuthGateway; processor: AnalyticsProcessor; emailSender }`. `SvelteKit` on kit-on-lambda; `toDefaultOrigin` does `auth.addAuthorizedEndpoint`/`grantSdkAccess`/`processor.grantRead(handler)` and returns `HttpOrigin(Fn.parseDomainName(auth.api.url))`; ensureCookie `viewer-request` function association + `/auth/*` behavior; `Emails` + `AuthConsumer` Lambda + `AuthEventsRule`. Because `processor.grantRead` is READ-ONLY, the dashboard creates its OWN small `TableV2` (pk/sk + reverse GSI) for `Users`/`Setup`, wired via `ANALYTICS_USERS_TABLE` / `ANALYTICS_USERS_REVERSE_INDEX`. Expose `distribution`.

### SvelteKit app (mirror dmarc-dashboard)

`vite.config.ts` (kit-on-lambda adapter `out: dist/build`, `paths.relative: false`, remote functions + async compiler, `ssr.external: ["@beesolve/lambda-fetch-api"]`, pinned lightningcss targets). `src/env.ts` `defineEnvVars` with `ANALYTICS_TABLE_NAME`, `ANALYTICS_REVERSE_INDEX`, `ANALYTICS_USERS_TABLE`, `ANALYTICS_USERS_REVERSE_INDEX`. `src/hooks.server.ts` (one `DynamoDBDocumentClient`; `Totals`/`Breakdowns` from `@beesolve/analytics-processor` on the analytics table; `Users`/`Setup` on the users table; `AuthClient`/`Email`; `sequence(createSessionHandle({ fallbackSession }), authGuard)` + `DEV_USER_EMAIL` fallback). `src/app.d.ts` locals typing. Remote functions in `src/lib/remote/*.remote.ts`. Routes mirror dmarc-dashboard; charts hand-rolled on graffiti tokens (graffiti has no chart) with non-colliding class names.

### Key design decisions

- v2 logging FIRST; dashboard built around v2; processor hourly queries the v2 Parquet table. v1 kept intact in the same bucket under the original prefix; v2 under `/v2/...`.
- Backfill reads v1 (no historic v2 exists); ongoing reads v2. One `buildHourlyQuery` with per-source column maps.
- All counters atomic (`ADD`) + per-period `applied#...` idempotency marker in the same transaction → exactly-once, safe re-runs/backfill overlap.
- Backfill is a one-time standalone script sharing `processHour` with the hourly Lambda; no new infra, no timeout, resumable. (MicroVM / durable-functions considered and rejected for a one-time batch job.)
- Country via `IpInfoCache` (top-N IPs); copied into analytics-processor to avoid a backend→backend dependency.
- `totals` time-in-`sk`; `breakdown` period-in-`pk`; no DynamoDB cursors; hourly TTL (default 90d); weekly dropped; ~2h processing lag for v2 delivery.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task. After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task):

1. `bun run check` (oxfmt + oxlint)
2. `bun run type-check` (tsc per workspace package)
3. `bun test` (tests across all packages)

**Rules for subagents:**

- Each task must be self-contained. No commits — leave changes uncommitted for review.
- Follow `.kiro/steering/`: no narrating comments, barrel exports allowed in this repo, `import type`, `== null`/`!= null`, `v.picklist` for string-literal unions, descriptive array-callback names, DynamoDB marshall options `{ removeUndefinedValues: true, convertEmptyValues: false }`, `attribute_not_exists(pk) AND attribute_not_exists(sk)` on composite-key create guards.
- `workspace:^` for intra-monorepo deps, `catalog:` for shared external deps. Run `bun install` after adding deps and `bun run recalculate-dependencies` after changing intra-monorepo deps.
- Package names differ from directory names — read `package.json` `name` before writing changesets. New packages: `@beesolve/analytics-processor`, `@beesolve/analytics-dashboard`.
- Mirror the closest existing package (`dmarc-consumer` for the processor, `dmarc-dashboard` for the dashboard) for config/build layout and `DOCS.md`.
- Each new package needs `docs/adr-001-motivation.md` (mandatory); add further ADRs for significant decisions.
- Include the tests listed in each task alongside the implementation; do not add extra unasked-for tests.

**Operational notes:**

- Build tool is bunup for libraries; the dashboard builds via `vite build` with build-time placeholder env (copy dmarc-dashboard).
- CDK entry dirs point at BUILT handler folders (`${fileURLToPath(new URL(".", import.meta.url))}hourly/`), not `src/`.
- `toDynamoClient()` and `queryAll`/`batchGet` come from `@beesolve/helpers-dynamo`.

## Tasks

### Task 1: Add standard logging v2 to `CloudFrontAccessLoggingSettings`

- [ ] Extend `packages/cdk-constructs/src/cloudFrontAccessLoggingSettings.ts` additively: new optional `athena.v2?: { enabled: boolean; glueV2TableName?: string; outputPrefix?: string }`.
- [ ] Make the upgraded construct v2-only for collection: set `enableLogging: false` in the returned `cloudFrontLoggingSettings` so deploying the new version stops new v1 log collection. Do NOT delete the log bucket or the v1 Glue table — already-collected v1 objects stay for the backfill to read.
- [ ] Add a way to supply the CloudFront distribution ARN without a cyclic dependency — prefer a public method `enableV2Logging({ distributionArn }: { distributionArn: string })` on the construct that the consumer calls after creating the distribution. Inside it, create `CfnDeliverySource` (`logType: "ACCESS_LOGS"`, `resourceArn: distributionArn`), `CfnDeliveryDestination` (`destinationResourceArn: logBucket.bucketArn`, `outputFormat: "parquet"`), and `CfnDelivery` (`s3EnableHiveCompatiblePath: true`, `s3SuffixPath: "<outputPrefix>/{DistributionId}/{yyyy}/{MM}/{dd}/{HH}"`, `recordFields: [timestamp, sc-status, sc-bytes, cs-bytes, time-taken, x-edge-result-type, x-edge-detailed-result-type, cs-uri-stem, c-ip, cs-user-agent]`). Use the exact v2 field names from the CloudFront standard-logs reference.
- [ ] Create the v2 Glue `CfnTable` (name default `cf_logs_v2_table`) over `s3://<logBucket>/<outputPrefix>/`: Parquet input/output formats + `ParquetHiveSerDe`, columns = selected fields (typed), `partitionKeys` = `year/month/day/hour` (string), and partition-projection table parameters (`projection.enabled=true`, `projection.<key>.type`, range/format) so no crawler/`MSCK` is needed. Depend on the existing Glue database (create it if only the v1 path created it; reuse when present).
- [ ] Expose read-only getters for `glueDatabaseName`, `glueV1TableName`, `glueV2TableName`, `workgroupName`, `logBucket`, `athenaResultsBucket` so a stack can pass them to `AnalyticsProcessor`.
- [ ] ADR: `packages/cdk-constructs/docs/adr-00N-standard-logging-v2.md` (why v2, same bucket + `/v2/` prefix, partition projection, no country field in v2).
- [ ] Tests: extend `packages/cdk-constructs/tests/cloudFrontAccessLoggingSettings.test.ts` — when `v2.enabled` + `enableV2Logging` is called, assert one `AWS::Logs::DeliverySource`, one `AWS::Logs::DeliveryDestination` (OutputFormat parquet), one `AWS::Logs::Delivery` (hive path + suffix with `v2/`), a second `AWS::Glue::Table` with Parquet SerDe + 4 partition keys, and `EnableLogging: false` in the distribution logging config (v2-only collection) while the log bucket + v1 Glue table remain present.

**Files:** `packages/cdk-constructs/src/cloudFrontAccessLoggingSettings.ts`, `packages/cdk-constructs/docs/adr-00N-standard-logging-v2.md`, `packages/cdk-constructs/tests/cloudFrontAccessLoggingSettings.test.ts`

**Acceptance criteria:** new v2 tests + existing v1 tests green; `type-check` + `check` clean; a changeset added for `@beesolve/cdk-constructs` (read its `package.json` name first).

---

### Task 2: Scaffold `@beesolve/analytics-processor` + schemas + time/window helpers

- [ ] Create `packages/analytics-processor/` (`package.json` name `@beesolve/analytics-processor`, `type: module`, exports `.`→`index.ts`, `./cdk`→`cdk.ts`, `./package.json`; a `bin`/script entry for backfill; `tsconfig.json`, `tsconfig.cdk.json`, `build.ts`, bunup config) by adapting `packages/dmarc-consumer/`. Add deps (Architecture §Cross-package). `bun install` + `recalculate-dependencies`.
- [ ] `schema.ts`: `grains`/`Grain`, `dimensions`/`Dimension` (`v.picklist`), `totalsSchema`/`TotalsItem`, `breakdownSchema`/`BreakdownItem`, `appliedMarkerSchema`/`AppliedMarker` (fields per Architecture).
- [ ] `time.ts`: pure `hourKey`/`dayKey`/`monthKey` (UTC, zero-padded), `maxWindowFor(grain)` (hour 24 / day 30 / month 12), `windowKeys({ grain, anchor, size })` → `{ startKey, endKey }`, `shiftAnchor({ grain, anchor, size, direction })`, and `hoursBetween({ from, to })` for the backfill iterator.
- [ ] Tests: `tests/time.test.ts` — key formatting; 24h window crossing midnight; `shiftAnchor` exactness; month/year boundary crossing; `hoursBetween` inclusive range + count.

**Files:** `packages/analytics-processor/package.json`, `tsconfig*.json`, `build.ts`, `schema.ts`, `time.ts`, `tests/time.test.ts`

**Acceptance criteria:** new-package `type-check` + `tests/time.test.ts` green; `check` clean.

---

### Task 3: `IpInfoCache` + models (`Totals`, `Breakdowns`, `AppliedMarkers`) with atomic writes

- [ ] Copy `packages/dmarc-consumer/ipInfo.ts` → `packages/analytics-processor/ipInfo.ts` verbatim.
- [ ] `totals.ts` — class `Totals`: `addHourly({ item, ttl })` and `addAggregate({ grain, item })` using `UpdateCommand` with `ADD` for additive numerics + `SET` for metadata/detail; `queryWindow({ grain, startKey, endKey })` (BETWEEN on `pk = totals#<grain>`, drained via `queryAll`); `getOne`. Provide a method that returns the transact-write Update item for a period so `processHour` can bundle it into a `TransactWriteCommand`.
- [ ] `breakdowns.ts` — class `Breakdowns`: `addMany({ dimension, grain, periodKey, items, ttl? })` via `ADD`/`SET` updates (expose transact items for `processHour`); `getForPeriod` (bare `pk =` query drained via `queryAll`).
- [ ] `appliedMarkers.ts` — class `AppliedMarkers`: `isApplied({ grain, periodKey })` (Get), and a method returning the conditional Put transact item (`attribute_not_exists(pk) AND attribute_not_exists(sk)`, with `ttl` for hourly).
- [ ] Tests: `tests/totals.test.ts`, `tests/breakdowns.test.ts`, `tests/appliedMarkers.test.ts` with a fake `dynamo` recording commands — assert `ADD` expressions for counters, `SET` for metadata/detail, BETWEEN window key condition, bare `pk =` for breakdowns, conditional marker expression, TTL present on hourly / absent on day+month.

**Files:** `packages/analytics-processor/ipInfo.ts`, `totals.ts`, `breakdowns.ts`, `appliedMarkers.ts`, `tests/{totals,breakdowns,appliedMarkers}.test.ts`

**Acceptance criteria:** model tests green; atomic `ADD` + marker expressions match the plan; `type-check` + `check` clean.

---

### Task 4: Athena module (dual-source) + device/path/country reducers

- [ ] `athena.ts`: `buildHourlyQuery({ table, source, hourKey, topPaths })` emitting ONE SQL statement; v2 uses Hive partition predicates (year/month/day/hour) on the Parquet table, v1 uses `"date"`+`time` on the tab-delimited table; per-source column-name/quoting maps as the source of truth. `runHourlyAthenaQuery({ athena, database, table, workgroup, outputLocation?, source, hourKey, topPaths })` → `{ totals, byStatus, byDevice, byPath, topIps }` via `StartQueryExecution` → poll → paginate `GetQueryResults`.
- [ ] `device.ts`: pure `classifyDevice(userAgent)` → `mobile|desktop|bot|other`.
- [ ] `reduce.ts`: pure `sumTotals(items)`, `sumBreakdown(items)`, `topNWithOther({ items, n, otherValue: "__other__" })`.
- [ ] Tests: `tests/athena.test.ts` (assert `buildHourlyQuery` output for both sources — correct table, partition vs date/time predicate, top-N clause — no AWS calls), `tests/device.test.ts`, `tests/reduce.test.ts`.

**Files:** `packages/analytics-processor/athena.ts`, `device.ts`, `reduce.ts`, `tests/{athena,device,reduce}.test.ts`

**Acceptance criteria:** builder/classifier/reducer tests green; `type-check` + `check` clean.

---

### Task 5: `processHour` + Lambda handlers (hourly, daily rollup, monthly rollup)

- [ ] `src/dynamo.ts` (local `toDynamoClient` or re-export) + per-handler Valibot env parse.
- [ ] `processHour.ts` (exported from barrel): shared entry point per Architecture §Atomic write path — marker pre-check → Athena (by source) → IP→country enrich → single `TransactWriteCommand` (marker + totals + breakdowns), with explicit handling when breakdown items push the transaction past 100 (chunk, guarded by the already-set marker). Also `applyDailyRollup({ dayKey })` / `applyMonthlyRollup({ monthKey })` reading finer items via `queryAll` and writing with `ADD` + their own markers.
- [ ] `src/hourly.ts` (`handler`): compute hour `= now − PROCESSING_LAG_HOURS`, floored; call `processHour({ hourKey, source: "v2", ... })`.
- [ ] `src/dailyRollup.ts`, `src/monthlyRollup.ts`: compute yesterday / last-month key; call the rollup functions; never construct an Athena client.
- [ ] Tests: `tests/processHour.test.ts` (mocked Athena + fake dynamo: asserts marker-guarded exactly-once — second call with existing marker does nothing; totals `ADD`; breakdowns per dimension; country from mocked IP cache; >100-item chunking path). `tests/rollup.test.ts` (daily rollup sums 24 hourly items, writes marker, builds no Athena client).

**Files:** `packages/analytics-processor/src/{dynamo,processHour,hourly,dailyRollup,monthlyRollup}.ts`, `tests/{processHour,rollup}.test.ts`

**Acceptance criteria:** handler/`processHour` tests green incl. idempotency + chunking; rollups provably avoid Athena; `type-check` + `check` clean.

---

### Task 6: Backfill script + `AnalyticsProcessor` CDK construct + barrel + ADRs

- [ ] `src/backfill.ts` (`bun run backfill -- --from <ISO> --to <ISO> [--concurrency N]`): build clients via `toDynamoClient()` + `AthenaClient`, iterate `hoursBetween`, call `processHour({ hourKey, source: "v1", ... })` per hour (bounded concurrency), print processed/skipped/failed; optional `--rollups` to run daily/monthly over the range after. Resumable + exactly-once via markers.
- [ ] `cdk.ts`: `AnalyticsProcessor` per Architecture §CDK (table + reverse GSI, three scheduled Lambdas, Athena/Glue/S3 IAM on hourly, `grantRead` helper, exposed `table`/`reverseIndexName`). No construct wiring for the backfill (operator-run script).
- [ ] `index.ts` barrel (per Architecture §Public API; exclude handlers/backfill). `DOCS.md`, `README.md`, `docs/adr-001-motivation.md`, `docs/adr-002-key-schema.md`, `docs/adr-003-country-via-ipinfo.md`, `docs/adr-004-atomic-writes-idempotency.md`, `docs/adr-005-backfill-standalone-script.md` (why script over MicroVM/durable functions).
- [ ] Tests: `tests/cdk.test.ts` (`Template`): one table + reverse GSI, three Lambdas, three EventBridge rules (one `rate(1 hour)`, two cron), hourly function has the Athena IAM actions.

**Files:** `packages/analytics-processor/src/backfill.ts`, `cdk.ts`, `index.ts`, `DOCS.md`, `README.md`, `docs/adr-00*.md`, `tests/cdk.test.ts`

**Acceptance criteria:** `tests/cdk.test.ts` green; barrel type-checks; `bun run build` builds the package; `check` clean; changeset for `@beesolve/analytics-processor`.

---

### Task 7: Scaffold `@beesolve/analytics-dashboard` (config, env, hooks, auth, users store)

- [ ] Create `packages/analytics-dashboard/` mirroring `packages/dmarc-dashboard/`: `package.json` (name `@beesolve/analytics-dashboard`, exports only `./cdk` + `./package.json`, `imports` `#lib/*`), `tsconfig*.json`, `build.ts`, `vite.config.ts` (adapter + `ssr.external` + remote functions + lightningcss), `svelte.config`, `app.html`, `ambient.d.ts`. Add deps (Architecture §Cross-package). `bun install` + `recalculate-dependencies`.
- [ ] `src/env.ts` `defineEnvVars` (`ANALYTICS_TABLE_NAME`, `ANALYTICS_REVERSE_INDEX`, `ANALYTICS_USERS_TABLE`, `ANALYTICS_USERS_REVERSE_INDEX`). Copy `src/lib/server/{users,setup,access,httpErrors}.ts` from dmarc-dashboard (adapt env/table names). `src/hooks.server.ts` (`Totals`/`Breakdowns` from processor on analytics table; `Users`/`Setup` on users table; auth guard + `createSessionHandle` + `DEV_USER_EMAIL`). `src/app.d.ts`. `src/authConsumer.ts` copied. Build-time placeholder env in `build` script.

**Files:** `packages/analytics-dashboard/package.json`, `vite.config.ts`, `tsconfig*.json`, `build.ts`, `src/env.ts`, `src/app.d.ts`, `src/hooks.server.ts`, `src/authConsumer.ts`, `src/lib/server/{users,setup,access,httpErrors}.ts`

**Acceptance criteria:** `type-check` (`svelte-kit sync && svelte-check`) passes; app builds with placeholder env; `check` clean.

---

### Task 8: Dashboard remote functions + routes + graffiti UI

- [ ] `src/lib/remote/overview.remote.ts` (`getOverview({ grain, anchor?, size? })` — Valibot-validate, clamp `size` to `maxWindowFor(grain)`, year-view = monthly grain capped at 120 grouped by year, compute keys, `Totals.queryWindow`, return series + prev/next anchors). `src/lib/remote/breakdowns.remote.ts` (`getBreakdown({ dimension, grain, periodKey })` → `Breakdowns.getForPeriod`, sorted by hits). `users.remote.ts`/`setup.remote.ts` copied from dmarc-dashboard with `toRemoteError` + `requireUser`/`requireAdmin`.
- [ ] Routes: `+layout.svelte` (import graffiti), `+layout.server.ts` (`{ user }`), `+page.svelte` (overview: grain switcher, prev/next window buttons, graffiti stat cards for hits/success/errors/bytes, hand-rolled bar chart on graffiti tokens, non-colliding class), `breakdowns/[dimension]/+page.svelte` (graffiti table + grain/period selector), `setup/`, `sign-in/`(+`verify`), `users/`(+`invite`/`edit`) mirroring dmarc-dashboard.
- [ ] Tests: `tests/overview.test.ts` — extract window-clamp + key-compute into a pure helper and assert oversize `size` clamped per grain and prev/next anchors correct.

**Files:** `packages/analytics-dashboard/src/lib/remote/{overview,breakdowns,users,setup}.remote.ts`, `routes/**`, `tests/overview.test.ts`

**Acceptance criteria:** `type-check` passes; `tests/overview.test.ts` green; UI uses graffiti components/tokens, no class-name collisions; `check` clean.

---

### Task 9: `AnalyticsDashboard` CDK + sample stack + end-to-end verification

- [ ] `packages/analytics-dashboard/cdk.ts`: `AnalyticsDashboard` per Architecture §CDK (SvelteKit on kit-on-lambda, `toDefaultOrigin` with `auth.*` + `processor.grantRead`, ensureCookie association, `/auth/*` behavior, `Emails` + `AuthConsumer` + `AuthEventsRule`, dedicated users `TableV2` + reverse GSI wired via `ANALYTICS_USERS_TABLE`/`ANALYTICS_USERS_REVERSE_INDEX`, exposed `distribution`).
- [ ] `DOCS.md`, `README.md`, `docs/adr-001-motivation.md`, `docs/how-to/getting-started.md` (incl. FRONTEND_URI chicken-and-egg first-deploy workflow and the one-time `bun run backfill` step).
- [ ] Sample: `packages/samples/analytics/stack.ts` mirroring `packages/samples/dmarcReports/stack.ts` — a demo CloudFront distribution with `CloudFrontAccessLoggingSettings` (v1 `athena` + `v2.enabled`), call `enableV2Logging({ distributionArn })` after the distribution exists, an `AnalyticsProcessor` (passing Glue db + v1/v2 tables + workgroup + bucket ARNs + account), an `AuthGateway` (`authorizerCache: "disabled"`), and an `AnalyticsDashboard`. Register `SamplesAnalytics` in `packages/samples/app.ts`. Add `SAMPLES_ANALYTICS_DASHBOARD_FRONTEND_URI` (+ any Athena/account env) to `packages/samples/mise.toml.example` and a placeholder note in `mise.toml`.
- [ ] Changesets for both new packages (read each `package.json` name first).
- [ ] Tests: `packages/analytics-dashboard/tests/cdk.test.ts` (`Template`: SvelteKit distribution, `/auth/*` behavior, users table + reverse GSI, AuthConsumer + AuthEventsRule).
- [ ] Full verification: workspace `bun run build`, `bun run type-check`, `bun test`, `bun run check`. `cdk synth` the samples app (or just the new stack) if supported here; if synth can't run in this environment, note it.

**Files:** `packages/analytics-dashboard/cdk.ts`, `DOCS.md`, `README.md`, `docs/adr-001-motivation.md`, `docs/how-to/getting-started.md`, `packages/samples/analytics/stack.ts`, `packages/samples/app.ts`, `packages/samples/mise.toml.example`, `.changeset/*.md`, `packages/analytics-dashboard/tests/cdk.test.ts`

**Acceptance criteria:** dashboard CDK test green; whole-workspace `build` + `type-check` + `test` + `check` pass; sample stack registered + type-checks; changesets present for both new packages.

---

## Future Work (out of scope)

- The upgraded construct is v2-only for collection — deploying it stops new v1 logs and keeps already-collected v1 objects + v1 Glue table for the backfill. Accepting a possible lost seam hour at the switch; no cutover runbook or v2 gap-backfill (single-user, personal use).
- Additional breakdown dimensions (`referer`, `edgeLocation`) and per-path drilldown time series (`pk = path#<pathHash>`, `sk = <grain>#<timeKey>`) for tracked top paths.
- ISO-week grain (`totals#isoweek`, `sk = YYYY-Www`) if weekly views are later wanted.
- Admin-triggered, live-progress, re-runnable backfill/reprocess as a dashboard feature — build on Lambda durable functions (not MicroVM) over the shared `processHour`.
- Realtime (sub-hour) stats — rejected for v1 (hourly latency accepted).
- Multi-site tenancy — only if multiple distributions share one log bucket; otherwise deploy another processor+dashboard pair.
