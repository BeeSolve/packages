<script lang="ts">
  import { enhance } from "$app/forms";
  import Calendar from "$lib/components/calendar.svelte";
  import StatusBadge from "$lib/components/statusBadge.svelte";
  import SummaryCard from "$lib/components/summaryCard.svelte";

  let { data, form } = $props();

  let submittingIntent = $state<null | "refresh-dns" | "refresh-ips">(null);

  const dkimFoundCount = $derived(
    (data.dns?.dkimSelectors ?? []).filter((selector) => selector.found).length,
  );

  function formatDateTime(iso: string | null | undefined): string {
    if (iso == null) return "—";
    return new Date(iso).toLocaleString();
  }

  const formResult = $derived.by(() => {
    if (form == null) return null;
    const intent = "intent" in form ? form.intent : null;
    const started = "started" in form ? form.started === true : false;
    const errorMessage = "error" in form && typeof form.error === "string" ? form.error : null;
    return { intent, started, errorMessage };
  });

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

<section class="setup-health">
  <div class="setup-head">
    <h2>Setup health</h2>
    <div class="dns-summary">
      {#if data.dns == null}
        <span class="dns-note">DNS not checked yet</span>
      {:else}
        <span class="dns-metric">DMARC <code>p={data.dns.dmarc?.policy ?? "—"}</code></span>
        {#if data.dns.dmarc?.pct != null}
          <span class="dns-metric">pct <code>{data.dns.dmarc.pct}</code></span>
        {/if}
        <span class="dns-metric">SPF <code>{data.dns.spf?.all ?? "—"}</code></span>
        <span class="dns-metric">DKIM <code>{dkimFoundCount}</code> found</span>
        <span class="dns-checked">Last checked {formatDateTime(data.dns.fetchedAt)}</span>
      {/if}
    </div>
    <div class="dns-refresh">
      <form
        method="POST"
        use:enhance={() => {
          submittingIntent = "refresh-dns";
          return async ({ update }) => {
            await update();
            submittingIntent = null;
          };
        }}
      >
        <input type="hidden" name="intent" value="refresh-dns" />
        <button
          type="submit"
          class="button mini ghost refresh-btn"
          disabled={!data.dnsRefreshStatus.canRun || submittingIntent === "refresh-dns"}
          title="Re-read this domain's SPF, DMARC and DKIM DNS records so the setup findings reflect the current published configuration."
        >
          {submittingIntent === "refresh-dns" ? "Refreshing…" : "Refresh DNS"}
        </button>
      </form>
      {#if data.dnsRefreshStatus.lastRun != null}
        <span class="last-run">
          {#if data.dnsRefreshStatus.lastRun.status === "started" || data.dnsRefreshStatus.lastRun.status === "pending"}
            In progress…
          {:else if data.dnsRefreshStatus.lastRun.status === "finished"}
            Updated{#if data.dnsRefreshStatus.lastRun.selectorsChecked != null}
              · {data.dnsRefreshStatus.lastRun.selectorsChecked.toLocaleString()} selectors{/if}{#if data.dnsRefreshStatus.lastRun.finishedAt != null}
              · {new Date(data.dnsRefreshStatus.lastRun.finishedAt).toLocaleDateString()}{/if}
          {:else if data.dnsRefreshStatus.lastRun.status === "failed"}
            Last refresh failed
          {/if}
        </span>
      {/if}
    </div>
  </div>

  {#if formResult?.intent === "refresh-dns" && formResult.started}
    <div class="callout fill notice">
      Refreshing DNS for {data.domain}. This runs in the background.
    </div>
  {/if}
  {#if formResult?.intent === "refresh-dns" && formResult.errorMessage != null}
    <p class="error">{formResult.errorMessage}</p>
  {/if}

  {#if data.advisory.length === 0}
    <p class="advisory-ok">No setup issues detected.</p>
  {:else}
    <ul class="advisory-list">
      {#each data.advisory as finding (finding.id)}
        <li class="advisory-row severity-{finding.severity}">
          <span class="tag advisory-chip">{finding.severity}</span>
          <span class="advisory-text">
            <strong>{finding.title}</strong>
            <span class="advisory-detail">{finding.detail}</span>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

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
        <div class="ip-refresh">
          <form
            method="POST"
            use:enhance={() => {
              submittingIntent = "refresh-ips";
              return async ({ update }) => {
                await update();
                submittingIntent = null;
              };
            }}
          >
            <input type="hidden" name="intent" value="refresh-ips" />
            <button
              type="submit"
              class="button mini ghost refresh-btn"
              disabled={!data.ipBackfillStatus.canRun || submittingIntent === "refresh-ips"}
              title="Look up the network operator (ASN / organisation) and country for this domain's source IPs, so the source IP table shows who is really sending."
            >
              {submittingIntent === "refresh-ips" ? "Refreshing…" : "Refresh IP details"}
            </button>
          </form>
          {#if data.ipBackfillStatus.lastRun != null}
            <span class="last-run">
              {#if data.ipBackfillStatus.lastRun.status === "started" || data.ipBackfillStatus.lastRun.status === "pending"}
                In progress…
              {:else if data.ipBackfillStatus.lastRun.status === "finished"}
                Updated{#if data.ipBackfillStatus.lastRun.ipsEnriched != null}
                  · {data.ipBackfillStatus.lastRun.ipsEnriched.toLocaleString()} IPs{/if}{#if data.ipBackfillStatus.lastRun.finishedAt != null}
                  · {new Date(data.ipBackfillStatus.lastRun.finishedAt).toLocaleDateString()}{/if}
              {:else if data.ipBackfillStatus.lastRun.status === "failed"}
                Last refresh failed
              {/if}
            </span>
          {/if}
        </div>
        {#if formResult?.intent === "refresh-ips" && formResult.started}
          <div class="callout fill notice">
            Refreshing IP details for {data.domain}. This runs in the background.
          </div>
        {/if}
        {#if formResult?.intent === "refresh-ips" && formResult.errorMessage != null}
          <p class="error">{formResult.errorMessage}</p>
        {/if}
        <p class="scope-note">
          Aggregate reports show domain-level statistics only. The specific sender
          address, subject, and recipients are not included in this report type.
        </p>
        <p class="hint">
          “Refresh IP details” looks up the network operator and country for each source IP so this
          Source IP table can show who is really sending mail for the domain.
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

  .error {
    color: var(--error);
    margin: 0 0 1rem;
  }

  .notice {
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }

  /* Gap: graffiti has no "panel with a header row of controls" layout, so the
     setup-health container and its head row are ours. Findings inside reuse
     graffiti .tag (severity chip) and .callout (background notice). */
  .setup-health {
    margin-bottom: var(--vs-l);
  }

  .setup-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--vs-s);
    margin-bottom: var(--vs-s);
  }

  .setup-head h2 {
    margin: 0;
  }

  .dns-summary {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.75rem;
    font-size: 0.85rem;
    color: var(--fg-7);
  }

  .dns-metric code {
    font-size: 0.8rem;
  }

  .dns-note,
  .dns-checked {
    color: var(--fg-5);
  }

  .dns-refresh {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
    margin-inline-start: auto;
  }

  .dns-refresh form,
  .ip-refresh form {
    display: inline;
  }

  .dns-refresh button[type="submit"],
  .ip-refresh button[type="submit"] {
    margin-block-start: 0;
  }

  .advisory-ok {
    color: var(--success);
    font-size: 0.9rem;
    margin: 0;
  }

  .advisory-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .advisory-row {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    font-size: 0.85rem;
  }

  .advisory-chip {
    --tag-color: var(--fg-5);
    text-transform: uppercase;
    font-size: 0.65rem;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }

  /* Severity hue only — the chip pill itself is graffiti .tag. */
  .severity-ok .advisory-chip {
    --tag-color: var(--success);
  }

  .severity-info .advisory-chip {
    --tag-color: var(--gray, var(--fg-5));
  }

  .severity-warning .advisory-chip {
    --tag-color: var(--warning);
  }

  .severity-critical .advisory-chip {
    --tag-color: var(--error);
  }

  .advisory-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .advisory-detail {
    color: var(--fg-7);
    max-width: 80ch;
  }

  .ip-refresh {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
    margin-bottom: var(--vs-s);
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
    margin: -0.25rem 0 0.75rem;
    font-size: 0.85rem;
    color: var(--fg-5);
    max-width: 60ch;
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
