<script lang="ts">
  import SummaryCard from "$lib/components/summaryCard.svelte";

  let { data } = $props();

  const maxDaily = $derived(
    Math.max(
      ...data.stats.map(
        (day) => day.processed + day.manualUpload + day.totalRejected,
      ),
      1,
    ),
  );
</script>

<h1>Processing Stats</h1>

<p class="subtitle">
  Last 30 days ({data.dateRange.startDate} — {data.dateRange.endDate})
</p>

<div class="summary-cards">
  <SummaryCard label="Processed" value={data.totals.processed.toLocaleString()} />
  <SummaryCard label="Manual Uploads" value={data.totals.manualUpload.toLocaleString()} />
  <SummaryCard label="Total Rejected" value={data.totals.totalRejected.toLocaleString()} />
  <SummaryCard
    label="Auth Rejected"
    value={data.totals.authRejected.toLocaleString()}
  />
  <SummaryCard
    label="Spam Rejected"
    value={data.totals.spamRejected.toLocaleString()}
  />
  <SummaryCard
    label="Virus Rejected"
    value={data.totals.virusRejected.toLocaleString()}
  />
</div>

{#if data.stats.length === 0}
  <p>No processing stats recorded yet.</p>
{:else}
  <section class="section">
    <h2>Daily Breakdown</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th class="num">Processed</th>
          <th class="num">Manual</th>
          <th class="num">Auth Rejected</th>
          <th class="num">Spam</th>
          <th class="num">Virus</th>
          <th>Volume</th>
        </tr>
      </thead>
      <tbody>
        {#each data.stats as day}
          {@const total = day.processed + day.manualUpload + day.totalRejected}
          {@const processedPct = total > 0 ? ((day.processed + day.manualUpload) / maxDaily) * 100 : 0}
          {@const rejectedPct = total > 0 ? (day.totalRejected / maxDaily) * 100 : 0}
          {@const highRejection = day.totalRejected > day.processed + day.manualUpload}
          <tr class:row-warn={highRejection}>
            <td class="date">{day.date}</td>
            <td class="num">{day.processed.toLocaleString()}</td>
            <td class="num">{day.manualUpload > 0 ? day.manualUpload.toLocaleString() : "—"}</td>
            <td class="num reject">{day.authRejected > 0 ? day.authRejected.toLocaleString() : "—"}</td>
            <td class="num reject">{day.spamRejected > 0 ? day.spamRejected.toLocaleString() : "—"}</td>
            <td class="num reject">{day.virusRejected > 0 ? day.virusRejected.toLocaleString() : "—"}</td>
            <td class="bar-cell">
              <div class="bar-container">
                <div class="bar bar-pass" style="width: {processedPct}%"></div>
                <div class="bar bar-fail" style="width: {rejectedPct}%"></div>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="legend">
    <span class="legend-item"><span class="legend-swatch swatch-pass"></span> Processed</span>
    <span class="legend-item"><span class="legend-swatch swatch-fail"></span> Rejected</span>
  </section>
{/if}

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 0.25rem;
  }

  h2 {
    font-size: 1.15rem;
    margin: 0 0 0.75rem;
  }

  .subtitle {
    font-size: 0.875rem;
    color: var(--text-2, #64748b);
    margin: 0 0 1.5rem;
  }

  .summary-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .section {
    margin-bottom: 2rem;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .date {
    white-space: nowrap;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.85rem;
  }

  .reject {
    color: var(--color-fail, #991b1b);
  }

  .row-warn td {
    background: var(--color-warn-bg, #fef9c3);
  }

  .bar-cell {
    width: 200px;
    min-width: 120px;
  }

  .bar-container {
    display: flex;
    height: 1rem;
    border-radius: 0.2rem;
    overflow: hidden;
    background: var(--surface-1, #f8f9fa);
  }

  .bar {
    height: 100%;
    transition: width 0.2s;
  }

  .bar-pass {
    background: var(--color-pass, #166534);
    opacity: 0.7;
  }

  .bar-fail {
    background: var(--color-fail, #991b1b);
    opacity: 0.7;
  }

  .legend {
    display: flex;
    gap: 1.5rem;
    font-size: 0.8rem;
    color: var(--text-2, #64748b);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .legend-swatch {
    display: inline-block;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 0.15rem;
  }

  .swatch-pass {
    background: var(--color-pass, #166534);
    opacity: 0.7;
  }

  .swatch-fail {
    background: var(--color-fail, #991b1b);
    opacity: 0.7;
  }
</style>
