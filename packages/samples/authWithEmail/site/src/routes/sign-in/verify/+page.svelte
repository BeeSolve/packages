<script lang="ts">
  import CodeInput from "$shared/components/codeInput.svelte";
  import { AuthError, resendCode, signInComplete } from "$shared/utils/authClient";
  import { createCooldown } from "$shared/utils/cooldown.svelte";

  let { data } = $props();

  let error = $state("");
  let loading = $state(false);
  let resending = $state(false);

  let override: { token: string; referenceCode: string; canResendAt: string } | null =
    $state(null);

  let token = $derived(override?.token ?? data.token);
  let referenceCode = $derived(override?.referenceCode ?? data.referenceCode);
  let canResendAt = $derived(override?.canResendAt ?? data.canResendAt);

  const cooldown = createCooldown(() => canResendAt);
  let resendDisabled = $derived(cooldown.active || resending);

  async function handleResend() {
    resending = true;
    error = "";

    try {
      const result = await resendCode(token);
      override = {
        token: result.token,
        referenceCode: result.referenceCode,
        canResendAt: result.canResendAt,
      };
    } catch (e) {
      if (e instanceof AuthError && e.status === 429) {
        error = "Please wait before requesting another code.";
      } else {
        error = "Failed to resend code. Please try again.";
      }
    } finally {
      resending = false;
    }
  }

  let submitted = false;

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitted) return;
    submitted = true;
    error = "";
    loading = true;

    const form = event.target as HTMLFormElement;
    const code = new FormData(form).get("code");
        if (typeof code !== "string") return;

    try {
      await signInComplete(token, code);
    } catch (e) {
      submitted = false;
      loading = false;
      if (e instanceof AuthError && e.type === "forbidden") {
        error = "Invalid code. Please try again.";
      } else {
        error = "Something went wrong. Please try again.";
      }
    }
  }
</script>

<svelte:document onsubmit={handleSubmit} />

<h1>Enter code</h1>

{#if error}
  <p class="error">{error}</p>
{/if}

<p>Check your email for a verification code.</p>

{#if referenceCode}
  <p class="reference">Reference: <strong>{referenceCode}</strong></p>
{/if}

<CodeInput disabled={loading} />

<div class="resend">
  <button
    type="button"
    onclick={handleResend}
    disabled={resendDisabled}
  >
    {#if resending}
      Resending…
    {:else if cooldown.active}
      Resend ({cooldown.remaining}s)
    {:else}
      Resend code
    {/if}
  </button>
</div>
