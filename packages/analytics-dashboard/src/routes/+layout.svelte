<script lang="ts">
  import { page } from "$app/state";
  import "@drop-in/graffiti";
  import DataNotes from "#lib/components/dataNotes.svelte";
  import ThemeSwitcher from "#lib/components/themeSwitcher.svelte";
  import VersionFooter from "#lib/components/versionFooter.svelte";

  let { data, children } = $props();

  interface NavLink {
    readonly href: string;
    readonly label: string;
    readonly adminOnly?: boolean;
  }

  const navLinks: Array<NavLink> = [
    { href: "/", label: "Overview" },
    { href: "/breakdowns/status", label: "Breakdowns" },
    { href: "/urls", label: "URLs" },
    { href: "/watch", label: "Watchlist" },
    { href: "/settings", label: "Settings", adminOnly: true },
  ];

  function sectionOf(href: string): string {
    const [, first = ""] = href.split("/");
    return first;
  }

  function isActive(href: string, pathname: string): boolean {
    if (href === "/") return pathname === "/";
    return sectionOf(pathname) === sectionOf(href);
  }

  const visibleLinks = $derived(
    navLinks.filter((link) => !link.adminOnly || data.user?.type === "admin"),
  );
</script>

<div class="app">
  <header class="app-header">
    <nav class="nav">
      <a href="/" class="nav-brand">Analytics Dashboard</a>
      <div class="nav-links">
        {#if data.user != null}
          {#each visibleLinks as link (link.href)}
            {@const active = isActive(link.href, page.url.pathname)}
            <a
              href={link.href}
              class="nav-link"
              class:active
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </a>
          {/each}
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
    {#if data.user != null}
      <DataNotes
        processingLagHours={data.processingLagHours}
        hourlyRetentionDays={data.hourlyRetentionDays}
      />
    {/if}
  </main>

  <VersionFooter />
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
    gap: var(--vs-xs, 0.25rem);
  }

  .nav-link {
    font-size: 0.875rem;
    color: var(--fg-7);
    text-decoration: none;
    padding: var(--vs-xs, 0.3rem) var(--pad-s);
    border-radius: var(--br-m);
    transition:
      background var(--d-base, 0.15s) ease,
      color var(--d-base, 0.15s) ease;
  }

  .nav-link:hover {
    color: var(--fg);
    text-decoration: none;
    background: var(--fg-05);
  }

  .nav-link.active,
  .nav-link.active:visited {
    color: var(--white);
    font-weight: var(--fw-medium);
    background: var(--primary);
  }

  .nav-link.active:hover {
    color: var(--white);
    background: var(--primary-opaque-6);
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
