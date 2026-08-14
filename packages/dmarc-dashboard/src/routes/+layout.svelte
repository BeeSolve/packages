<script lang="ts">
  import "@drop-in/graffiti";

  let { data, children } = $props();
</script>

<header>
  <nav>
    <a href="/">DMARC Dashboard</a>
    {#if data.user?.type === "admin"}
      <a href="/users">Users</a>
    {/if}
  </nav>
</header>

<main>
  {@render children()}
</main>
