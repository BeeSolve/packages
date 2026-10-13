<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { Grain } from "@beesolve/analytics-processor";
  import { hourKey, parsePeriodKey } from "@beesolve/analytics-processor";

  import PeriodPicker from "#lib/components/periodPicker.svelte";
  import SummaryCard from "#lib/components/summaryCard.svelte";
  import type { View } from "#lib/labels.js";
  import { formatPeriodLabel, formatPeriodTick } from "#lib/labels.js";
  import { getOverview } from "#lib/remote/overview.remote.js";

  let { data } = $props();

  const views: Array<{ id: View; label: string }> = [
    { id: "hour", label: "Hourly" },
    { id: "day", label: "Daily" },
    { id: "month", label: "Monthly" },
    { id: "year", label: "Yearly" },
  ];

  function isView(value: string | null): value is View {
    return value != null && ["hour", "day", "month", "year"].includes(value);
  }

  function anchorPeriodKey(view: View): string {
    const key = hourKey(new Date());
    if (view === "hour") return key;
    if (view === "day") return key.slice(0, 10);
    if (view === "month") return key.slice(0, 7);
    return key.slice(0, 4);
  }

  const view = $derived<View>(isView(page.url.searchParams.get("view")) ? (page.url.searchParams.get("view") as View) : "day");

  const anchorKey = $derived(page.url.searchParams.get("anchor") ?? anchorPeriodKey(view));

  const anchorIso = $derived(resolveAnchorIso(view, anchorKey));

  function resolveAnchorIso(currentView: View, key: string): string {
    const start = parsePeriodKey(key);
    if (currentView !== "year") return start.toISOString();
    // A year selection anchors the 120-month window at December of that year
    // (or the current month if it is the current year) so the whole year shows.
    const now = new Date();
    if (start.getUTCFullYear() >= now.getUTCFullYear()) return now.toISOString();
    return new Date(Date.UTC(start.getUTCFullYear(), 11, 1)).toISOString();
  }

  const queryArgs = $derived(
    view === "year"
      ? { grain: "month" as Grain, anchor: anchorIso, years: true }
      : { grain: view, anchor: anchorIso, years: false },
  );

  function updateUrl(next: { view: View; anchor: string }): void {
    const params = new URLSearchParams(page.url.search);
    params.set("view", next.view);
    params.set("anchor", next.anchor);
    void goto(`${page.url.pathname}?${params.toString()}`, { reset: false });
  }

  function selectView(nextView: View): void {
    updateUrl({ view: nextView, anchor: anchorPeriodKey(nextView) });
  }

  function selectAnchor(nextAnchor: string): void {
    updateUrl({ view, anchor: nextAnchor });
  }

  function anchorKeyFromIso(iso: string): string {
    const key = hourKey(new Date(iso));
    if (view === "hour") return key;
    if (view === "day") return key.slice(0, 10);
    if (view === "month") return key.slice(0, 7);
    return key.slice(0, 4);
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value = value / 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }
</script>

<h1>Overview</h1>

<div class="cluster controls">
  <div class="cluster grain-switcher" role="group" aria-label="Time grain">
    {#each views as viewOption (viewOption.id)}
      <button
        type="button"
        class="button"
        class:primary={view === viewOption.id}
        class:minimal={view !== viewOption.id}
        aria-pressed={view === viewOption.id}
        onclick={() => selectView(viewOption.id)}
      >
        {viewOption.label}
      </button>
    {/each}
  </div>
  <PeriodPicker {view} value={anchorKey} startKey={data.startKey} onchange={selectAnchor} />
</div>

<svelte:boundary>
  {#snippet pending()}
    <p>Loading analytics…</p>
  {/snippet}

  {@const result = await getOverview(queryArgs)}
  {@const totals = {
    hits: result.series.reduce((sum, bucket) => sum + bucket.hits, 0),
    success: result.series.reduce((sum, bucket) => sum + bucket.success, 0),
    errors: result.series.reduce((sum, bucket) => sum + bucket.errors, 0),
    bytesSent: result.series.reduce((sum, bucket) => sum + bucket.bytesSent, 0),
  }}
  {@const chartBuckets =
    result.yearSeries != null
      ? result.yearSeries.map((yearBucket) => ({
          key: yearBucket.year,
          tick: yearBucket.year,
          label: yearBucket.year,
          hits: yearBucket.hits,
        }))
      : result.series.map((bucket) => ({
          key: bucket.timeKey,
          tick: formatPeriodTick({ view, periodKey: bucket.timeKey }),
          label: formatPeriodLabel({ view, periodKey: bucket.timeKey }),
          hits: bucket.hits,
        }))}
  {@const maxHits = Math.max(...chartBuckets.map((bucket) => bucket.hits), 1)}

  <div class="cluster window-nav">
    <button
      type="button"
      class="button minimal"
      onclick={() => selectAnchor(anchorKeyFromIso(result.prevAnchor))}
    >
      ← Previous
    </button>
    <span class="window-range">
      {formatPeriodLabel({ view, periodKey: result.startKey })} —
      {formatPeriodLabel({ view, periodKey: result.endKey })}
    </span>
    <button
      type="button"
      class="button minimal"
      onclick={() => selectAnchor(anchorKeyFromIso(result.nextAnchor))}
    >
      Next →
    </button>
  </div>

  <div class="layout-card summary-cards" style="--min-card-width: 11rem; --gap: var(--vs-base);">
    <SummaryCard label="Hits" value={totals.hits.toLocaleString()} />
    <SummaryCard label="Success (2xx/3xx)" value={totals.success.toLocaleString()} />
    <SummaryCard label="Errors" value={totals.errors.toLocaleString()} />
    <SummaryCard label="Bytes Sent" value={formatBytes(totals.bytesSent)} />
  </div>

  {#if chartBuckets.length === 0}
    <p>No data in this window.</p>
  {:else}
    <section class="chart-section">
      <h2>Hits per {result.years ? "year" : view}</h2>
      <div class="analytics-bars" role="img" aria-label="Hits per bucket">
        {#each chartBuckets as bucket (bucket.key)}
          {@const heightPct = (bucket.hits / maxHits) * 100}
          <div class="analytics-bars-col tooltip">
            <span class="tip">{bucket.label}: {bucket.hits.toLocaleString()} hits</span>
            <div class="analytics-bars-fill" style="height: {heightPct}%"></div>
            <span class="analytics-bars-label">{bucket.tick}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</svelte:boundary>

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1.25rem;
  }

  h2 {
    font-size: 1.15rem;
    margin: 0 0 0.75rem;
  }

  .controls {
    margin-bottom: var(--vs-base);
    gap: var(--vs-base);
    align-items: center;
  }

  /* See the breakdown page: force readable foreground on the selected grain
     button, which graffiti/visited-link rules would otherwise repaint. */
  .grain-switcher button.primary {
    color: var(--white);
  }

  .window-nav {
    margin-bottom: var(--vs-base);
    gap: var(--vs-base);
  }

  .window-range {
    font-variant-numeric: tabular-nums;
    color: var(--fg-7);
    font-size: 0.875rem;
  }

  .summary-cards {
    margin-bottom: var(--vs-l);
  }

  .chart-section {
    margin-bottom: var(--vs-l);
  }

  /* Hand-rolled bar chart — graffiti has no chart primitive. Built on graffiti
     design tokens with a non-colliding class prefix (`analytics-bars`). */
  .analytics-bars {
    display: flex;
    align-items: flex-end;
    gap: var(--vs-xs, 0.25rem);
    height: 16rem;
    padding: var(--pad-m);
    border: var(--border-1);
    border-radius: var(--br-m);
    background: var(--surface, var(--bg));
    overflow-x: auto;
  }

  .analytics-bars-col {
    flex: 1 0 1.5rem;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    height: 100%;
    min-width: 1.5rem;
  }

  .analytics-bars-fill {
    width: 100%;
    background: var(--primary);
    border-radius: var(--br-s) var(--br-s) 0 0;
    min-height: 2px;
    transition: height 0.2s;
  }

  .analytics-bars-label {
    margin-top: var(--vs-xs, 0.25rem);
    font-size: 0.65rem;
    color: var(--fg-5);
    white-space: nowrap;
    transform: rotate(-45deg);
    transform-origin: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
