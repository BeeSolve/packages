# Email Service Dashboard — Feedback Fixes

## Status: Complete

## Problem Statement

After deploying the latest `@beesolve/email-service-dashboard`, four rounds of feedback need addressing. All changes are scoped to `packages/service-email-dashboard`. No backward-compatibility constraints apply (single user, data will be adjusted manually).

1. **Remove TOTAL from Overview** — the on-the-fly "Total" summary card is meaningless (sum of overlapping counters). Remove it end-to-end from both the global overview and the per-recipient detail page.
2. **Messages list header** — (a) the month picker arrows wrap onto separate lines; put them inline flanking the dropdowns on a single row; (b) the year dropdown shows years (2024/2025) with no data — bound the selectable range using the existing `completedAt` value on the setup item; (c) replace the exact-match recipient search with an autocomplete backed by a keys-only recipients endpoint.
3. **Message detail timeline styling** — the per-recipient timeline looks awkward; apply a cleaner visual design.
4. **Timeline delivery bug** — every recipient shows all delivery events. Root cause: the SES delivery consumer branch fans out deliveries across `mail.destination` (all recipients) instead of `delivery.recipients` (the recipients that delivery notification actually covers). Fix the consumer only; existing corrupted data will be cleaned up manually by the user.

## Architecture / Approach

### 1. Remove TOTAL end-to-end

Two model methods synthesize a `total` field and two Svelte pages render it.

- `src/lib/server/stats.ts` → `GlobalStats.toModel`: return `item` directly, drop the `total` reduce.
- `src/lib/server/recipients.ts` → `Recipients.toModel`: same — return `item` directly.
- `src/routes/+page.svelte`: delete the `<SummaryCard label="Total" ... />` line.
- `src/routes/recipients/[email]/+page.svelte`: delete the `<SummaryCard label="Total" ... />` line.

No DynamoDB schema change (total was never stored). After removal, `stats.total` / `data.stats.total` must have zero remaining references (verify with a grep).

### 2. Timeline delivery bug (fix only)

`src/eventConsumer.ts`, `isSesDelivery(parsed)` branch currently writes:

```ts
data: {
  status: "delivered",
  deliveredAt: parsed.detail.delivery.timestamp,
  deliveryMs: parsed.detail.delivery.processingTimeMillis,
  timestamp: parsed.detail.delivery.timestamp,
  recipients: parsed.detail.mail.destination,   // BUG
},
```

`Messages.upsert` fans out one log entry per email in `data.recipients`, so using `mail.destination` writes a "delivered" entry for every message recipient on each delivery notification. `sesDeliverySchema` (in `@beesolve/email-service` `events.ts`, `detail.delivery.recipients: v.array(v.string())`) carries the correct per-notification recipient list.

Fix: change that one line to `recipients: parsed.detail.delivery.recipients`.

Leave the `isSesReject` branch as-is (`mail.destination` is correct — a reject applies to the whole send). Bounce/complaint branches already use their per-recipient arrays.

No data migration — the user cleans up existing corrupted `messageLog` sets manually.

### 3. Setup reader + bounding the month picker by `completedAt`

The setup item already stores `completedAt` (ISO string) at `{ pk: "system#config", sk: "setup" }`. Expose it and use it as the month picker's lower bound.

**Setup model** (`src/lib/server/setup.ts`): add a `get()` method returning the setup fields (or null). Add a `setupSchema` in `src/lib/server/schema.ts` for parsing, consistent with `statsSchema`/`recipientSchema`:

```ts
export const setupSchema = v.object({
  pk: v.literal("system#config"),
  sk: v.literal("setup"),
  completedAt: v.string(),
  adminEmail: emailSchema,
});
export type SetupConfig = v.InferOutput<typeof setupSchema>;
```

```ts
readonly get = async (): Promise<SetupConfig | null> => {
  const { Item: item } = await this.props.dynamo.send(
    new GetCommand({ TableName: this.props.tableName, Key: { pk: "system#config", sk: "setup" } }),
  );
  return item == null ? null : v.parse(setupSchema, item);
};
```

Optionally refactor `isComplete()` to `return (await this.get()) != null` (keeps one read path). Not required.

**Layout load** (`src/routes/+layout.server.ts`): load `completedAt` once and expose it so both `MonthPicker` consumers can read it. It becomes `async`, calls `locals.services.setup.get()`, and returns `startDate: config?.completedAt ?? null` alongside `user`.

**MonthPicker** (`src/lib/components/monthPicker.svelte`): accept an optional `startDate?: string | null` prop. Replace the hardcoded `const firstYear = 2024`:

- Derive `startYear`/`startMonth` from `startDate` when present; when absent, fall back to `currentYear`/`1` (so no empty years appear even before `completedAt` exists).
- `years` list runs from `startYear` to `currentYear`.
- Add a symmetric lower-bound guard `isBefore(candidateYear, candidateMonth)` mirroring `isFuture(...)`; disable year/month `<option>`s and block `navigate()` when the target is before the start month. Disable the "previous" arrow when already at the start month (mirror of `atCurrentMonth`).

Both consumers pass the prop:

- `src/routes/messages/+page.svelte`: `<MonthPicker year={data.year} month={data.month} startDate={data.startDate} />`
- `src/routes/recipients/[email]/+page.svelte`: same.

`data.startDate` is available from the layout load via SvelteKit data inheritance; confirm each page's `data` includes it (layout data merges into page data). If a page's own load overrides shape, thread it explicitly.

### 4. Recipient autocomplete (search replacement)

**Keys-only model method** (`src/lib/server/recipients.ts`): add `listEmails()` that queries the reverse GSI (`sk = "recipient"`) with `ProjectionExpression` limited to `pk` (the recipient email; there is no `id`/`entity` attribute on recipient items — pk is the email, sk is the literal `"recipient"`). Page through all results (loop on `LastEvaluatedKey`) and return `Array<string>` of emails, sorted.

```ts
readonly listEmails = async (): Promise<Array<string>> => {
  const emails: Array<string> = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const { Items: items = [], LastEvaluatedKey: lastKey } = await this.props.dynamo.send(
      new QueryCommand({
        TableName: this.props.tableName,
        IndexName: this.props.reverseIndexName,
        KeyConditionExpression: "#sk = :sk",
        ExpressionAttributeNames: { "#sk": "sk", "#pk": "pk" },
        ExpressionAttributeValues: { ":sk": "recipient" },
        ProjectionExpression: "#pk",
        ExclusiveStartKey: startKey,
      }),
    );
    for (const raw of items) {
      const email = typeof raw.pk === "string" ? raw.pk : null;
      if (email != null) emails.push(email);
    }
    startKey = lastKey;
  } while (startKey != null);
  return emails.sort();
};
```

**Endpoint** (`src/routes/recipients/keys/+server.ts`): `GET` returning `json(await locals.services.recipients.listEmails())`. Ensure the route is reachable behind the existing auth (it lives under the authenticated tree; verify `publicPaths` in the layout/hooks does not need changes — it does not, this route is protected which is fine for the dashboard user).

**Frontend** (`src/routes/messages/+page.svelte`): replace the exact-match form with a `<datalist>`-backed input (native autocomplete, no new dependency):

- On mount / first focus, fetch `/recipients/keys` once and populate a `<datalist>`.
- Keep the input + button; on submit (or on picking a value), navigate to `/recipients/{encodeURIComponent(trimmed)}` as today.
- Since values come from real recipient keys, selection yields an exact email that resolves on the recipient detail page.
- Use an event handler for the one-time fetch (avoid `useEffect`-style patterns; in Svelte, trigger the fetch from an `onfocus`/`onclick` handler guarded by a `loaded` flag, or a top-level `$effect` only if genuinely needed for the external fetch — prefer the handler approach per steering).

### 5. Timeline styling (message detail)

`src/routes/messages/[messageId]/+page.svelte` markup is correct — restyle only (plus the recipient heading which currently renders as an oversized blue link):

- Recipient heading (`h3` link): normal weight, smaller (~0.95rem), inherit foreground color, no underline until hover; treat as a section heading, not a giant link.
- Timeline rail: add a per-event dot/marker on the left rail, reduce vertical gaps, align badge + timestamp on one row with the detail beneath.
- Multi-recipient separation: give each `.recipient-timeline` clearer separation (divider or subtle card) so sections don't blur together.
- Keep all existing status-specific detail lines unchanged.

This is a CSS-only change within the component's `<style>` block plus minor class/element structure for the dots if needed.

### Cross-Package Dependencies

None. All changes are within `packages/service-email-dashboard`. The consumer fix reads `parsed.detail.delivery.recipients`, already present in `@beesolve/email-service` `sesDeliverySchema` — no version bump needed there.

### Key Design Decisions

- **Bound the picker with `completedAt`, no new field** — the setup item already has it; add only a reader.
- **Fallback when `completedAt` absent** — clamp the year range to the current year so empty years never appear even before setup data exists.
- **Autocomplete via native `<datalist>`** — no new dependency; keys-only projection keeps the query cheap.
- **Fix consumer only, no data migration** — user cleans corrupted `messageLog` manually.
- **Leave reject branch on `mail.destination`** — semantically correct for rejects.

## Execution Instructions

This plan is executed by a main session that spawns one subagent per task.
After each task, the user reviews changes and signals "continue" to proceed.

**Check gates** (run after every task, from repo root):

1. `bun run check` (oxfmt + oxlint) — or the dashboard package's equivalent scripts
2. `bun run type-check`
3. `bun test`

Also run the dashboard's own type/svelte check if separate (e.g. `bun run --filter @beesolve/email-service-dashboard check`); confirm from its `package.json`.

**Rules for subagents:**

- Each task must be self-contained; leave changes uncommitted for review.
- Follow project code style (`.kiro/steering/`): no narrating comments, `== null`/`!= null` checks, `import type`, descriptive array-callback variable names, `v.picklist` for string literal unions.
- Do not add tests unless the task says so; this is UI/consumer wiring.
- If check gates fail on unrelated pre-existing issues, note them, don't fix.
- Prefer event handlers over effects for the autocomplete fetch (React/Svelte effect-avoidance steering).

**Operational notes:**

- SvelteKit project — Prettier, not Biome/Oxfmt, may apply for `.svelte` files; use the package's configured formatter.
- Services are created in `hooks.server.ts` and accessed via `event.locals.services.*`; routes must never instantiate clients directly.

## Tasks

### Task 1: Remove TOTAL end-to-end

- [ ] `src/lib/server/stats.ts` — `GlobalStats.toModel`: return `item` directly; remove the `total` reduce.
- [ ] `src/lib/server/recipients.ts` — `Recipients.toModel`: return `item` directly; remove the `total` reduce.
- [ ] `src/routes/+page.svelte` — delete the `<SummaryCard label="Total" ... />` card.
- [ ] `src/routes/recipients/[email]/+page.svelte` — delete the `<SummaryCard label="Total" ... />` card.
- [ ] Grep the package for `\.total` / `stats.total` to confirm zero remaining references.

**Files:** `src/lib/server/stats.ts`, `src/lib/server/recipients.ts`, `src/routes/+page.svelte`, `src/routes/recipients/[email]/+page.svelte`

**Acceptance criteria:** No references to a `total` stat remain; type-check and svelte check pass; overview and recipient pages render without the Total card.

---

### Task 2: Fix SES delivery recipient fan-out bug

- [ ] `src/eventConsumer.ts` — in the `isSesDelivery(parsed)` branch, change `recipients: parsed.detail.mail.destination` to `recipients: parsed.detail.delivery.recipients`.
- [ ] Confirm `sesDeliverySchema` in `@beesolve/email-service` exposes `detail.delivery.recipients` (it does).
- [ ] Leave the `isSesReject` branch unchanged.

**Files:** `src/eventConsumer.ts`

**Acceptance criteria:** Only the delivery branch changes; type-check passes; a new delivery notification would write one delivered log entry per actually-delivered recipient, not per message recipient.

---

### Task 3: Setup reader + schema

- [ ] `src/lib/server/schema.ts` — add `setupSchema` (`pk` literal `"system#config"`, `sk` literal `"setup"`, `completedAt: v.string()`, `adminEmail: emailSchema`) and `SetupConfig` type.
- [ ] `src/lib/server/setup.ts` — add `get(): Promise<SetupConfig | null>` using `GetCommand` + `v.parse(setupSchema, item)`. Optionally rewrite `isComplete()` in terms of `get()`.

**Files:** `src/lib/server/schema.ts`, `src/lib/server/setup.ts`

**Acceptance criteria:** `Setup.get()` returns the parsed config or null; existing `isComplete()` behavior preserved; type-check passes.

---

### Task 4: Thread `completedAt` into the layout and bound MonthPicker

- [ ] `src/routes/+layout.server.ts` — make `load` async; call `locals.services.setup.get()`; return `{ user: locals.user, startDate: config?.completedAt ?? null }`.
- [ ] `src/lib/components/monthPicker.svelte` — add `startDate?: string | null` prop; remove hardcoded `firstYear = 2024`; derive `startYear`/`startMonth` from `startDate` (fallback: current year / month 1 when null); build `years` from `startYear`..`currentYear`; add `isBefore(year, month)` guard mirroring `isFuture`; disable out-of-range `<option>`s; block `navigate()` below start; disable the "previous" arrow at the start month.
- [ ] `src/routes/messages/+page.svelte` and `src/routes/recipients/[email]/+page.svelte` — pass `startDate={data.startDate}` to `MonthPicker`.

**Files:** `src/routes/+layout.server.ts`, `src/lib/components/monthPicker.svelte`, `src/routes/messages/+page.svelte`, `src/routes/recipients/[email]/+page.svelte`

**Acceptance criteria:** Year dropdown starts at the `completedAt` year (currently 2026) and shows no earlier empty years; months before the start month in the start year are disabled; future months remain disabled; falls back gracefully when `startDate` is null.

---

### Task 5: Month picker arrow layout

- [ ] `src/lib/components/monthPicker.svelte` — keep the DOM order `[‹] [year] [month] [›]`; ensure the `.month-picker` flex row does not wrap (`flex-wrap` removed or set to `nowrap`) so the arrows sit inline flanking the dropdowns on a single line at the dashboard's normal width.
- [ ] Verify it still lays out acceptably on narrow widths (allow wrapping only as a last resort at very small widths, or keep the dropdowns from overflowing).

**Files:** `src/lib/components/monthPicker.svelte`

**Acceptance criteria:** Arrows render inline on either side of the dropdowns on one row at desktop width, matching the requested layout.

---

### Task 6: Recipient keys-only endpoint + autocomplete search

- [ ] `src/lib/server/recipients.ts` — add `listEmails(): Promise<Array<string>>` querying the reverse GSI (`sk = "recipient"`) with `ProjectionExpression: "#pk"`, paging through `LastEvaluatedKey`, returning sorted emails.
- [ ] `src/routes/recipients/keys/+server.ts` — `GET` handler returning `json(await locals.services.recipients.listEmails())`.
- [ ] `src/routes/messages/+page.svelte` — replace the exact-match search with a `<datalist>`-backed autocomplete: fetch `/recipients/keys` once (via a focus/click handler guarded by a `loaded` flag, not an effect), populate the datalist, keep the button; on submit navigate to `/recipients/{encodeURIComponent(value)}`.

**Files:** `src/lib/server/recipients.ts`, `src/routes/recipients/keys/+server.ts`, `src/routes/messages/+page.svelte`

**Acceptance criteria:** `/recipients/keys` returns a JSON array of recipient emails behind auth; the search input offers autocomplete from real recipients; selecting one navigates to the recipient detail page; type-check and svelte check pass.

---

### Task 7: Message detail timeline restyle

- [ ] `src/routes/messages/[messageId]/+page.svelte` — restyle the per-recipient timeline: recipient heading as a normal-weight small heading (not an oversized blue link, hover-underline only); add per-event dot markers on the left rail; align badge + timestamp on one row with detail beneath; tighten vertical spacing; add clear separation between recipient sections. Keep all status-specific detail lines and data bindings unchanged.

**Files:** `src/routes/messages/[messageId]/+page.svelte`

**Acceptance criteria:** Single- and multi-recipient timelines look clean and clearly separated; no change to which events render (that is fixed by Task 2); svelte check passes.

---

## Future Work (out of scope)

- Manual cleanup of existing corrupted `messageLog` string sets (user will do this).
- Persisting an explicit `startDate` distinct from `completedAt`, if the two ever need to diverge.
- Server-side substring search for recipients if the recipient count grows beyond what a single keys-only fetch can comfortably return.
