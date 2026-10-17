<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { Dimension, Grain } from "@beesolve/analytics-processor";
  import { dimensions, grains, hourKey } from "@beesolve/analytics-processor";

  import PeriodPicker from "#lib/components/periodPicker.svelte";
  import { formatPeriodLabel } from "#lib/labels.js";
  import { getBreakdown } from "#lib/remote/breakdowns.remote.js";
  import { getStatusUrls } from "#lib/remote/statusUrls.remote.js";

  let { data } = $props();

  function isDimension(value: string): value is Dimension {
    return (dimensions as ReadonlyArray<string>).includes(value);
  }

  function isGrain(value: string | null): value is Grain {
    return value != null && (grains as ReadonlyArray<string>).includes(value);
  }

  function defaultPeriodKey(grain: Grain): string {
    const key = hourKey(new Date());
    if (grain === "hour") return key;
    if (grain === "day") return key.slice(0, 10);
    return key.slice(0, 7);
  }

  const dimension = $derived<Dimension>(
    isDimension(page.params.dimension ?? "") ? (page.params.dimension as Dimension) : "status",
  );

  const grain = $derived<Grain>(isGrain(page.url.searchParams.get("grain")) ? (page.url.searchParams.get("grain") as Grain) : "day");

  const periodKey = $derived(page.url.searchParams.get("period") ?? defaultPeriodKey(grain));

  function updateUrl(next: { grain: Grain; period: string }): void {
    const params = new URLSearchParams(page.url.search);
    params.set("grain", next.grain);
    params.set("period", next.period);
    void goto(`${page.url.pathname}?${params.toString()}`, { reset: false });
  }

  function selectGrain(nextGrain: Grain): void {
    updateUrl({ grain: nextGrain, period: defaultPeriodKey(nextGrain) });
  }

  function selectPeriod(nextPeriod: string): void {
    updateUrl({ grain, period: nextPeriod });
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

<h1>Breakdown: {dimension}</h1>

<nav class="cluster dimension-nav" aria-label="Dimension">
  {#each dimensions as dimensionOption (dimensionOption)}
    <a
      href="/breakdowns/{dimensionOption}?grain={grain}&period={periodKey}"
      class="button mini"
      class:primary={dimension === dimensionOption}
      class:minimal={dimension !== dimensionOption}
    >
      {dimensionOption}
    </a>
  {/each}
</nav>

<div class="cluster controls">
  <div class="cluster grain-switcher" role="group" aria-label="Time grain">
    {#each grains as grainOption (grainOption)}
      <button
        type="button"
        class="button mini"
        class:primary={grain === grainOption}
        class:minimal={grain !== grainOption}
        aria-pressed={grain === grainOption}
        onclick={() => selectGrain(grainOption)}
      >
        {grainOption}
      </button>
    {/each}
  </div>
  <PeriodPicker
    view={grain}
    value={periodKey}
    startKey={data.startKey}
    onchange={selectPeriod}
  />
</div>

<p class="period-caption">{formatPeriodLabel({ view: grain, periodKey })}</p>

{#if dimension === "country"}
  <p class="dimension-note">Unique visitors are tracked site-wide only, not per country.</p>
{/if}

<svelte:boundary>
  {#snippet pending()}
    <p>Loading breakdown…</p>
  {/snippet}

  {@const result = await getBreakdown({ dimension, grain, periodKey })}

  {#if result.items.length === 0}
    <p>No data for {dimension} in this period.</p>
  {:else}
    <div class="table">
      <table>
        <thead>
          <tr>
            <th>Value</th>
            <th class="num">Hits</th>
            <th class="num">Bytes</th>
          </tr>
        </thead>
        <tbody>
          {#each result.items as item (item.value)}
            <tr>
              <td>{item.value}</td>
              <td class="num">{item.hits.toLocaleString()}</td>
              <td class="num">{formatBytes(item.bytes)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if dimension === "status"}
    <section class="status-urls-section">
      <h2>URLs that errored / were redirected</h2>
      <p class="dimension-note">
        Derived from watched URLs. Status class only (redirect / client+server error) - no exact
        per-URL codes.
      </p>

      <svelte:boundary>
        {#snippet pending()}
          <p>Loading watched URL status…</p>
        {/snippet}

        {@const statusUrls = await getStatusUrls({ grain, periodKey })}

        {#if statusUrls.items.length === 0}
          <p>No watched URLs errored or were redirected in this period.</p>
        {:else}
          <div class="table">
            <table>
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th class="num">Redirects (3xx)</th>
                  <th class="num">Client+Server errors</th>
                </tr>
              </thead>
              <tbody>
                {#each statusUrls.items as item (item.pk)}
                  <tr>
                    <td>{item.label}</td>
                    <td class="num">{item.redirects.toLocaleString()}</td>
                    <td class="num">{item.errors.toLocaleString()}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </svelte:boundary>
    </section>
  {/if}
</svelte:boundary>

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1rem;
  }

  h2 {
    font-size: 1.15rem;
    margin: 0 0 0.5rem;
  }

  .dimension-note {
    margin: 0 0 var(--vs-base);
    color: var(--fg-5);
    font-size: 0.8rem;
  }

  .status-urls-section {
    margin-top: var(--vs-l);
  }

  .dimension-nav {
    margin-bottom: var(--vs-base);
  }

  .controls {
    margin-bottom: var(--vs-base);
    gap: var(--vs-base);
    align-items: center;
  }

  .period-caption {
    margin: 0 0 var(--vs-l);
    color: var(--fg-7);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }

  /* Graffiti's `.button.primary` sets white text, but an `<a class="button
     primary">` is also matched by graffiti's anchor color rules (and the app's
     visited-link rule), which repaint the label in `--primary` — the same hue
     as the fill, making the selected label unreadable. Force the on-primary
     foreground for the selected control in both button groups. */
  .dimension-nav a.primary,
  .dimension-nav a.primary:visited,
  .grain-switcher button.primary {
    color: var(--white);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
