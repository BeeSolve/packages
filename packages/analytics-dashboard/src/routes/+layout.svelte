<script lang="ts">
  import "@drop-in/graffiti";
  import ThemeSwitcher from "#lib/components/themeSwitcher.svelte";

  let { data, children } = $props();
</script>

<div class="app">
  <header class="app-header">
    <nav class="nav">
      <a href="/" class="nav-brand">Analytics Dashboard</a>
      <div class="nav-links">
        {#if data.user != null}
          <a href="/" class="nav-link">Overview</a>
          <a href="/breakdowns/path" class="nav-link">Breakdowns</a>
          {#if data.user.type === "admin"}
            <a href="/users" class="nav-link">Users</a>
          {/if}
        {/if}
      </div>
      <div class="nav-actions">
        <ThemeSwitcher />
        {#if data.user != null}
          <form method="POST" action="/auth/signOut" class="nav-sign-out">
            <input type="hidden" name="redirectTo" value="/sign-in" />
            <button type="submit" class="button minimal">Sign out</button>
          </form>
        {/if}
      </div>
    </nav>
  </header>

  <main class="app-main">
    {@render children()}
  </main>
</div>

<style>
  /* Graffiti supplies the element resets (button, input, table, fieldset, a,
     body) and design tokens; app styles reference graffiti tokens directly.
     Only genuine gaps remain below. */

  :global(form > button[type="submit"]) {
    margin-block-start: var(--vs-base);
  }

  :global(code) {
    font-size: 0.8rem;
    padding: 0.1rem 0.4rem;
    background: var(--fg-05);
    border-radius: var(--br-s);
  }

  :global(.error) {
    color: var(--error);
    background: color-mix(in oklab, var(--error) 12%, var(--bg));
    padding: var(--pad-s) var(--pad-m);
    border-radius: var(--br-m);
    font-size: 0.875rem;
  }

  :global(a:visited) {
    color: var(--primary);
  }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .app-header {
    border-bottom: var(--border-1);
    padding: 0 var(--pad-m);
  }

  .nav {
    display: flex;
    align-items: center;
    gap: var(--vs-l);
    height: 3.5rem;
    max-width: 72rem;
    margin: 0 auto;
    width: 100%;
  }

  .nav-brand {
    font-weight: var(--fw-bold);
    font-size: 1rem;
    color: var(--fg);
    text-decoration: none;
  }

  .nav-brand:hover {
    text-decoration: none;
  }

  .nav-links {
    display: flex;
    gap: var(--vs-base);
  }

  .nav-link {
    font-size: 0.875rem;
    color: var(--fg-7);
    text-decoration: none;
  }

  .nav-link:hover {
    color: var(--fg);
    text-decoration: none;
  }

  .nav-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--vs-base);
  }

  .nav-sign-out {
    display: flex;
    align-items: center;
  }

  .nav-sign-out button[type="submit"] {
    margin-block-start: 0;
  }

  .app-main {
    flex: 1;
    max-width: 72rem;
    margin: 0 auto;
    padding: var(--vs-l) var(--pad-m);
    width: 100%;
    min-width: 0;
  }

  @media (max-width: 40rem) {
    .nav {
      height: auto;
      flex-wrap: wrap;
      gap: var(--vs-s) var(--vs-base);
      padding-block: var(--vs-s);
    }

    .nav-brand {
      flex: 1 1 auto;
    }

    .nav-links {
      order: 3;
      flex-basis: 100%;
      gap: var(--vs-base);
    }

    .nav-actions {
      margin-left: 0;
    }
  }
</style>
