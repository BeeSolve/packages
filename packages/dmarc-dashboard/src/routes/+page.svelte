<script lang="ts">
  import { enhance } from "$app/forms";
  import StatusBadge from "$lib/components/statusBadge.svelte";
  import SummaryCard from "$lib/components/summaryCard.svelte";

  let { data, form } = $props();

  const totals = $derived({
    messages: data.domains.reduce((sum, domain) => sum + domain.totalMessages, 0),
    pass: data.domains.reduce((sum, domain) => sum + domain.totalPass, 0),
    fail: data.domains.reduce((sum, domain) => sum + domain.totalFail, 0),
  });

  const overallPassRate = $derived(
    totals.messages > 0 ? Math.round((totals.pass / totals.messages) * 100) : 0,
  );
</script>

<h1>Domain Overview</h1>

{#if form?.error}
  <p class="error">{form.error}</p>
{/if}

<div class="summary-cards">
  <SummaryCard label="Domains" value={data.domains.length} />
  <SummaryCard label="Total Messages" value={totals.messages.toLocaleString()} />
  <SummaryCard label="Pass Rate" value="{overallPassRate}%" />
  <SummaryCard label="Failures" value={totals.fail.toLocaleString()} />
</div>

{#if data.domains.length === 0}
  <p>No domains found.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Domain</th>
        <th class="num">Messages</th>
        <th class="num">Pass</th>
        <th class="num">Fail</th>
        <th>Pass Rate</th>
        <th>Backfill</th>
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
          <td><StatusBadge {rate} /></td>
          <td>
            <form method="POST" use:enhance style="display:inline">
              <input type="hidden" name="domain" value={domain.domain} />
              <button type="submit" disabled={!domain.canRun}>Run backfill</button>
            </form>
            {#if domain.lastRun != null}
              <span class="last-run">
                {domain.lastRun.status}
                {#if domain.lastRun.finishedAt != null}
                  · {new Date(domain.lastRun.finishedAt).toLocaleString()}
                {/if}
                {#if domain.lastRun.ipsEnriched != null}
                  · {domain.lastRun.ipsEnriched.toLocaleString()} IPs
                {/if}
              </span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1.25rem;
  }

  .summary-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .error {
    color: #b00020;
    margin: 0 0 1rem;
  }

  .last-run {
    margin-left: 0.5rem;
    font-size: 0.85rem;
    color: #666;
  }
</style>
