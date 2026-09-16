<script lang="ts">
  import { goto } from "$app/navigation";
  import EmailForm from "$shared/components/emailForm.svelte";
  import { signInRequest } from "$shared/utils/authClient";

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
      goto(`/sign-in/verify?token=${data.token}`);
    } catch {
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
