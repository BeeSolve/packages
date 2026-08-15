<script lang="ts">
  import StatusBadge from "$lib/components/statusBadge.svelte";

  let { data } = $props();

  const passRate = $derived(
    data.report.totalMessages > 0
      ? Math.round((data.report.totalPass / data.report.totalMessages) * 100)
      : 0,
  );

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function alignmentLabel(value: "r" | "s"): string {
    return value === "r" ? "relaxed" : "strict";
  }
</script>

<h1>Report: {data.report.orgName}</h1>

<p class="back-link">
  <a href="/domains/{data.domain}">&larr; Back to {data.domain}</a>
</p>

<section class="metadata">
  <dl>
    <div class="dl-item">
      <dt>Organization</dt>
      <dd>{data.report.orgName}</dd>
    </div>
    <div class="dl-item">
      <dt>Contact</dt>
      <dd>{data.report.email}</dd>
    </div>
    <div class="dl-item">
      <dt>Report ID</dt>
      <dd><code>{data.report.reportId}</code></dd>
    </div>
    <div class="dl-item">
      <dt>Date Range</dt>
      <dd>{formatDate(data.report.dateRangeBegin)} — {formatDate(data.report.dateRangeEnd)}</dd>
    </div>
    <div class="dl-item">
      <dt>Policy</dt>
      <dd><code>{data.report.policy}</code> ({data.report.pct}%)</dd>
    </div>
    <div class="dl-item">
      <dt>DKIM Alignment</dt>
      <dd>{alignmentLabel(data.report.adkim)}</dd>
    </div>
    <div class="dl-item">
      <dt>SPF Alignment</dt>
      <dd>{alignmentLabel(data.report.aspf)}</dd>
    </div>
    <div class="dl-item">
      <dt>Pass Rate</dt>
      <dd><StatusBadge rate={passRate} /></dd>
    </div>
  </dl>
</section>

<section class="section">
  <h2>Records ({data.report.records.length})</h2>

  {#if data.report.records.length === 0}
    <p>No records in this report.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Source IP</th>
          <th class="num">Count</th>
          <th>SPF</th>
          <th>DKIM</th>
          <th>Disposition</th>
          <th>Override Reasons</th>
        </tr>
      </thead>
      <tbody>
        {#each data.report.records as record}
          {@const hasAction = record.policyEvaluated.disposition !== "none"}
          <tr class:row-fail={hasAction}>
            <td class="ip">{record.sourceIp}</td>
            <td class="num">{record.count.toLocaleString()}</td>
            <td class="result result-{record.policyEvaluated.spf}">{record.policyEvaluated.spf}</td>
            <td class="result result-{record.policyEvaluated.dkim}">{record.policyEvaluated.dkim}</td>
            <td>
              <code class="disposition disposition-{record.policyEvaluated.disposition}">
                {record.policyEvaluated.disposition}
              </code>
            </td>
            <td>
              {#if record.policyEvaluated.reason}
                {#each record.policyEvaluated.reason as reason}
                  <span class="reason">{reason.type}{reason.comment ? `: ${reason.comment}` : ""}</span>
                {/each}
              {:else}
                —
              {/if}
            </td>
          </tr>

          <tr class="detail-row" class:row-fail={hasAction}>
            <td colspan="6">
              <div class="auth-detail">
                {#if record.authResults.dkim.length > 0}
                  <div class="auth-group">
                    <strong>DKIM:</strong>
                    {#each record.authResults.dkim as dkim}
                      <span class="auth-item result-{dkim.result}">
                        {dkim.domain}{dkim.selector ? ` (s=${dkim.selector})` : ""} → {dkim.result}
                      </span>
                    {/each}
                  </div>
                {/if}
                {#if record.authResults.spf.length > 0}
                  <div class="auth-group">
                    <strong>SPF:</strong>
                    {#each record.authResults.spf as spf}
                      <span class="auth-item result-{spf.result}">
                        {spf.domain}{spf.scope ? ` (${spf.scope})` : ""} → {spf.result}
                      </span>
                    {/each}
                  </div>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 0.25rem;
  }

  h2 {
    font-size: 1.15rem;
    margin: 0 0 0.75rem;
  }

  .back-link {
    margin: 0 0 1.5rem;
    font-size: 0.875rem;
  }

  .metadata {
    margin-bottom: 2rem;
    padding: 1.25rem 1.5rem;
    background: var(--surface-1, #f8f9fa);
    border-radius: 0.5rem;
    border: 1px solid var(--border, #e2e8f0);
  }

  dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.75rem 2rem;
    margin: 0;
  }

  .dl-item {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  dt {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2, #64748b);
  }

  dd {
    margin: 0;
    font-size: 0.9rem;
  }

  .section {
    margin-bottom: 2.5rem;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .ip {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.85rem;
  }

  .result-pass {
    color: var(--color-pass, #166534);
    font-weight: 600;
  }

  .result-fail {
    color: var(--color-fail, #991b1b);
    font-weight: 600;
  }

  .row-fail td {
    background: var(--color-fail-bg, #fee2e2);
  }

  code {
    font-size: 0.8rem;
    padding: 0.1rem 0.4rem;
    background: var(--surface-1, #f8f9fa);
    border-radius: 0.25rem;
  }

  .disposition {
    font-size: 0.75rem;
    padding: 0.1rem 0.35rem;
    border-radius: 0.2rem;
  }

  .disposition-quarantine {
    background: var(--color-warn-bg, #fef9c3);
    color: var(--color-warn, #854d0e);
  }

  .disposition-reject {
    background: var(--color-fail-bg, #fee2e2);
    color: var(--color-fail, #991b1b);
  }

  .reason {
    font-size: 0.8rem;
    color: var(--text-2, #64748b);
  }

  .detail-row td {
    padding-top: 0;
    border-bottom: 2px solid var(--border, #e2e8f0);
  }

  .auth-detail {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    font-size: 0.8rem;
    padding: 0.25rem 0;
  }

  .auth-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .auth-item {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.8rem;
  }
</style>
