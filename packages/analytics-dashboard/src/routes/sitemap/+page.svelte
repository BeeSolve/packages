<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  import PeriodPicker from "#lib/components/periodPicker.svelte";
  import { formatPeriodLabel, formatPeriodTick } from "#lib/labels.js";
  import { getSitemapPeriod, getSitemapTrend } from "#lib/remote/sitemap.remote.js";
  import type { SitemapGrain } from "#lib/sitemapWindow.js";
  import {
    defaultSitemapPeriodKey,
    defaultWindowSize,
    isSitemapGrain,
    sitemapGrains,
  } from "#lib/sitemapWindow.js";

  let { data } = $props();

  const grainLabels: Record<SitemapGrain, string> = {
    day: "Daily",
    month: "Monthly",
    year: "Yearly",
  };

  const now = new Date();

  const grain = $derived<SitemapGrain>(
    isSitemapGrain(page.url.searchParams.get("grain"))
      ? (page.url.searchParams.get("grain") as SitemapGrain)
      : "month",
  );

  const periodKey = $derived(
    page.url.searchParams.get("period") ?? defaultSitemapPeriodKey({ grain, now }),
  );

  const selectedPath = $derived(page.url.searchParams.get("path"));

  function updateUrl(next: {
    grain: SitemapGrain;
    period: string;
    path: string | null;
  }): void {
    const params = new URLSearchParams(page.url.search);
    params.set("grain", next.grain);
    params.set("period", next.period);
    if (next.path == null) params.delete("path");
    else params.set("path", next.path);
    void goto(`${page.url.pathname}?${params.toString()}`, { reset: false });
  }

  function selectGrain(nextGrain: SitemapGrain): void {
    updateUrl({
      grain: nextGrain,
      period: defaultSitemapPeriodKey({ grain: nextGrain, now }),
      path: selectedPath,
    });
  }

  function selectPeriod(nextPeriod: string): void {
    updateUrl({ grain, period: nextPeriod, path: selectedPath });
  }

  function selectPath(path: string): void {
    updateUrl({ grain, period: periodKey, path });
  }

  function clearPath(): void {
    updateUrl({ grain, period: periodKey, path: null });
  }
</script>

<h1>Sitemap</h1>

<div class="cluster controls">
  <div class="cluster grain-switcher" role="group" aria-label="Time grain">
    {#each sitemapGrains as grainOption (grainOption)}
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

{#if selectedPath != null}
  <section class="trend-section">
    <div class="cluster trend-head">
      <h2>Hits trend: {selectedPath}</h2>
      <button type="button" class="button mini minimal" onclick={clearPath}>
        ← Back to all URLs
      </button>
    </div>

    <svelte:boundary>
      {#snippet pending()}
        <p>Loading trend…</p>
      {/snippet}

      {@const trend = await getSitemapTrend({
        path: selectedPath,
        grain,
        anchorKey: periodKey,
        size: defaultWindowSize(grain),
      })}
      {@const maxHits = Math.max(...trend.buckets.map((bucket) => bucket.hits), 1)}

      {#if trend.buckets.every((bucket) => bucket.hits === 0)}
        <p>No hits for this URL in the selected window.</p>
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

<svelte:boundary>
  {#snippet pending()}
    <p>Loading URLs…</p>
  {/snippet}

  {@const result = await getSitemapPeriod({ grain, periodKey })}

  {#if result.items.length === 0}
    <p>No sitemap data for this period.</p>
  {:else}
    <div class="table">
      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th class="num">Hits</th>
          </tr>
        </thead>
        <tbody>
          {#each result.items as item (item.path)}
            <tr class:selected-row={item.path === selectedPath}>
              <td>
                <button type="button" class="path-button" onclick={() => selectPath(item.path)}>
                  {item.path}
                </button>
              </td>
              <td class="num">{item.hits.toLocaleString()}</td>
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

  /* Force a readable foreground on the selected grain button, which graffiti
     visited-link rules would otherwise repaint (same workaround as overview). */
  .grain-switcher button.primary {
    color: var(--white);
  }

  .period-caption {
    margin: 0 0 var(--vs-l);
    color: var(--fg-7);
    font-size: 0.875rem;
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

  .path-button {
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--primary);
    cursor: pointer;
    font: inherit;
    text-align: left;
    text-decoration: underline;
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
