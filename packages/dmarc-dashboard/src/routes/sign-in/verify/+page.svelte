<script lang="ts">
  let { data } = $props();

  let code = $state("");
  let error = $state("");
  let loading = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;

    try {
      const response = await fetch("/auth/signInComplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ token: data.token, code }),
      });

      if (!response.ok) {
        throw new Error(response.status === 403 ? "forbidden" : "unknown");
      }

      const result = await response.json();
      window.location.href = result.redirectTo ?? "/";
    } catch (e) {
      loading = false;
      if (e instanceof Error && e.message === "forbidden") {
        error = "Invalid code. Please try again.";
      } else {
        error = "Something went wrong. Please try again.";
      }
    }
  }
</script>

<h1>Enter code</h1>

{#if error}
  <p class="error">{error}</p>
{/if}

<p>Check your email for a verification code.</p>

<form onsubmit={handleSubmit}>
  <label>
    Verification code
    <input type="text" bind:value={code} required disabled={loading} autocomplete="one-time-code" inputmode="numeric" maxlength="6" />
  </label>
  <button type="submit" disabled={loading}>
    {loading ? "Verifying..." : "Verify"}
  </button>
</form>
