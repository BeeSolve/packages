<script lang="ts">
  import { page } from "$app/state";
  import type { Dimension, Grain } from "@beesolve/analytics-processor";
  import { dimensions, grains } from "@beesolve/analytics-processor";

  import { getBreakdown } from "#lib/remote/breakdowns.remote.js";

  function isDimension(value: string): value is Dimension {
    return (dimensions as ReadonlyArray<string>).includes(value);
  }

  function defaultPeriodKey(grain: Grain): string {
    const now = new Date();
    const year = now.getUTCFullYear().toString().padStart(4, "0");
    const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = now.getUTCDate().toString().padStart(2, "0");
    const hour = now.getUTCHours().toString().padStart(2, "0");
    if (grain === "hour") return `${year}-${month}-${day}-${hour}`;
    if (grain === "day") return `${year}-${month}-${day}`;
    return `${year}-${month}`;
  }

  const dimension = $derived<Dimension>(
    isDimension(page.params.dimension ?? "") ? (page.params.dimension as Dimension) : "path",
  );

  let grain = $state<Grain>("day");
  let periodKey = $state(defaultPeriodKey("day"));

  function selectGrain(next: Grain): void {
    grain = next;
    periodKey = defaultPeriodKey(next);
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
      href="/breakdowns/{dimensionOption}"
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
  <label class="period-label">
    Period
    <input type="text" bind:value={periodKey} />
  </label>
</div>

<svelte:boundary>
  {#snippet pending()}
    <p>Loading breakdown…</p>
  {/snippet}

  {@const data = await getBreakdown({ dimension, grain, periodKey })}

  {#if data.items.length === 0}
    <p>No data for {dimension} in {periodKey}.</p>
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
          {#each data.items as item (item.value)}
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
</svelte:boundary>

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1rem;
  }

  .dimension-nav {
    margin-bottom: var(--vs-base);
  }

  .controls {
    margin-bottom: var(--vs-l);
    gap: var(--vs-base);
    align-items: flex-end;
  }

  .period-label {
    display: flex;
    flex-direction: column;
    font-size: 0.8rem;
    color: var(--fg-7);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
