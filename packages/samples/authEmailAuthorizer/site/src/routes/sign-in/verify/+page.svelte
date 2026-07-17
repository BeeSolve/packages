<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import CodeInput from "$shared/components/codeInput.svelte";

  let error = $state("");
  let loading = $state(false);

  const token = $derived(page.url.searchParams.get("token"));

  $effect(() => {
    if (!token) goto("/sign-in");
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;

    const form = event.target as HTMLFormElement;
    const code = new FormData(form).get("code") as string;

    const response = await fetch("/auth/signInComplete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, code }),
      credentials: "include",
    });

    if (!response.ok) {
      loading = false;
      const data = await response.json();
      if (data.type === "forbidden") {
        error = "Invalid code. Please try again.";
      } else {
        error = "Something went wrong. Please try again.";
      }
      return;
    }

    goto("/");
  }
</script>

<svelte:document onsubmit={handleSubmit} />

<h1>Enter code</h1>

{#if error}
  <p class="error">{error}</p>
{/if}

<p>Check your email for a verification code.</p>

<CodeInput disabled={loading} />
