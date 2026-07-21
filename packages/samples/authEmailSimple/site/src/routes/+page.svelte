<script lang="ts">
  import { goto } from "$app/navigation";
  import { signOut } from "$shared/utils/authClient";

  let { data } = $props();

  async function handleSignOut() {
    await signOut();
    goto("/sign-in");
  }
</script>

<h1>Dashboard</h1>
<p>You are signed in. Session: {data.sessionId}</p>
<button onclick={handleSignOut}>Sign out</button>
