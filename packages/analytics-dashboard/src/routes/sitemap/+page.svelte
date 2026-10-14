<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  import { getSitemapComparison } from "#lib/remote/sitemap.remote.js";

  function pad2(input: number): string {
    return input.toString().padStart(2, "0");
  }

  function monthKeyFor(date: Date): string {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
  }

  function currentMonthKey(): string {
    return monthKeyFor(new Date());
  }

  function oneYearEarlierKey(): string {
    const now = new Date();
    return monthKeyFor(new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)));
  }

  const monthA = $derived(page.url.searchParams.get("monthA") ?? oneYearEarlierKey());
  const monthB = $derived(page.url.searchParams.get("monthB") ?? currentMonthKey());

  function updateUrl(next: { monthA: string; monthB: string }): void {
    const params = new URLSearchParams(page.url.search);
    params.set("monthA", next.monthA);
    params.set("monthB", next.monthB);
    void goto(`${page.url.pathname}?${params.toString()}`, { reset: false });
  }

  function onMonthA(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement) || target.value === "") return;
    updateUrl({ monthA: target.value, monthB });
  }

  function onMonthB(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement) || target.value === "") return;
    updateUrl({ monthA, monthB: target.value });
  }

  function formatDelta(delta: number): string {
    const sign = delta > 0 ? "+" : "";
    return `${sign}${delta.toLocaleString()}`;
  }
</script>

<h1>Sitemap</h1>

<div class="cluster controls">
  <label class="month-field">
    <span>Month A</span>
    <input type="month" value={monthA} onchange={onMonthA} aria-label="Month A" />
  </label>
  <label class="month-field">
    <span>Month B</span>
    <input type="month" value={monthB} onchange={onMonthB} aria-label="Month B" />
  </label>
</div>

<svelte:boundary>
  {#snippet pending()}
    <p>Loading comparison…</p>
  {/snippet}

  {@const result = await getSitemapComparison({ monthA, monthB })}

  {#if result.items.length === 0}
    <p>No sitemap data for these months.</p>
  {:else}
    <div class="table">
      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th class="num">Hits ({result.monthA})</th>
            <th class="num">Hits ({result.monthB})</th>
            <th class="num">Delta</th>
          </tr>
        </thead>
        <tbody>
          {#each result.items as item (item.path)}
            <tr>
              <td>{item.path}</td>
              <td class="num">{item.hitsA.toLocaleString()}</td>
              <td class="num">{item.hitsB.toLocaleString()}</td>
              <td class="num" class:gain={item.delta > 0} class:loss={item.delta < 0}>
                {formatDelta(item.delta)}
              </td>
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

  .controls {
    margin-bottom: var(--vs-l);
    gap: var(--vs-base);
    align-items: flex-end;
  }

  .month-field {
    display: flex;
    flex-direction: column;
    gap: var(--vs-s);
    font-size: 0.875rem;
    color: var(--fg-7);
  }

  .month-field input {
    margin: 0;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .gain {
    color: var(--success);
  }

  .loss {
    color: var(--error);
  }
</style>
