<script lang="ts">
  import { enhance } from "$app/forms";
  import StatusBadge from "$lib/components/statusBadge.svelte";
  import SummaryCard from "$lib/components/summaryCard.svelte";

  let { data, form } = $props();

  let submittingDomain = $state<string | null>(null);

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
{#if form?.started}
  <div class="callout fill notice">
    Refreshing IP details for {form.domain}. This runs in the background.
  </div>
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
  <div class="table-scroll">
    <table>
      <thead>
        <tr>
          <th>Domain</th>
          <th class="num">Messages</th>
          <th class="num">Pass</th>
          <th class="num">Fail</th>
          <th>Pass Rate</th>
          <th>Sender origins</th>
        </tr>
      </thead>
      <tbody>
        {#each data.domains as domain}
          {@const rate = domain.totalMessages > 0 ? Math.round((domain.totalPass / domain.totalMessages) * 100) : 0}
          {@const submitting = submittingDomain === domain.domain}
          <tr>
            <td><a href="/domains/{domain.domain}">{domain.domain}</a></td>
            <td class="num">{domain.totalMessages.toLocaleString()}</td>
            <td class="num">{domain.totalPass.toLocaleString()}</td>
            <td class="num">{domain.totalFail.toLocaleString()}</td>
            <td><StatusBadge {rate} /></td>
            <td>
              <div class="origins-cell">
                <form
                  method="POST"
                  use:enhance={() => {
                    submittingDomain = domain.domain;
                    return async ({ update }) => {
                      await update();
                      submittingDomain = null;
                    };
                  }}
                >
                  <input type="hidden" name="domain" value={domain.domain} />
                  <button
                    type="submit"
                    class="button mini ghost refresh-btn"
                    disabled={!domain.canRun || submitting}
                    title="Look up the network operator (ASN / organisation) and country for this domain's source IPs, so the source IP table shows who is really sending."
                  >
                    {submitting ? "Refreshing…" : "Refresh IP details"}
                  </button>
                </form>
                {#if domain.lastRun != null}
                  <span class="last-run">
                    {#if domain.lastRun.status === "started"}
                      In progress…
                    {:else if domain.lastRun.status === "finished"}
                      Updated{#if domain.lastRun.ipsEnriched != null}
                        · {domain.lastRun.ipsEnriched.toLocaleString()} IPs{/if}{#if domain.lastRun.finishedAt != null}
                        · {new Date(domain.lastRun.finishedAt).toLocaleDateString()}{/if}
                    {:else if domain.lastRun.status === "failed"}
                      Last refresh failed
                    {/if}
                  </span>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="hint">
    “Refresh IP details” looks up the network operator and country for each source IP so the per-domain
    Source IP table can show who is really sending mail for the domain.
  </p>
{/if}

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1.25rem;
  }

  /* Gap: responsive grid for the overview cards (graffiti .stat-card
     supplies the card visuals via SummaryCard). auto-fit keeps them in a row
     on wide screens and wraps gracefully when space runs out. */
  .summary-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: var(--vs-base);
    margin-bottom: var(--vs-l);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .error {
    color: var(--error);
    margin: 0 0 1rem;
  }

  .notice {
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }

  .origins-cell {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
  }

  .origins-cell form {
    display: inline;
  }

  .origins-cell button[type="submit"] {
    margin-block-start: 0;
  }

  .refresh-btn {
    white-space: nowrap;
  }

  .last-run {
    font-size: 0.8rem;
    color: var(--fg-5);
    white-space: nowrap;
  }

  .hint {
    margin: 1rem 0 0;
    font-size: 0.85rem;
    color: var(--fg-5);
    max-width: 60ch;
  }
</style>
