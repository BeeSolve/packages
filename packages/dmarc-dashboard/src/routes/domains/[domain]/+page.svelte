<script lang="ts">
  let { data } = $props();

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString();
  }
</script>

<h1>Reports for {data.domain}</h1>

<p><a href="/">&larr; Back to domains</a></p>

{#if data.reports.length === 0}
  <p>No reports found for this domain.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Organization</th>
        <th>Messages</th>
        <th>Pass</th>
        <th>Fail</th>
        <th>Policy</th>
      </tr>
    </thead>
    <tbody>
      {#each data.reports as report}
        <tr>
          <td>{formatDate(report.dateRangeBegin)}</td>
          <td>{report.orgName}</td>
          <td>{report.totalMessages}</td>
          <td>{report.totalPass}</td>
          <td>{report.totalFail}</td>
          <td>{report.policy}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if data.cursor}
    <a href="?cursor={data.cursor}">Load more</a>
  {/if}
{/if}
