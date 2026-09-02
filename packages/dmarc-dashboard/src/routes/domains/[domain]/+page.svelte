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

  const tabs = ["sources", "authorized", "reports"] as const;
  type Tab = (typeof tabs)[number];
  let activeTab = $state<Tab>("sources");
</script>

<h1>{data.domain}</h1>

<p class="back-link"><a href="/">&larr; Back to domains</a></p>

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

<div class="content-with-calendar">
  <div class="main-content">
    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="tab"
        class:active={activeTab === "sources"}
        aria-selected={activeTab === "sources"}
        onclick={() => (activeTab = "sources")}
      >
        Source IPs
        <span class="tab-count">{data.aggregate.sourceIpBreakdown.length}</span>
      </button>
      <button
        type="button"
        role="tab"
        class="tab"
        class:active={activeTab === "authorized"}
        aria-selected={activeTab === "authorized"}
        onclick={() => (activeTab = "authorized")}
      >
        Authorized senders
        <span class="tab-count">{data.aggregate.senderAlignment.length}</span>
      </button>
      <button
        type="button"
        role="tab"
        class="tab"
        class:active={activeTab === "reports"}
        aria-selected={activeTab === "reports"}
        onclick={() => (activeTab = "reports")}
      >
        Reports
        <span class="tab-count">{data.reports.length}{data.cursor ? "+" : ""}</span>
      </button>
    </div>

    {#if activeTab === "sources"}
      <section class="section" role="tabpanel">
        <h2>Source IP Analysis</h2>
        <p class="scope-note">
          Aggregate reports show domain-level statistics only. The specific sender
          address, subject, and recipients are not included in this report type.
        </p>
        {#if data.aggregate.sourceIpBreakdown.length === 0}
          <p class="empty">No source IPs found{data.dateFilter ? " for this date" : ""}.</p>
        {:else}
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
                    <span class="verdict verdict-{row.verdict}">{verdictLabel(row.verdict)}</span>
                  </td>
                  <td class="num">{row.count.toLocaleString()}</td>
                  <td class="num pass">{row.spfPass.toLocaleString()}</td>
                  <td class="num fail">{row.spfFail > 0 ? row.spfFail.toLocaleString() : "—"}</td>
                  <td class="num pass">{row.dkimPass.toLocaleString()}</td>
                  <td class="num fail">{row.dkimFail > 0 ? row.dkimFail.toLocaleString() : "—"}</td>
                  <td>
                    {#each row.dispositions as disposition}
                      <code class="disposition disposition-{disposition}">{disposition}</code>
                    {/each}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>
    {:else if activeTab === "authorized"}
      <section class="section" role="tabpanel">
        <h2>Authorized Senders</h2>
        <p class="scope-note">
          Source IPs whose mail passed DMARC (SPF or DKIM aligned to your domain). These are
          your legitimate senders — if a sender you recognize is missing here, your SPF/DKIM DNS
          records may need updating.
        </p>
        {#if data.aggregate.senderAlignment.length === 0}
          <p class="empty">No aligned senders found{data.dateFilter ? " for this date" : ""}.</p>
        {:else}
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
                  <td>{row.spfAligned ? "✓" : "—"}</td>
                  <td>{row.dkimAligned ? "✓" : "—"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>
    {:else}
      <section class="section" role="tabpanel">
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

          {#if data.cursor}
            <p class="load-more">
              <a href="?cursor={data.cursor}">Load more &rarr;</a>
            </p>
          {/if}
        {/if}
      </section>
    {/if}
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

  .summary-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .content-with-calendar {
    display: flex;
    gap: 2rem;
    align-items: flex-start;
  }

  .main-content {
    flex: 1;
    min-width: 0;
  }

  .sidebar {
    flex-shrink: 0;
  }

  .section {
    margin-bottom: 2.5rem;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--border, #e2e8f0);
    margin-bottom: 1.5rem;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    padding: 0.5rem 0.9rem;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-2, #64748b);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    cursor: pointer;
  }

  .tab:hover {
    color: var(--text-1, #1a202c);
  }

  .tab.active {
    color: #2563eb;
    border-bottom-color: #2563eb;
  }

  .tab-count {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-3, #94a3b8);
    background: var(--surface-1, #f1f5f9);
    border-radius: 999px;
    padding: 0.05rem 0.4rem;
  }

  .tab.active .tab-count {
    color: #2563eb;
    background: rgba(37, 99, 235, 0.1);
  }

  .empty {
    color: var(--text-2, #64748b);
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
    color: var(--text-3, #94a3b8);
    margin-top: 0.15rem;
  }

  .auth-detail {
    display: flex;
    gap: 0.5rem;
  }

  .origin {
    font-size: 0.8rem;
    color: var(--text-2, #64748b);
  }

  .scope-note {
    font-size: 0.8rem;
    color: var(--text-2, #64748b);
    margin: -0.25rem 0 0.75rem;
    max-width: 60ch;
  }

  .verdict {
    display: inline-block;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    white-space: nowrap;
  }

  .verdict-legitimate {
    background: var(--color-pass-bg, #dcfce7);
    color: var(--color-pass, #166534);
  }

  .verdict-forwarded {
    background: var(--surface-1, #f1f5f9);
    color: var(--text-2, #64748b);
  }

  .verdict-suspicious {
    background: var(--color-warn-bg, #fef9c3);
    color: var(--color-warn, #854d0e);
  }

  .verdict-spoofing {
    background: var(--color-fail-bg, #fee2e2);
    color: var(--color-fail, #991b1b);
  }

  .pass {
    color: var(--color-pass, #166534);
  }

  .fail {
    color: var(--color-fail, #991b1b);
  }

  .row-warn td {
    background: var(--color-warn-bg, #fef9c3);
  }

  .row-fail td {
    background: var(--color-fail-bg, #fee2e2);
  }

  .disposition {
    font-size: 0.75rem;
    padding: 0.1rem 0.35rem;
    border-radius: 0.2rem;
    background: var(--surface-1, #f8f9fa);
  }

  .disposition-quarantine {
    background: var(--color-warn-bg, #fef9c3);
    color: var(--color-warn, #854d0e);
  }

  .disposition-reject {
    background: var(--color-fail-bg, #fee2e2);
    color: var(--color-fail, #991b1b);
  }

  .date {
    white-space: nowrap;
  }

  .date-filter-label {
    font-size: 0.875rem;
    font-weight: 400;
    color: var(--text-2, #64748b);
  }

  .clear-filter {
    font-size: 0.8rem;
    margin-left: 0.5rem;
  }

  code {
    font-size: 0.8rem;
    padding: 0.1rem 0.4rem;
    background: var(--surface-1, #f8f9fa);
    border-radius: 0.25rem;
  }

  .load-more {
    margin-top: 1rem;
    font-size: 0.875rem;
  }

  @media (max-width: 900px) {
    .content-with-calendar {
      flex-direction: column-reverse;
    }
  }
</style>
