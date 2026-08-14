<script lang="ts">
  import { goto } from "$app/navigation";

  let email = $state("");
  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;

    try {
      const response = await fetch("/auth/signInRequest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ emailAddress: email }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = await response.json();
      goto(`/sign-in/verify?token=${data.token}`);
    } catch {
      loading = false;
      error = "Something went wrong. Please try again.";
    }
  }
</script>

<h1>Sign in</h1>

{#if error}
  <p class="error">{error}</p>
{/if}

<form onsubmit={handleSubmit}>
  <label>
    Email address
    <input type="email" bind:value={email} required disabled={loading} />
  </label>
  <button type="submit" disabled={loading}>
    {loading ? "Sending..." : "Send code"}
  </button>
</form>

<p>Enter your email to receive a sign-in code.</p>
