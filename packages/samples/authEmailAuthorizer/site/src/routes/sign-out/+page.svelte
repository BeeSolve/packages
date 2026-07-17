<script lang="ts">
  import { goto } from "$app/navigation";

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();

    await fetch("/auth/signOut", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
      redirect: "manual",
    });

    goto("/sign-in");
  }
</script>

<svelte:document onsubmit={handleSubmit} />

<form method="POST">
  <button type="submit">Signing out…</button>
</form>
