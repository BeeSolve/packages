<script lang="ts">
  import Calendar from "$lib/components/calendar.svelte";
  import StatusBadge from "$lib/components/statusBadge.svelte";
  import SummaryCard from "$lib/components/summaryCard.svelte";

  let { data } = $props();

  const verdictLabels: Record<string, string> = {
    legitimate: "Legitimate",
    forwarded: "Forwarded",
    spoofing: "Likely spoofing",
    suspicious: "Suspicious",
  };

  function verdictLabel(verdict: string): string {
    return verdictLabels[verdict] ?? verdict;
  }

  function ipOrigin(row: { asName?: string; country?: string }): string {
    if (row.asName != null && row.country != null) return `${row.asName} · ${row.country}`;
    if (row.asName != null) return row.asName;
    if (row.country != null) return row.country;
    return "—";
  }

  const passRate = $derived(
    data.aggregate.totalMessages > 0
      ? Math.round((data.aggregate.totalPass / data.aggregate.totalMessages) * 100)
      : 0,
  );

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function reportHref(report: { dateRangeBegin: number; orgName: string; reportId: string }): string {
    const key = btoa(JSON.stringify({
      timestamp: report.dateRangeBegin,
      orgName: report.orgName,
      reportId: report.reportId,
    })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    return `/domains/${data.domain}/reports/${key}`;
  }
</script>

<h1>{data.domain}</h1>

<p class="back-link"><a href="/">&larr; Back to domains</a></p>

<div class="top-bar">
  <div class="summary-cards">
    <SummaryCard label="Total Messages" value={data.aggregate.totalMessages.toLocaleString()} />
    <SummaryCard label="Pass Rate" value="{passRate}%" />
    <SummaryCard label="Unique IPs" value={data.aggregate.uniqueIps} />
    <SummaryCard label="Reports" value={data.aggregate.reportCount} />
    <SummaryCard label="SPF Pass Rate" value="{data.aggregate.spfPassRate}%" />
    <SummaryCard label="DKIM Pass Rate" value="{data.aggregate.dkimPassRate}%" />
    <SummaryCard
      label="Spoofing Blocked"
      value={data.aggregate.spoofingAttempts.toLocaleString()}
      subtitle="failed SPF + DKIM, rejected/quarantined"
    />
  </div>

  <aside class="sidebar">
    <Calendar
      displayMonth={data.displayMonth}
      currentMonth={data.currentMonth}
      today={data.today}
      selectedDate={data.dateFilter}
      domain={data.domain}
    />
  </aside>
</div>

<div class="content">
  <div class="tabs" style="--tab-count: 3">
    <details name="domain-tab" style="--n: 1" open>
      <summary>
        Source IPs
        <span class="tag mini tab-count">{data.aggregate.sourceIpBreakdown.length}</span>
      </summary>
      <section class="section">
        <h2>Source IP Analysis</h2>
        <p class="scope-note">
          Aggregate reports show domain-level statistics only. The specific sender
          address, subject, and recipients are not included in this report type.
        </p>
        {#if data.aggregate.sourceIpBreakdown.length === 0}
          <p class="empty">No source IPs found{data.dateFilter ? " for this date" : ""}.</p>
        {:else}
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Source IP</th>
                  <th>Origin</th>
                  <th>Verdict</th>
                  <th class="num">Messages</th>
                  <th class="num">SPF Pass</th>
                  <th class="num">SPF Fail</th>
                  <th class="num">DKIM Pass</th>
                  <th class="num">DKIM Fail</th>
                  <th>Dispositions</th>
                </tr>
              </thead>
              <tbody>
                {#each data.aggregate.sourceIpBreakdown as row}
                  {@const hasFailure = row.spfFail > 0 || row.dkimFail > 0}
                  {@const hasAction = row.dispositions.some((disposition) => disposition !== "none")}
                  <tr class:row-warn={hasFailure && !hasAction} class:row-fail={hasAction}>
                    <td class="ip">
                      {row.ip}
                      {#if row.headerFroms.length > 0}
                        <span class="header-from">From: {row.headerFroms.join(", ")}</span>
                      {/if}
                      {#if row.spfResults.length > 0 || row.dkimResults.length > 0}
                        <span class="auth-detail">
                          {#if row.spfResults.length > 0}spf={row.spfResults.join("/")}{/if}
                          {#if row.dkimResults.length > 0}dkim={row.dkimResults.join("/")}{/if}
                        </span>
                      {/if}
                      {#if row.policyReasons.length > 0}
                        <span class="policy-reason">{row.policyReasons.join("; ")}</span>
                      {/if}
                    </td>
                    <td class="origin">{ipOrigin(row)}</td>
                    <td>
                      <span class="tag verdict-{row.verdict}">{verdictLabel(row.verdict)}</span>
                    </td>
                    <td class="num">{row.count.toLocaleString()}</td>
                    <td class="num pass">{row.spfPass.toLocaleString()}</td>
                    <td class="num fail">{row.spfFail > 0 ? row.spfFail.toLocaleString() : "—"}</td>
                    <td class="num pass">{row.dkimPass.toLocaleString()}</td>
                    <td class="num fail">{row.dkimFail > 0 ? row.dkimFail.toLocaleString() : "—"}</td>
                    <td>
                      {#each row.dispositions as disposition}
                        <span class="tag disposition disposition-{disposition}">{disposition}</span>
                      {/each}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    </details>

    <details name="domain-tab" style="--n: 2">
      <summary>
        Authorized senders
        <span class="tag mini tab-count">{data.aggregate.senderAlignment.length}</span>
      </summary>
      <section class="section">
        <h2>Authorized Senders</h2>
        <p class="scope-note">
          Source IPs whose mail passed DMARC (SPF or DKIM aligned to your domain). These are
          your legitimate senders — if a sender you recognize is missing here, your SPF/DKIM DNS
          records may need updating.
        </p>
        {#if data.aggregate.senderAlignment.length === 0}
          <p class="empty">No aligned senders found{data.dateFilter ? " for this date" : ""}.</p>
        {:else}
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Source IP</th>
                  <th>Origin</th>
                  <th class="num">Messages</th>
                  <th>SPF Aligned</th>
                  <th>DKIM Aligned</th>
                </tr>
              </thead>
              <tbody>
                {#each data.aggregate.senderAlignment as row}
                  <tr>
                    <td class="ip">{row.ip}</td>
                    <td class="origin">{ipOrigin(row)}</td>
                    <td class="num">{row.count.toLocaleString()}</td>
                    <td>
                      {#if row.spfAligned}
                        <span class="align align-yes" title="SPF aligned">✓ Aligned</span>
                      {:else}
                        <span class="align align-no" title="not SPF aligned">— </span>
                      {/if}
                    </td>
                    <td>
                      {#if row.dkimAligned}
                        <span class="align align-yes" title="DKIM aligned">✓ Aligned</span>
                      {:else}
                        <span class="align align-no" title="not DKIM aligned">— </span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    </details>

    <details name="domain-tab" style="--n: 3">
      <summary>
        Reports
        <span class="tag mini tab-count">{data.reports.length}{data.cursor ? "+" : ""}</span>
      </summary>
      <section class="section">
        <h2>
          Reports
          {#if data.dateFilter}
            <span class="date-filter-label">
              — {formatDate(Date.parse(`${data.dateFilter}T00:00:00Z`) / 1000)}
              <a href="/domains/{data.domain}" class="clear-filter">Clear filter</a>
            </span>
          {/if}
        </h2>

        {#if data.reports.length === 0}
          <p class="empty">No reports found{data.dateFilter ? " for this date" : " for this domain"}.</p>
        {:else}
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Organization</th>
                  <th class="num">Messages</th>
                  <th class="num">Pass</th>
                  <th class="num">Fail</th>
                  <th>Pass Rate</th>
                  <th>Policy</th>
                </tr>
              </thead>
              <tbody>
                {#each data.reports as report}
                  {@const rate = report.totalMessages > 0 ? Math.round((report.totalPass / report.totalMessages) * 100) : 0}
                  <tr>
                    <td class="date">
                      <a href={reportHref(report)}>
                        {formatDate(report.dateRangeBegin)}
                      </a>
                    </td>
                    <td>{report.orgName}</td>
                    <td class="num">{report.totalMessages.toLocaleString()}</td>
                    <td class="num">{report.totalPass.toLocaleString()}</td>
                    <td class="num">{report.totalFail.toLocaleString()}</td>
                    <td><StatusBadge {rate} /></td>
                    <td><code>{report.policy}</code></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          {#if data.cursor}
            <p class="load-more">
              <a href="?cursor={data.cursor}">Load more &rarr;</a>
            </p>
          {/if}
        {/if}
      </section>
    </details>
  </div>
</div>

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
    margin: 0 0 var(--vs-m);
    font-size: 0.875rem;
  }

  /* Gap: graffiti has no cards+aside top-bar layout, so this positioning is
     ours. The cards themselves are graffiti .stat-card (see SummaryCard). */
  .summary-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--vs-s);
    flex: 1;
    min-width: 0;
    align-content: start;
  }

  .top-bar {
    display: flex;
    gap: var(--vs-m);
    align-items: flex-start;
    margin-bottom: var(--vs-l);
  }

  .sidebar {
    flex-shrink: 0;
  }

  .content {
    width: 100%;
  }

  .section {
    margin-bottom: var(--vs-l);
  }

  /* Count badge inside the graffiti tab <summary>: a compact neutral tag.
     .tabs styles the underline track; we only tune the little counter. */
  .tab-count {
    --tag-color: var(--fg-5);
    font-size: 0.7rem;
    padding: 0.02rem 0.4rem;
    margin-inline-start: 0.4rem;
  }

  :global(.tabs > details[open]) .tab-count {
    --tag-color: var(--primary);
  }

  .empty {
    color: var(--fg-7);
    font-size: 0.9rem;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .ip {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.85rem;
  }

  .header-from,
  .auth-detail,
  .policy-reason {
    display: block;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.7rem;
    color: var(--fg-5);
    margin-top: 0.15rem;
  }

  .auth-detail {
    display: flex;
    gap: var(--pad-s);
  }

  .origin {
    font-size: 0.8rem;
    color: var(--fg-7);
  }

  .scope-note {
    font-size: 0.8rem;
    color: var(--fg-7);
    margin: -0.25rem 0 0.75rem;
    max-width: 60ch;
  }

  /* Verdict/disposition badges are graffiti .tag; we only choose the hue. */
  .verdict-legitimate {
    --tag-color: var(--success);
  }

  .verdict-forwarded {
    --tag-color: var(--gray, var(--fg-5));
  }

  .verdict-suspicious {
    --tag-color: var(--warning);
  }

  .verdict-spoofing {
    --tag-color: var(--error);
  }

  .pass {
    color: var(--success);
  }

  .fail {
    color: var(--error);
  }

  /* Alignment indicator for the Authorized Senders table. */
  .align {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.8rem;
    font-weight: var(--fw-medium);
  }

  .align-yes {
    color: var(--success);
  }

  .align-no {
    color: var(--fg-4);
  }

  /* Gap: full-row tint for flagged rows — graffiti has no row-status utility. */
  .row-warn td {
    background: color-mix(in oklab, var(--warning) 16%, var(--bg));
  }

  .row-fail td {
    background: color-mix(in oklab, var(--error) 12%, var(--bg));
  }

  .disposition {
    --tag-color: var(--gray, var(--fg-5));
    margin-right: 0.25rem;
  }

  .disposition-quarantine {
    --tag-color: var(--warning);
  }

  .disposition-reject {
    --tag-color: var(--error);
  }

  .date {
    white-space: nowrap;
  }

  .date-filter-label {
    font-size: 0.875rem;
    font-weight: 400;
    color: var(--fg-7);
  }

  .clear-filter {
    font-size: 0.8rem;
    margin-left: 0.5rem;
  }

  .load-more {
    margin-top: 1rem;
    font-size: 0.875rem;
  }

  @media (max-width: 900px) {
    .top-bar {
      flex-direction: column;
    }

    .summary-cards {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      width: 100%;
    }

    .sidebar {
      align-self: center;
    }
  }
</style>
