<script lang="ts">
  import SummaryCard from "$lib/components/summaryCard.svelte";

  let { data } = $props();

  const totals = $derived({
    messages: data.domains.reduce((sum, domain) => sum + domain.totalMessages, 0),
    pass: data.domains.reduce((sum, domain) => sum + domain.totalPass, 0),
    fail: data.domains.reduce((sum, domain) => sum + domain.totalFail, 0),
  });

  const overallDeliveredRate = $derived(
    totals.messages > 0 ? Math.round((totals.pass / totals.messages) * 100) : 0,
  );
</script>

<h1>Domain Overview</h1>

<div class="layout-card summary-cards" style="--min-card-width: 11rem; --gap: var(--vs-base);">
  <SummaryCard label="Domains" value={data.domains.length} />
  <SummaryCard label="Total Messages" value={totals.messages.toLocaleString()} />
  <SummaryCard label="Delivered / not actioned" value="{overallDeliveredRate}%" />
  <SummaryCard label="Blocked" value={totals.fail.toLocaleString()} />
</div>

{#if data.domains.length === 0}
  <p>No domains found.</p>
{:else}
  <div class="table">
    <table>
      <thead>
        <tr>
          <th>Domain</th>
          <th class="num">Messages</th>
          <th class="num">Delivered</th>
          <th class="num">Blocked</th>
          <th class="num">Delivered / not actioned</th>
        </tr>
      </thead>
      <tbody>
        {#each data.domains as domain}
          {@const rate = domain.totalMessages > 0 ? Math.round((domain.totalPass / domain.totalMessages) * 100) : 0}
          <tr>
            <td><a href="/domains/{domain.domain}">{domain.domain}</a></td>
            <td class="num">{domain.totalMessages.toLocaleString()}</td>
            <td class="num">{domain.totalPass.toLocaleString()}</td>
            <td class="num">{domain.totalFail.toLocaleString()}</td>
            <td class="num rate">{rate}%</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1.25rem;
  }

  .summary-cards {
    margin-bottom: var(--vs-l);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .rate {
    color: var(--fg-7);
  }
</style>
