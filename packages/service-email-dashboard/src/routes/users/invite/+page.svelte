<script lang="ts">
  import { enhance } from "$app/forms";

  let { form } = $props();
  let loading = $state(false);
</script>

<h1>Invite User</h1>

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
    Email address
    <input type="email" name="email" required disabled={loading} />
  </label>

  <button type="submit" class="button primary" disabled={loading}>
    {loading ? "Inviting..." : "Invite user"}
  </button>
</form>

<p><a href="/users">Back to users</a></p>
