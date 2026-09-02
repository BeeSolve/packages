<script lang="ts">
  let { data } = $props();

  let code = $state("");
  let error = $state("");
  let loading = $state(false);

  const expiryMinutes = $derived(() => {
    if (data.expiresAt == null) return undefined;
    const diffMs = Date.parse(data.expiresAt) - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / 60_000);
  });

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

{#if data.referenceCode}
  <p class="meta">Reference code: <code>{data.referenceCode}</code></p>
{/if}

{#if expiryMinutes() != null}
  <p class="meta">Code expires in {expiryMinutes()} {expiryMinutes() === 1 ? "minute" : "minutes"}.</p>
{/if}

<form onsubmit={handleSubmit}>
  <label>
    Verification code
    <input type="text" bind:value={code} required disabled={loading} autocomplete="one-time-code" inputmode="numeric" maxlength="6" />
  </label>
  <button type="submit" class="button primary" disabled={loading}>
    {loading ? "Verifying..." : "Verify"}
  </button>
</form>

<style>
  .meta {
    font-size: 0.85rem;
    color: var(--fg-7);
    margin: 0.25rem 0;
  }

  .meta code {
    font-weight: var(--fw-semibold);
  }
</style>
