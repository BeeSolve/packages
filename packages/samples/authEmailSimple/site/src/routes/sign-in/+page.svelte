<script lang="ts">
  import { goto } from "$app/navigation";
  import EmailForm from "$shared/components/emailForm.svelte";

  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;

    const form = event.target as HTMLFormElement;
    const email = new FormData(form).get("email") as string;

    console.log({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emailAddress: email }),
    });

    const response = await fetch("/auth/signInRequest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emailAddress: email }),
    });

    if (!response.ok) {
      alert(await response.text())
      loading = false;
      error = "Something went wrong. Please try again.";
      return;
    }

    const data = await response.json();
    goto(`/sign-in/verify?token=${data.token}`);
  }
</script>

<svelte:document onsubmit={handleSubmit} />

<h1>Sign in</h1>

{#if error}
  <p class="error">{error}</p>
{/if}

<EmailForm label="Email address" buttonText="Send code" disabled={loading} />

<p>Enter your email to receive a sign-in code.</p>
