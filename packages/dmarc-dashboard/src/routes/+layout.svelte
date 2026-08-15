<script lang="ts">
  import "@drop-in/graffiti";

  let { data, children } = $props();
</script>

<div class="app">
  <header class="app-header">
    <nav class="nav">
      <a href="/" class="nav-brand">DMARC Dashboard</a>
      <div class="nav-links">
        <a href="/" class="nav-link">Domains</a>
        {#if data.user?.type === "admin"}
          <a href="/stats" class="nav-link">Stats</a>
          <a href="/users" class="nav-link">Users</a>
        {/if}
      </div>
    </nav>
  </header>

  <main class="app-main">
    {@render children()}
  </main>
</div>

<style>
  :global(:root) {
    --color-pass: #166534;
    --color-pass-bg: #dcfce7;
    --color-warn: #854d0e;
    --color-warn-bg: #fef9c3;
    --color-fail: #991b1b;
    --color-fail-bg: #fee2e2;
    --surface-1: #f8f9fa;
    --border: #e2e8f0;
    --text-1: #1a202c;
    --text-2: #64748b;
    --text-3: #94a3b8;
  }

  :global(body) {
    margin: 0;
    font-family:
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      sans-serif;
    color: var(--text-1);
    background: #fff;
  }

  :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  :global(th) {
    text-align: left;
    padding: 0.6rem 0.75rem;
    border-bottom: 2px solid var(--border);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2);
  }

  :global(td) {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  :global(tr:hover td) {
    background: var(--surface-1);
  }

  :global(td:nth-child(n + 2):not(:last-child)) {
    font-variant-numeric: tabular-nums;
  }

  :global(a) {
    color: #2563eb;
    text-decoration: none;
  }

  :global(a:hover) {
    text-decoration: underline;
  }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .app-header {
    border-bottom: 1px solid var(--border);
    padding: 0 1.5rem;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: 2rem;
    height: 3.5rem;
    max-width: 72rem;
    margin: 0 auto;
    width: 100%;
  }

  .nav-brand {
    font-weight: 700;
    font-size: 1rem;
    color: var(--text-1);
    text-decoration: none;
  }

  .nav-brand:hover {
    text-decoration: none;
  }

  .nav-links {
    display: flex;
    gap: 1.25rem;
  }

  .nav-link {
    font-size: 0.875rem;
    color: var(--text-2);
    text-decoration: none;
  }

  .nav-link:hover {
    color: var(--text-1);
    text-decoration: none;
  }

  .app-main {
    flex: 1;
    max-width: 72rem;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    width: 100%;
  }
</style>
