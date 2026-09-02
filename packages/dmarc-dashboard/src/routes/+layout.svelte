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
      {#if data.user}
        <form method="POST" action="/auth/signOut" class="nav-sign-out">
          <input type="hidden" name="redirectTo" value="/sign-in" />
          <button type="submit" class="button minimal">Sign out</button>
        </form>
      {/if}
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

  /* Gap: graffiti buttons have no top margin, so a submit button placed
     directly after form fields sits flush. Restore breathing room for the
     app's simple stacked forms. */
  :global(form > button[type="submit"]) {
    margin-block-start: var(--vs-base);
  }

  /* Gap: graffiti sets code font but no inline chip background, so we add a
     token-based inline code style used across tables and metadata. */
  :global(code) {
    font-size: 0.8rem;
    padding: 0.1rem 0.4rem;
    background: var(--fg-05);
    border-radius: var(--br-s);
  }

  /* Gap: graffiti's .error is contextual (.callout.error, form validation),
     not a standalone message paragraph, so we keep one token-based rule for
     the inline form error text used across routes. */
  :global(.error) {
    color: var(--error);
    background: color-mix(in oklab, var(--error) 12%, var(--bg));
    padding: var(--pad-s) var(--pad-m);
    border-radius: var(--br-m);
    font-size: 0.875rem;
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

  .nav-sign-out {
    margin-left: auto;
  }

  .app-main {
    flex: 1;
    max-width: 72rem;
    margin: 0 auto;
    padding: var(--vs-l) var(--pad-m);
    width: 100%;
  }
</style>
