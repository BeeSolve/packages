<script lang="ts">
  import Calendar from "$lib/components/calendar.svelte";
  import StatusBadge from "$lib/components/statusBadge.svelte";
  import SummaryCard from "$lib/components/summaryCard.svelte";

  let { data } = $props();

  const passRate = $derived(
    data.aggregate.totalMessages > 0
      ? Math.round((data.aggregate.totalPass / data.aggregate.totalMessages) * 100)
      : 0,
  );

  const currentMonth = $derived(() => {
    if (data.dateFilter != null) {
      return data.dateFilter.slice(0, 7);
    }
    const now = new Date();
    return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

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

<div class="summary-cards">
  <SummaryCard label="Total Messages" value={data.aggregate.totalMessages.toLocaleString()} />
  <SummaryCard label="Pass Rate" value="{passRate}%" />
  <SummaryCard label="Unique IPs" value={data.aggregate.uniqueIps} />
  <SummaryCard label="Reports" value={data.aggregate.reportCount} />
  <SummaryCard label="SPF Pass Rate" value="{data.aggregate.spfPassRate}%" />
  <SummaryCard label="DKIM Pass Rate" value="{data.aggregate.dkimPassRate}%" />
</div>

<div class="content-with-calendar">
  <div class="main-content">
    {#if data.aggregate.sourceIpBreakdown.length > 0}
      <section class="section">
        <h2>Source IP Analysis</h2>
        <table>
          <thead>
            <tr>
              <th>Source IP</th>
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
              {@const hasAction = row.dispositions.some((d) => d !== "none")}
              <tr class:row-warn={hasFailure && !hasAction} class:row-fail={hasAction}>
                <td class="ip">{row.ip}</td>
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
      </section>
    {/if}

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
        <p>No reports found{data.dateFilter ? " for this date" : " for this domain"}.</p>
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
  </div>

  <aside class="sidebar">
    <Calendar
      currentMonth={currentMonth()}
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
    display: flex;
    flex-wrap: wrap;
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

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .ip {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.85rem;
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
