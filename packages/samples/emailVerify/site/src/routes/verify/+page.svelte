<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import { createCooldown } from "$shared/utils/cooldown.svelte";

  let { form } = $props();

  let token = $derived(form?.token ?? page.url.searchParams.get("token") ?? "");
  let referenceCode = $derived(form?.referenceCode ?? page.url.searchParams.get("referenceCode") ?? "");
  let canResendAt = $derived(form?.canResendAt ?? page.url.searchParams.get("canResendAt") ?? null);

  const cooldown = createCooldown(() => canResendAt);
</script>

<h1>Enter code</h1>

{#if form?.error}
  <p class="error">{form.error}</p>
{/if}

<p>Check your email for a verification code.</p>

{#if referenceCode}
  <p class="reference">Reference: <strong>{referenceCode}</strong></p>
{/if}

<form method="POST" use:enhance>
  <input type="hidden" name="intent" value="verify" />
  <input type="hidden" name="token" value={token} />
  <label>
    Code
    <input type="text" name="code" required minlength={6} maxlength={6} inputmode="numeric" autocomplete="one-time-code" />
  </label>
  <button type="submit">Verify</button>
</form>

<form method="POST" use:enhance>
  <input type="hidden" name="intent" value="resend" />
  <input type="hidden" name="token" value={token} />
  <button type="submit" disabled={cooldown.active}>
    {#if cooldown.active}
      Resend ({cooldown.remaining}s)
    {:else}
      Resend code
    {/if}
  </button>
</form>
