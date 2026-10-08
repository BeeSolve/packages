<script lang="ts">
  import { inviteUser } from "#lib/remote/users.remote.js";

  const issues = $derived(inviteUser.fields.allIssues());
</script>

<h1>Invite User</h1>

{#if issues != null}
  {#each issues as issue (issue.message)}
    <p class="error">{issue.message}</p>
  {/each}
{/if}

<form {...inviteUser}>
  <label>
    Email address
    <input {...inviteUser.fields.email.as("email")} required disabled={inviteUser.pending > 0} />
  </label>

  <button type="submit" class="button primary" disabled={inviteUser.pending > 0}>
    {inviteUser.pending > 0 ? "Inviting..." : "Invite user"}
  </button>
</form>

<p><a href="/users">Back to users</a></p>
