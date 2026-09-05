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
  <label>
    User type
    <select name="type" disabled={loading}>
      {#each data.userTypes as userType}
        <option value={userType} selected={data.targetUser.type === userType}>
          {userType}
        </option>
      {/each}
    </select>
  </label>

  <button type="submit" class="button primary" disabled={loading}>
    {loading ? "Saving..." : "Save changes"}
  </button>
</form>

<p><a href="/users">Back to users</a></p>
