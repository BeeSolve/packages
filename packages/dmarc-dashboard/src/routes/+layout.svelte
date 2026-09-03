<script lang="ts">
  import "@drop-in/graffiti";
  import ThemeSwitcher from "$lib/components/themeSwitcher.svelte";

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
      <div class="nav-actions">
        <ThemeSwitcher />
        {#if data.user}
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

  /* Gap: browsers apply their default :visited purple to content links that
     graffiti colours only via `a`. Pin visited links to the same colour so
     tables and drill-down links stay consistent. */
  :global(a:visited) {
    color: var(--primary);
  }

  /* Gap: the app's data tables are bare <table> elements (not graffiti's
     `.table` wrapper). On narrow screens their many columns push the page
     wider than the viewport, causing the whole layout to scroll sideways.
     This shared wrapper confines horizontal overflow to the table itself,
     matching graffiti's own `.table { overflow-x: auto }` pattern. */
  :global(.table-scroll) {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    max-width: 100%;
  }

  /* Keep table content from collapsing awkwardly narrow while scrolling. */
  :global(.table-scroll > table) {
    min-width: max-content;
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

  /* The global `form > button[type=submit]` top-margin (for stacked forms)
     would push the nav sign-out button below the other nav items; reset it. */
  .nav-sign-out button[type="submit"] {
    margin-block-start: 0;
  }

  .app-main {
    flex: 1;
    max-width: 72rem;
    margin: 0 auto;
    padding: var(--vs-l) var(--pad-m);
    width: 100%;
    /* Guard: never let a child force the page wider than the viewport. */
    min-width: 0;
  }

  /* Responsive nav: on narrow screens let the nav wrap onto multiple lines
     and tighten spacing so the brand, links, and actions all stay reachable
     instead of overflowing the header. */
  @media (max-width: 40rem) {
    .nav {
      height: auto;
      flex-wrap: wrap;
      gap: var(--vs-s) var(--vs-base);
      padding-block: var(--vs-s);
    }

    .nav-brand {
      /* Brand takes the first row; actions sit beside it via margin-left. */
      flex: 1 1 auto;
    }

    .nav-links {
      /* Links drop to their own full-width row below the brand. */
      order: 3;
      flex-basis: 100%;
      gap: var(--vs-base);
    }

    .nav-actions {
      margin-left: 0;
    }
  }
</style>
