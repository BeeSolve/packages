<script lang="ts">
  import { enhance } from "$app/forms";

  let { form } = $props();
  let loading = $state(false);
</script>

<h1>Setup</h1>

<p>Welcome! Create your admin account to get started.</p>

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
    Admin email address
    <input type="email" name="email" required disabled={loading} />
  </label>
  <button type="submit" class="button primary" disabled={loading}>
    {loading ? "Setting up..." : "Create admin account"}
  </button>
</form>

<p>This is a one-time setup. After creating your admin account, you'll be redirected to sign in.</p>
