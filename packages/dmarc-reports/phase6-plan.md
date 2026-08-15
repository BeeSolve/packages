# Phase 6 — Dashboard UX, Processing Stats & Daily Aggregation

## Problem Statement

The DMARC dashboard is functional but provides minimal value to users. The domain detail page shows a flat table of reports with basic pass/fail counts, lacking actionable insights. There is no visibility into the report processing pipeline (how many emails were processed, rejected, or uploaded manually). Users cannot filter reports by date, and there is no infrastructure for future daily alert emails.

## Requirements

### R1: Processing Stats (dmarc-reports handler)

Track pipeline processing statistics as a DynamoDB entity in the dmarc-consumer table:

- **Processed**: total DMARC reports successfully parsed and emitted
- **Manual uploads**: reports processed without SES `Authentication-Results` headers (direct S3 uploads)
- **Auth rejected**: emails rejected due to SPF/DKIM failure
- **Spam/virus rejected**: emails rejected due to SES spam or virus verdict

Stats are tracked per-day (UTC) to support daily aggregation and trend display.

**DynamoDB entity design:**

```
pk: "stats#daily"
sk: "2026-08-14"  (ISO date string, UTC)

processed: number     (ADD counter)
manualUpload: number  (ADD counter)
authRejected: number  (ADD counter)
spamRejected: number  (ADD counter)
virusRejected: number (ADD counter)
```

The handler no longer throws on auth/spam/virus failures — instead it catches, increments the appropriate counter, and returns early (skip processing, but track the event).

### R2: Dashboard Visual Improvements

Improve visual design using `@drop-in/graffiti` features:

- Apply a theme preset (`theme-system` or `theme-editorial`)
- Add summary cards at top of pages (domain overview: total messages, pass rate, fail count)
- Color-coded status indicators (green/amber/red) for pass rates
- Better page layout with consistent spacing and hierarchy
- Responsive tables that work on smaller screens

### R3: Richer Domain Detail View

Replace the flat report table with actionable insights:

**Overview section (summary cards):**

- Total messages (all time + today)
- Overall pass rate with trend indicator
- Total unique source IPs
- Reports received count

**Source IP analysis table:**

- Source IP, message count, SPF result, DKIM result, disposition
- Grouped/sorted by volume
- Highlight failing/unauthorized IPs in red

**Authentication breakdown:**

- SPF pass rate vs DKIM pass rate (separate indicators)
- DKIM selectors in use and their pass/fail status
- Alignment mode display (strict vs relaxed)

**Per-report drill-down** (`/domains/[domain]/reports/[reportId]`):

- Full record-level detail for a single report
- All source IPs with complete auth results
- Policy override reasons if present

### R4: Daily Grouping & Calendar Filter

- Group reports by UTC day on the domain detail page
- Add a calendar/date-picker component for filtering to a specific day or date range
- Server-side filtering uses existing `startTime`/`endTime` query params
- Day cells show visual indicator of pass/fail status for that day

### R5: Processing Stats Dashboard Page

New page (`/stats` or section on home page) showing:

- Daily processing volume chart (processed vs rejected)
- Breakdown of rejection reasons
- Manual upload count
- Accessible to admin users only

## Background

### Current Architecture

```
SES → S3 (inbox/) → EventBridge → dmarc-reports handler Lambda
                                          ↓
                                    EventBridge event
                                          ↓
                                   SQS → dmarc-consumer Lambda → DynamoDB
                                                                      ↑
                                                              dmarc-dashboard reads
```

### Current DynamoDB Entity Types

| Entity           | pk                 | sk                                 | Purpose                     |
| ---------------- | ------------------ | ---------------------------------- | --------------------------- |
| Domain aggregate | `domain#${domain}` | `domain`                           | Cumulative pass/fail totals |
| Report           | `domain#${domain}` | `report#${timestamp}#${org}#${id}` | Individual DMARC reports    |
| User             | `user#${email}`    | `user`                             | Dashboard user accounts     |

### New Entity

| Entity      | pk            | sk              | Purpose                   |
| ----------- | ------------- | --------------- | ------------------------- |
| Daily stats | `stats#daily` | `${YYYY-MM-DD}` | Daily processing counters |

### Key Design Decisions

1. **Stats entity lives in dmarc-consumer table** — the dmarc-reports handler needs write access to this table. The CDK construct must expose a method for granting write access to the handler, or the stats entity class must be created in `dmarc-reports` package with the table name passed via environment variable.

2. **Handler catches instead of throwing** — the handler refactors from throw-on-reject to return-early-on-reject, incrementing stats counters before returning. This means the Lambda invocation succeeds (no error in CloudWatch) but the rejected email is tracked.

3. **Stats writes use DynamoDB `ADD`** — atomic counter increments, no read-before-write needed.

4. **Calendar filtering is server-side** — the `queryByDomain` already supports `startTime`/`endTime`, so the calendar component simply navigates with query params.

5. **Source IP analysis is computed on-read** — derived from the `records` array already stored in each report. No new DynamoDB entity needed.

## Proposed Solution

### Processing Stats Flow

```
S3 Object Created
       ↓
dmarc-reports handler
       ↓
┌─────────────────────────────────────┐
│ 1. Fetch object from S3             │
│ 2. Check authentication             │
│    - No auth header → manualUpload  │
│    - Auth fail → authRejected       │
│    - Spam → spamRejected            │
│    - Virus → virusRejected          │
│    - Pass → continue processing     │
│ 3. Parse reports                    │
│ 4. Emit to EventBridge              │
│ 5. Increment stats counter          │
│    (processed += number of reports) │
└─────────────────────────────────────┘
       ↓
DynamoDB UpdateCommand (ADD counters)
```

### Dashboard Page Structure

```
/ (home)
├── Summary cards (total domains, total messages, overall health)
├── Domain table (existing, with visual improvements)
│
/domains/[domain]
├── Overview tab
│   ├── Summary cards (messages today, pass rate, trend)
│   ├── Daily volume chart (pass/fail stacked by day)
│   └── Calendar filter (month view, clickable days)
├── Sources tab
│   ├── Source IP table with pass/fail/volume
│   └── Highlight unauthorized senders
├── Reports tab (existing table, now filterable by date)
│   └── Click row → /domains/[domain]/reports/[reportId]
│
/domains/[domain]/reports/[reportId]
├── Report metadata (org, date range, policy)
├── Records table (full detail per source IP)
│   └── Auth results, disposition, override reasons
│
/stats (admin only)
├── Daily processing chart
├── Rejection breakdown
└── Manual upload count
```

## Task Breakdown

### Task 1: Create ProcessingStats entity class in dmarc-reports ✅

**Objective:** Create a `ProcessingStats` class that tracks daily pipeline processing counters using DynamoDB atomic increments.

**Implementation guidance:**

- Create `packages/dmarc-reports/src/processing-stats.ts`
- Define Valibot schema: `pk: "stats#daily"`, `sk: string` (ISO date), counters
- Implement `increment` method using `UpdateCommand` with `ADD` expressions
- Implement `queryRange` method to fetch stats for a date range (for the dashboard)
- Follow the same pattern as `Domains` class (constructor takes dynamo client + table name)
- The class accepts a `date` parameter (defaults to today UTC) for the sk

**Test requirements:**

- Test that `increment` sends correct `UpdateCommand` with ADD expressions
- Test that `queryRange` returns parsed stats for a date range
- Test date formatting (UTC normalization)

**Demo:** Unit tests pass, showing the entity correctly builds DynamoDB commands for incrementing and querying daily stats.

---

### Task 2: Refactor dmarc-reports handler to track stats instead of throwing ✅

**Objective:** Modify the handler to catch authentication/spam/virus failures, increment the appropriate stats counter, and return early instead of throwing. Track successful processing and manual uploads too.

**Implementation guidance:**

- Add `STATS_TABLE_NAME` environment variable to the handler Lambda
- Instantiate `ProcessingStats` in the handler module
- Refactor `checkEmailAuthentication` to return a result object instead of throwing:
  ```ts
  type AuthResult =
    | { status: "pass" }
    | { status: "manual" } // no Authentication-Results header
    | { status: "authRejected" }
    | { status: "spamRejected" }
    | { status: "virusRejected" };
  ```
- In the main handler flow:
  - If `manual` → increment `manualUpload`, continue processing
  - If `authRejected`/`spamRejected`/`virusRejected` → increment counter, return early
  - After successful `emitEvents` → increment `processed` by number of reports emitted
- Update CDK construct to pass `STATS_TABLE_NAME` env var and grant write access to the stats entity (only needs write to `pk: "stats#daily"`)

**Test requirements:**

- Test that auth failure increments `authRejected` and does not emit events
- Test that spam/virus failure increments appropriate counter
- Test that missing auth header increments `manualUpload` and continues processing
- Test that successful processing increments `processed`
- Existing handler tests updated to reflect new non-throwing behavior

**Demo:** Upload a file to S3 → handler processes it → DynamoDB stats item shows incremented counter. Upload an email with bad auth → stats show `authRejected` incremented, no error thrown.

---

### Task 3: Wire stats table access in CDK constructs ✅

**Objective:** Connect the dmarc-reports handler to the dmarc-consumer table for stats writes, and expose stats read for the dashboard.

**Implementation guidance:**

- Add `grantStatsWrite(grantee: Function)` to `DmarcConsumer` CDK construct (grants write, sets `STATS_TABLE_NAME` env var)
- In the samples stack (`dmarcReports/stack.ts`), call `consumer.grantStatsWrite(dmarcReports.handler)` — this requires exposing the handler from `DmarcReports` construct
- Expose `readonly handler: Function` on `DmarcReports` construct
- Export `ProcessingStats` class from `@beesolve/dmarc-reports` package exports

**Test requirements:**

- CDK assertion test: handler has `STATS_TABLE_NAME` env var
- CDK assertion test: handler has IAM write policy for the table

**Demo:** `cdk synth` produces correct CloudFormation with handler having table write access.

---

### Task 4: Apply visual theme and layout improvements ✅

**Objective:** Improve dashboard appearance with graffiti theming and layout.

**Implementation guidance:**

- Add theme class to `app.html` (e.g. `class="theme-system"`)
- Improve `+layout.svelte` nav structure
- Create `$lib/components/StatusBadge.svelte` — colored pill showing pass rate category
- Create `$lib/components/SummaryCard.svelte` — metric card (value + label)
- Add CSS variables for status colors (e.g. `--color-pass`, `--color-fail`, `--color-warn`)
- Improve table alignment (right-align numbers, monospace for IPs)
- Add pass rate badge to domain list table

**Test requirements:**

- Existing pages still render without errors
- Manual visual verification

**Demo:** Dashboard loads with polished theme, nav is clean, tables have aligned numbers, pass rates show colored badges.

---

### Task 5: Add source IP analysis and summary cards to domain detail ✅

**Objective:** Compute and display per-IP authentication breakdown on the domain detail page.

**Implementation guidance:**

- Create `$lib/server/aggregate.ts` helper function that takes an array of reports and returns:
  - `totalMessages`, `totalPass`, `totalFail`
  - `uniqueIps`: count of distinct source IPs
  - `sourceIpBreakdown`: array of `{ ip, count, spfPass, spfFail, dkimPass, dkimFail, dispositions }`
  - `spfPassRate`, `dkimPassRate` (separate)
- Call this from `domains/[domain]/+page.server.ts`, pass results to the page
- Render summary cards at top (total messages, pass rate, unique IPs, report count)
- Render source IP table below summary (sorted by volume descending, top 20)
- Color-code: green rows for all-pass, red for any fail with `disposition !== "none"`

**Test requirements:**

- Unit test `aggregate.ts` with various report/record combinations
- Test edge cases (empty records, same IP across multiple reports)

**Demo:** Domain page shows summary cards and source IP table with colored status indicators.

---

### Task 6: Add report detail drill-down page ✅

**Objective:** Create a detail page showing all records for a single report.

**Implementation guidance:**

- Create `domains/[domain]/reports/[reportId]/+page.server.ts` and `+page.svelte`
- Add `getByReportId` method to `Reports` class — query by domain pk, filter by sk containing reportId (or scan with filter — reports are already loaded per-domain)
- Display: org name, email, date range, policy (adkim, aspf, p, pct)
- Records table: source IP, count, SPF result, DKIM result, disposition, override reasons
- Expandable detail per row: full DKIM auth results (domain + selector), full SPF auth results (domain + scope)
- Back link to domain page

**Test requirements:**

- Test `getByReportId` method
- Test page renders with sample data

**Demo:** Click report row → detail page shows full breakdown of all source IPs and auth results.

---

### Task 7: Add daily grouping and calendar date filter ✅

**Objective:** Add date-based filtering with a calendar UI component.

**Implementation guidance:**

- Update `domains/[domain]/+page.server.ts`:
  - Accept `?date=2026-08-14` query param
  - Compute `startTime = Date.parse(date + "T00:00:00Z") / 1000`, `endTime = startTime + 86399`
  - Pass to `queryByDomain`
- Create `$lib/components/Calendar.svelte`:
  - Month view grid (7 cols × 5-6 rows)
  - Props: `currentMonth`, `selectedDate`, `dayData` (map of date → status)
  - Each cell: date number, colored dot if reports exist (green/amber/red)
  - Click navigates to `?date=YYYY-MM-DD`
  - Prev/next month navigation
- To populate day indicators: query all reports for the month range, group by day, compute pass/fail
- When a day is selected, show "Showing reports for {date}" with a "Clear filter" link
- Group report rows by day when no filter is active (collapsible day headers)

**Test requirements:**

- Test date → startTime/endTime conversion
- Test day grouping logic
- Test calendar component renders correct number of cells

**Demo:** Calendar shows on domain page. Days with data are colored. Click a day → reports filter to that day.

---

### Task 8: Add processing stats admin page ✅

**Objective:** Create an admin-only page displaying pipeline processing metrics.

**Implementation guidance:**

- Create `/stats/+page.server.ts` — check admin role, query `ProcessingStats` for last 30 days
- Create `/stats/+page.svelte`:
  - Summary cards: total processed, total rejected (sum of auth + spam + virus), total manual
  - Table: one row per day (date, processed, manual, auth rejected, spam, virus)
  - CSS-only bar visualization (percentage width, colored segments)
  - Highlight days with high rejection rates
- Add "Stats" link to nav in `+layout.svelte` (conditionally shown for admin users)
- Handle empty data gracefully (new deployment with no stats yet)

**Test requirements:**

- Non-admin gets 403
- Empty stats returns empty table
- Stats render correctly with mock data

**Demo:** Admin clicks "Stats" in nav → sees 30-day processing breakdown with visual indicators.

---

### Task 9: Add daily aggregate query for future email alerts ✅

**Objective:** Create the data-layer methods needed for the future daily alert email Lambda.

**Implementation guidance:**

- Add `getDailyAggregate` method to `Reports` class:
  - Input: `{ domain: string, date: string }` (ISO date)
  - Computes startTime/endTime for the day, queries reports
  - Returns: `{ domain, date, totalMessages, totalPass, totalFail, topFailingIps: Array<{ ip, count, spfResult, dkimResult }>, reportCount }`
- Add `getDailyAggregateAllDomains` method:
  - Calls `Domains.list()`, then `getDailyAggregate` for each
  - Returns array of per-domain daily summaries
  - Filters out domains with zero activity
- Document the intended email trigger in a README or ADR:
  - EventBridge scheduled rule (cron), daily at 08:00 UTC
  - Lambda queries previous day's data
  - Renders HTML email via email service
  - Sends to users with access to each domain

**Test requirements:**

- Test `getDailyAggregate` with mock DynamoDB responses
- Test aggregation: correct sum, correct top failing IP identification
- Test that zero-activity domains are filtered out

**Demo:** `getDailyAggregate({ domain: "beesolve.com", date: "2026-08-14" })` returns structured summary ready for email template consumption.
