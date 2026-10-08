<script lang="ts">
  import { inviteUser, listAvailableDomains } from "#lib/remote/users.remote.js";
</script>

<h1>Invite User</h1>

{#each inviteUser.fields.allIssues() ?? [] as issue (issue.message)}
  <p class="error">{issue.message}</p>
{/each}

<svelte:boundary>
  {#snippet pending()}
    <p>Loading…</p>
  {/snippet}

  {@const data = await listAvailableDomains()}

  <form {...inviteUser}>
    <label>
      Email address
      <input {...inviteUser.fields.email.as("email")} required disabled={inviteUser.pending > 0} />
    </label>

    <fieldset>
      <legend>Domains</legend>
      {#if data.availableDomains.length === 0}
        <p>No domains available yet. Domains appear after DMARC reports are received.</p>
      {:else}
        {#each data.availableDomains as domain (domain)}
          <label>
            <input {...inviteUser.fields.domains.as("checkbox", domain)} />
            {domain}
          </label>
        {/each}
      {/if}
    </fieldset>

    <button type="submit" class="button primary" disabled={inviteUser.pending > 0}>
      {inviteUser.pending > 0 ? "Inviting..." : "Invite user"}
    </button>
  </form>
</svelte:boundary>

<p><a href="/users">Back to users</a></p>
