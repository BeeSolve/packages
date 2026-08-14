<script lang="ts">
  let { data } = $props();
</script>

<h1>Domains</h1>

{#if data.domains.length === 0}
  <p>No domains found.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Domain</th>
        <th>Messages</th>
        <th>Pass</th>
        <th>Fail</th>
        <th>Pass Rate</th>
      </tr>
    </thead>
    <tbody>
      {#each data.domains as domain}
        <tr>
          <td><a href="/domains/{domain.domain}">{domain.domain}</a></td>
          <td>{domain.totalMessages}</td>
          <td>{domain.totalPass}</td>
          <td>{domain.totalFail}</td>
          <td>{domain.totalMessages > 0 ? Math.round((domain.totalPass / domain.totalMessages) * 100) : 0}%</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
