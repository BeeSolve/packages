<script lang="ts">
  import { enhance } from "$app/forms";

  let { data, form } = $props();
  let loading = $state(false);
</script>

<h1>Edit User</h1>

<p>Editing <strong>{data.targetUser.email}</strong></p>

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
    <legend>Role</legend>
    {#each data.userTypes as userType}
      <label>
        <input
          type="radio"
          name="type"
          value={userType}
          checked={data.targetUser.type === userType}
        />
        {userType}
      </label>
    {/each}
  </fieldset>

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
    <p class="hint">Admins have access to all domains regardless of selection.</p>
  </fieldset>

  <button type="submit" class="button primary" disabled={loading}>
    {loading ? "Saving..." : "Save changes"}
  </button>
</form>

<p><a href="/users">Back to users</a></p>

<style>
  .hint {
    font-size: 0.8rem;
    color: var(--fg-5);
    margin-top: 0.5rem;
  }
</style>
