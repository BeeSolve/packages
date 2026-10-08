<script lang="ts">
  import { completeSetup } from "#lib/remote/setup.remote.js";

  const issues = $derived(completeSetup.fields.allIssues());
</script>

<h1>Setup</h1>

<p>Welcome! Create your admin account to get started.</p>

{#if issues != null}
  {#each issues as issue (issue.message)}
    <p class="error">{issue.message}</p>
  {/each}
{/if}

<form {...completeSetup}>
  <label>
    Admin email address
    <input {...completeSetup.fields.email.as("email")} required disabled={completeSetup.pending > 0} />
  </label>
  <button type="submit" class="button primary" disabled={completeSetup.pending > 0}>
    {completeSetup.pending > 0 ? "Setting up..." : "Create admin account"}
  </button>
</form>

<p>This is a one-time setup. After creating your admin account, you'll be redirected to sign in.</p>
