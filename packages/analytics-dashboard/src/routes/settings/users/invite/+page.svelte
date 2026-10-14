<script lang="ts">
  import { inviteUser } from "#lib/remote/users.remote.js";
</script>

<h1>Invite User</h1>

{#each inviteUser.fields.allIssues() ?? [] as issue (issue.message)}
  <p class="error">{issue.message}</p>
{/each}

<form {...inviteUser}>
  <label>
    Email address
    <input {...inviteUser.fields.email.as("email")} required disabled={inviteUser.pending > 0} />
  </label>

  <button type="submit" class="button primary" disabled={inviteUser.pending > 0}>
    {inviteUser.pending > 0 ? "Inviting..." : "Invite user"}
  </button>
</form>

<p><a href="/settings">Back to settings</a></p>
