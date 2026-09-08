<script lang="ts">
  import MessageStatusBadge from "$lib/components/messageStatusBadge.svelte";
  import SummaryCard from "$lib/components/summaryCard.svelte";

  let { data } = $props();

  const stats = $derived(data.stats);

  function rate(part: number, whole: number): number {
    if (whole <= 0) return 0;
    return Math.round((part / whole) * 1000) / 10;
  }

  // Delivery rate is computed against sent; bounce and complaint rates follow
  // SES's own denominators (bounces/complaints per sent message). SES flags an
  // account when bounce rate reaches 5% or complaint rate reaches 0.1%.
  const deliveryRate = $derived(rate(stats.delivered, stats.sent));
  const bounceRate = $derived(rate(stats.bounced, stats.sent));
  const complaintRate = $derived(rate(stats.complained, stats.sent));

  const bounceFlagged = $derived(bounceRate >= 5);
  const complaintFlagged = $derived(complaintRate >= 0.1);

  function formatDateTime(value: string): string {
    return new Date(value).toLocaleString();
  }
</script>

<h1>Overview</h1>

<div class="layout-card summary-cards" style="--min-card-width: 9rem; --gap: var(--vs-base);">
  <SummaryCard label="Received" value={stats.received.toLocaleString()} />
  <SummaryCard label="Sent" value={stats.sent.toLocaleString()} />
  <SummaryCard label="Delivered" value={stats.delivered.toLocaleString()} />
  <SummaryCard label="Bounced" value={stats.bounced.toLocaleString()} />
  <SummaryCard label="Complained" value={stats.complained.toLocaleString()} />
  <SummaryCard label="Rejected" value={stats.rejected.toLocaleString()} />
  <SummaryCard label="Failed" value={stats.failed.toLocaleString()} />
</div>

<div class="layout-card rates" style="--min-card-width: 11rem; --gap: var(--vs-base);">
  <SummaryCard label="Delivery rate" value="{deliveryRate}%" />
  <SummaryCard
    label="Bounce rate"
    value="{bounceRate}%"
    flagged={bounceFlagged}
    warn={bounceFlagged ? "Above SES 5% threshold" : undefined}
  />
  <SummaryCard
    label="Complaint rate"
    value="{complaintRate}%"
    flagged={complaintFlagged}
    warn={complaintFlagged ? "Above SES 0.1% threshold" : undefined}
  />
  <SummaryCard
    label="Avg delivery latency"
    value={data.averageDeliveryMs != null ? `${(data.averageDeliveryMs / 1000).toFixed(1)}s` : "—"}
    subtitle="recent messages"
  />
</div>

<h2>Recent messages (this month)</h2>

{#if data.recent.length === 0}
  <p>No messages this month.</p>
{:else}
  <div class="table">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Recipients</th>
          <th>Subject</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {#each data.recent as message}
          <tr>
            <td>{formatDateTime(message.createdAt)}</td>
            <td>{message.recipients.join(", ")}</td>
            <td><a href="/messages/{message.id}">{message.subject}</a></td>
            <td><MessageStatusBadge status={message.status} /></td>
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

  h2 {
    font-size: 1.15rem;
    margin: var(--vs-l) 0 var(--vs-base);
  }

  .summary-cards {
    margin-bottom: var(--vs-base);
  }

  .rates {
    margin-bottom: var(--vs-l);
  }
</style>
