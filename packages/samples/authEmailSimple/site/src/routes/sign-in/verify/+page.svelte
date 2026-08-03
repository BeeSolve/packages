<script lang="ts">
  import CodeInput from "$shared/components/codeInput.svelte";
  import { AuthError, signInComplete } from "$shared/utils/authClient";

  let { data } = $props();

  let error = $state("");
  let loading = $state(false);

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
      await signInComplete(data.token, code);
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

<CodeInput disabled={loading} />
