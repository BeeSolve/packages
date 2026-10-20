<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import type { Dimension, Grain, Tier } from "@beesolve/analytics-processor";

  import { dimensions, grains, hourKey, tiers } from "#lib/periodKeys.js";

  import PeriodPicker from "#lib/components/periodPicker.svelte";
  import AboutData from "#lib/components/aboutData.svelte";
  import Tooltip from "#lib/components/tooltip.svelte";
  import { formatCountry, formatPeriodLabel, statusCodeExplanation, tierDescription, tierLabel } from "#lib/labels.js";
  import { getBreakdown } from "#lib/remote/breakdowns.remote.js";
  import { getStatusUrls } from "#lib/remote/statusUrls.remote.js";

  let { data } = $props();

  const dimensionLabels: Record<string, string> = {
    status: "Status codes",
    country: "Countries",
    device: "Devices",
  };

  const grainLabels: Record<Grain, string> = {
    hour: "Hourly",
    day: "Daily",
    month: "Monthly",
  };

  function dimensionLabel(value: string): string {
    return dimensionLabels[value] ?? value;
  }

  function isDimension(value: string): value is Dimension {
    return (dimensions as ReadonlyArray<string>).includes(value);
  }

  function isGrain(value: string | null): value is Grain {
    return value != null && (grains as ReadonlyArray<string>).includes(value);
  }

  function isTier(value: string | null): value is Tier {
    return value != null && (tiers as ReadonlyArray<string>).includes(value);
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

  const tier = $derived<Tier>(isTier(page.url.searchParams.get("tier")) ? (page.url.searchParams.get("tier") as Tier) : "all");

  const periodKey = $derived(page.url.searchParams.get("period") ?? defaultPeriodKey(grain));

  function updateUrl(next: { grain: Grain; period: string; tier: Tier }): void {
    const params = new URLSearchParams(page.url.search);
    params.set("grain", next.grain);
    params.set("period", next.period);
    params.set("tier", next.tier);
    void goto(`${page.url.pathname}?${params.toString()}`, { reset: false });
  }

  function selectGrain(nextGrain: Grain): void {
    updateUrl({ grain: nextGrain, period: defaultPeriodKey(nextGrain), tier });
  }

  function selectPeriod(nextPeriod: string): void {
    updateUrl({ grain, period: nextPeriod, tier });
  }

  function selectTier(nextTier: Tier): void {
    updateUrl({ grain, period: periodKey, tier: nextTier });
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

<div class="cluster page-head">
  <h1>Breakdown</h1>
  <AboutData
    processingLagHours={data.processingLagHours}
    hourlyRetentionDays={data.hourlyRetentionDays}
    notes={["processingLag", "hourlyRetention", "uniqueVisitors"]}
  />
</div>

<div class="controls-panel">
  <div class="control-field">
    <span class="control-label">
      Dimension
      <Tooltip text="What to break the traffic down by for the selected period.">
        <span class="info-dot" aria-hidden="true">?</span>
      </Tooltip>
    </span>
    <nav class="cluster chip-group" aria-label="Dimension">
      {#each dimensions as dimensionOption (dimensionOption)}
        <a
          href="/breakdowns/{dimensionOption}?grain={grain}&period={periodKey}&tier={tier}"
          class="chip"
          class:selected={dimension === dimensionOption}
          aria-current={dimension === dimensionOption ? "page" : undefined}
        >
          {dimensionLabel(dimensionOption)}
        </a>
      {/each}
    </nav>
  </div>

  <div class="control-field">
    <span class="control-label">
      Granularity
      <Tooltip text="How finely the selected period is bucketed.">
        <span class="info-dot" aria-hidden="true">?</span>
      </Tooltip>
    </span>
    <div class="cluster chip-group" role="group" aria-label="Granularity">
      {#each grains as grainOption (grainOption)}
        <button
          type="button"
          class="chip"
          aria-pressed={grain === grainOption}
          onclick={() => selectGrain(grainOption)}
        >
          {grainLabels[grainOption]}
        </button>
      {/each}
    </div>
  </div>

  <div class="control-field">
    <span class="control-label">
      Traffic
      <Tooltip text="Which requests are counted. All = every logged request; Real = genuine HTML page views; Sitemap = pages declared in your sitemap.">
        <span class="info-dot" aria-hidden="true">?</span>
      </Tooltip>
    </span>
    <div class="cluster chip-group" role="group" aria-label="Traffic tier">
      {#each tiers as tierOption (tierOption)}
        <button
          type="button"
          class="chip"
          aria-pressed={tier === tierOption}
          onclick={() => selectTier(tierOption)}
        >
          {tierLabel(tierOption)}
        </button>
      {/each}
    </div>
  </div>

  <div class="control-field period-field">
    <span class="control-label">Period</span>
    <PeriodPicker view={grain} value={periodKey} startKey={data.startKey} onchange={selectPeriod} />
  </div>
</div>

<p class="period-caption">
  {dimensionLabel(dimension)} · {formatPeriodLabel({ view: grain, periodKey })} · {tierDescription(tier)}
</p>

{#if dimension === "country"}
  <p class="dimension-note">Unique visitors are tracked site-wide only, not per country.</p>
{/if}

<svelte:boundary>
  {#snippet pending()}
    <p>Loading breakdown…</p>
  {/snippet}

  {@const result = await getBreakdown({ dimension, grain, periodKey, tier })}

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
              <td>
                {#if dimension === "status"}
                  {@const explanation = statusCodeExplanation(item.value)}
                  {#if explanation != null}
                    <Tooltip text={explanation}>
                      <span class="status-value">{item.value}</span>
                    </Tooltip>
                  {:else}
                    {item.value}
                  {/if}
                {:else if dimension === "country"}
                  {formatCountry(item.value)}
                  <span class="value-code">{item.value}</span>
                {:else}
                  {item.value}
                {/if}
              </td>
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

  .period-caption {
    margin: 0 0 var(--vs-l);
    color: var(--fg-7);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .status-value {
    cursor: help;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }

  .value-code {
    margin-left: var(--vs-xs, 0.25rem);
    color: var(--fg-5);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
</style>
