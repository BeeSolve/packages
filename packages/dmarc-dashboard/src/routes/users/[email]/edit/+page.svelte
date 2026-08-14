<script lang="ts">
  import { enhance } from "$app/forms";

  let { data, form } = $props();
  let loading = $state(false);
</script>

<h1>Edit User</h1>

<p>Editing domain access for <strong>{data.targetUser.email}</strong></p>

{#if form?.error}
  <p class="error">{form.error}</p>
{/if}

<form
  method="POST"
  use:enhance={() => {
    loading = true;
    return async ({ update }) => {
      loading = false;
      await update();
    };
  }}
>
  <fieldset>
    <legend>Domains</legend>
    {#if data.availableDomains.length === 0}
      <p>No domains available yet. Domains appear after DMARC reports are received.</p>
    {:else}
      {#each data.availableDomains as domain}
        <label>
          <input
            type="checkbox"
            name="domains"
            value={domain}
            checked={data.targetUser.domains.includes(domain)}
          />
          {domain}
        </label>
      {/each}
    {/if}
  </fieldset>

  <button type="submit" disabled={loading}>
    {loading ? "Saving..." : "Save changes"}
  </button>
</form>

<p><a href="/users">Back to users</a></p>
