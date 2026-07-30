<script lang="ts">
  import { goto } from "$app/navigation";
  import EmailForm from "$shared/components/emailForm.svelte";
  import { AuthError, signInRequest } from "$shared/utils/authClient";

  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;

    const form = event.target as HTMLFormElement;
    const email = new FormData(form).get("email");
        if (typeof email !== "string") return;

    try {
      const data = await signInRequest(email);
      const params = new URLSearchParams({
        token: data.token,
        ...(data.referenceCode != null && { referenceCode: data.referenceCode }),
        ...(data.canResendAt != null && { canResendAt: data.canResendAt }),
      });
      goto(`/sign-in/verify?${params}`);
    } catch (e) {
      loading = false;
      error = "Something went wrong. Please try again.";
    }
  }
</script>

<svelte:document onsubmit={handleSubmit} />

<h1>Sign in</h1>

{#if error}
  <p class="error">{error}</p>
{/if}

<EmailForm label="Email address" buttonText="Send code" disabled={loading} />

<p>Enter your email to receive a sign-in code.</p>
