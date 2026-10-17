<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  import PeriodPicker from "#lib/components/periodPicker.svelte";
  import { formatPeriodLabel, formatPeriodTick } from "#lib/labels.js";
  import { getWatchPeriod, getWatchTrend } from "#lib/remote/watch.remote.js";
  import type { WatchGrain } from "#lib/watchWindow.js";
  import {
    defaultWatchPeriodKey,
    defaultWindowSize,
    isWatchGrain,
    watchGrains,
  } from "#lib/watchWindow.js";

  let { data } = $props();

  const grainLabels: Record<WatchGrain, string> = {
    day: "Daily",
    month: "Monthly",
    year: "Yearly",
  };

  const now = new Date();

  const grain = $derived<WatchGrain>(
    isWatchGrain(page.url.searchParams.get("grain"))
      ? (page.url.searchParams.get("grain") as WatchGrain)
      : "month",
  );

  const periodKey = $derived(
    page.url.searchParams.get("period") ?? defaultWatchPeriodKey({ grain, now }),
  );

  const selectedPk = $derived(page.url.searchParams.get("bucket"));

  function updateUrl(next: { grain: WatchGrain; period: string; bucket: string | null }): void {
    const params = new URLSearchParams(page.url.search);
    params.set("grain", next.grain);
    params.set("period", next.period);
    if (next.bucket == null) params.delete("bucket");
    else params.set("bucket", next.bucket);
    void goto(`${page.url.pathname}?${params.toString()}`, { reset: false });
  }

  function selectGrain(nextGrain: WatchGrain): void {
    updateUrl({
      grain: nextGrain,
      period: defaultWatchPeriodKey({ grain: nextGrain, now }),
      bucket: selectedPk,
    });
  }

  function selectPeriod(nextPeriod: string): void {
    updateUrl({ grain, period: nextPeriod, bucket: selectedPk });
  }

  function selectBucket(pk: string): void {
    updateUrl({ grain, period: periodKey, bucket: pk });
  }

  function clearBucket(): void {
    updateUrl({ grain, period: periodKey, bucket: null });
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

  function cacheHitRatio({
    cacheHits,
    cacheMisses,
    cacheErrors,
  }: {
    cacheHits: number;
    cacheMisses: number;
    cacheErrors: number;
  }): string {
    const total = cacheHits + cacheMisses + cacheErrors;
    if (total === 0) return "—";
    return `${((cacheHits / total) * 100).toFixed(1)}%`;
  }
</script>

<h1>Watchlist</h1>

<div class="cluster controls">
  <div class="cluster grain-switcher" role="group" aria-label="Time grain">
    {#each watchGrains as grainOption (grainOption)}
      <button
        type="button"
        class="button"
        class:primary={grain === grainOption}
        class:minimal={grain !== grainOption}
        aria-pressed={grain === grainOption}
        onclick={() => selectGrain(grainOption)}
      >
        {grainLabels[grainOption]}
      </button>
    {/each}
  </div>
  <PeriodPicker view={grain} value={periodKey} startKey={data.startKey} onchange={selectPeriod} />
</div>

<p class="period-caption">{formatPeriodLabel({ view: grain, periodKey })}</p>

{#if grain === "day"}
  <p class="scalar-note">
    Hits are shown for the selected day. Bytes and cache columns are stored monthly only, so they
    reflect the containing month.
  </p>
{/if}

<svelte:boundary>
  {#snippet pending()}
    <p>Loading watch buckets…</p>
  {/snippet}

  {@const result = await getWatchPeriod({ grain, periodKey })}

  {#if selectedPk != null}
    {@const selected = result.items.find((item) => item.pk === selectedPk)}
    {#if selected != null}
      <section class="trend-section">
        <div class="cluster trend-head">
          <h2>Hits trend: {selected.label}</h2>
          <button type="button" class="button mini minimal" onclick={clearBucket}>
            ← Back to all buckets
          </button>
        </div>

        <svelte:boundary>
          {#snippet pending()}
            <p>Loading trend…</p>
          {/snippet}

          {@const trend = await getWatchTrend({
            pk: selected.pk,
            matcher: selected.matcher,
            mode: selected.mode,
            grain,
            anchorKey: periodKey,
            size: defaultWindowSize(grain),
          })}
          {@const maxHits = Math.max(...trend.buckets.map((bucket) => bucket.hits), 1)}

          {#if trend.buckets.every((bucket) => bucket.hits === 0)}
            <p>No hits for this bucket in the selected window.</p>
          {:else}
            <div class="analytics-bars" role="img" aria-label="Hits per {grain}">
              {#each trend.buckets as bucket (bucket.key)}
                {@const heightPct = (bucket.hits / maxHits) * 100}
                <div class="analytics-bars-col tooltip">
                  <span class="tip">
                    {formatPeriodLabel({ view: grain, periodKey: bucket.key })}:
                    {bucket.hits.toLocaleString()} hits
                  </span>
                  <div class="analytics-bars-fill" style="height: {heightPct}%"></div>
                  <span class="analytics-bars-label">
                    {formatPeriodTick({ view: grain, periodKey: bucket.key })}
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </svelte:boundary>
      </section>
    {/if}
  {/if}

  {#if result.items.length === 0}
    <p>No watch entries configured.</p>
  {:else}
    <div class="table">
      <table>
        <thead>
          <tr>
            <th>Bucket</th>
            <th>Status</th>
            <th>Source</th>
            <th class="num">Hits</th>
            <th class="num">Bytes transferred</th>
            <th class="num">Cache hit ratio</th>
            <th class="num">Bytes saved</th>
          </tr>
        </thead>
        <tbody>
          {#each result.items as item (item.pk)}
            <tr class:selected-row={item.pk === selectedPk}>
              <td>
                <button type="button" class="bucket-button" onclick={() => selectBucket(item.pk)}>
                  {item.label}
                </button>
              </td>
              <td>
                <span class="tag" class:stopped={item.status === "stopped"}>{item.status}</span>
              </td>
              <td>{item.source ?? "—"}</td>
              <td class="num">{item.hits.toLocaleString()}</td>
              <td class="num">{formatBytes(item.bytesSent)}</td>
              <td class="num">
                {cacheHitRatio(item)}
                <span class="cache-counts">
                  {item.cacheHits.toLocaleString()} / {item.cacheMisses.toLocaleString()} /
                  {item.cacheErrors.toLocaleString()}
                </span>
              </td>
              <td class="num">{formatBytes(item.bytesSaved)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</svelte:boundary>

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1rem;
  }

  h2 {
    font-size: 1.15rem;
    margin: 0;
  }

  .controls {
    margin-bottom: var(--vs-base);
    gap: var(--vs-base);
    align-items: center;
  }

  .grain-switcher button.primary {
    color: var(--white);
  }

  .period-caption {
    margin: 0 0 var(--vs-s);
    color: var(--fg-7);
    font-size: 0.875rem;
  }

  .scalar-note {
    margin: 0 0 var(--vs-l);
    color: var(--fg-5);
    font-size: 0.8rem;
  }

  .trend-section {
    margin-bottom: var(--vs-l);
  }

  .trend-head {
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: var(--vs-base);
    gap: var(--vs-base);
  }

  .bucket-button {
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--primary);
    cursor: pointer;
    font: inherit;
    text-align: left;
    text-decoration: underline;
    word-break: break-all;
  }

  .tag.stopped {
    --tag-color: var(--fg-5);
  }

  .cache-counts {
    display: block;
    font-size: 0.7rem;
    color: var(--fg-5);
  }

  .selected-row {
    background: color-mix(in oklab, var(--primary) 12%, transparent);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
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
