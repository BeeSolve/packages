<script lang="ts">
  import type { Grain } from "@beesolve/analytics-processor";

  import SummaryCard from "#lib/components/summaryCard.svelte";
  import { getOverview } from "#lib/remote/overview.remote.js";

  type View = Grain | "year";

  const views: Array<{ id: View; label: string }> = [
    { id: "hour", label: "Hourly" },
    { id: "day", label: "Daily" },
    { id: "month", label: "Monthly" },
    { id: "year", label: "Yearly" },
  ];

  let view = $state<View>("day");
  let anchor = $state<string | undefined>(undefined);

  const queryArgs = $derived(
    view === "year"
      ? { grain: "month" as Grain, anchor, years: true }
      : { grain: view, anchor, years: false },
  );

  function selectView(next: View): void {
    view = next;
    anchor = undefined;
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
</div>

<svelte:boundary>
  {#snippet pending()}
    <p>Loading analytics…</p>
  {/snippet}

  {@const data = await getOverview(queryArgs)}
  {@const totals = {
    hits: data.series.reduce((sum, bucket) => sum + bucket.hits, 0),
    success: data.series.reduce((sum, bucket) => sum + bucket.success, 0),
    errors: data.series.reduce((sum, bucket) => sum + bucket.errors, 0),
    bytesSent: data.series.reduce((sum, bucket) => sum + bucket.bytesSent, 0),
  }}
  {@const chartBuckets =
    data.yearSeries != null
      ? data.yearSeries.map((yearBucket) => ({ label: yearBucket.year, hits: yearBucket.hits }))
      : data.series.map((bucket) => ({ label: bucket.timeKey, hits: bucket.hits }))}
  {@const maxHits = Math.max(...chartBuckets.map((bucket) => bucket.hits), 1)}

  <div class="cluster window-nav">
    <button type="button" class="button minimal" onclick={() => (anchor = data.prevAnchor)}>
      ← Previous
    </button>
    <span class="window-range">{data.startKey} — {data.endKey}</span>
    <button type="button" class="button minimal" onclick={() => (anchor = data.nextAnchor)}>
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
      <h2>Hits per {data.years ? "year" : data.grain}</h2>
      <div class="analytics-bars" role="img" aria-label="Hits per bucket">
        {#each chartBuckets as bucket (bucket.label)}
          {@const heightPct = (bucket.hits / maxHits) * 100}
          <div class="analytics-bars-col" title="{bucket.label}: {bucket.hits.toLocaleString()} hits">
            <div class="analytics-bars-fill" style="height: {heightPct}%"></div>
            <span class="analytics-bars-label">{bucket.label}</span>
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
