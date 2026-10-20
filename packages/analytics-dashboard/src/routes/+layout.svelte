<script lang="ts">
  import { page } from "$app/state";
  import "@drop-in/graffiti";
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

  /* Shared control-panel styling used by the analytics pages (Overview,
     Breakdowns, Watchlist). A labeled row of chip groups + the period picker,
     so granularity, traffic tier and period read as three distinct choices
     rather than one undifferentiated wall of buttons. */
  :global(.controls-panel) {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--vs-l) var(--vs-xl, 2rem);
    padding: var(--pad-l);
    border: var(--border-1);
    border-radius: var(--br-m);
    background: var(--fg-05);
    margin-block-end: var(--vs-l);
  }

  :global(.control-field) {
    display: flex;
    flex-direction: column;
    gap: var(--vs-s);
  }

  /* The period picker always sits on its own row so the controls panel keeps a
     consistent two-row shape regardless of grain (the hour grain adds an extra
     select that would otherwise wrap the picker only sometimes). */
  :global(.control-field.period-field) {
    flex-basis: 100%;
  }

  :global(.control-label) {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    font-size: 0.72rem;
    font-weight: var(--fw-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-5);
  }

  :global(.info-dot) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    border: 1px solid var(--fg-3);
    color: var(--fg-5);
    font-size: 0.6rem;
    font-weight: var(--fw-bold);
    text-transform: none;
  }

  :global(.chip-group) {
    gap: var(--vs-s);
    flex-wrap: wrap;
  }

  /* An `<a class="chip selected">` is repainted by the global `a:visited` rule
     above (→ `--primary`, the same hue as the selected chip fill), making the
     label unreadable. Restore the on-primary foreground for selected chips. */
  :global(.chip.selected),
  :global(.chip.selected:visited),
  :global(.chip[aria-pressed="true"]) {
    color: var(--white);
  }

  /* Chips rendered as links (dimension nav) should read as chips, not links —
     drop the global anchor underline and link color on the unselected state. */
  :global(a.chip),
  :global(a.chip:visited),
  :global(a.chip:hover) {
    text-decoration: none;
    color: var(--fg);
  }

  :global(a.chip.selected),
  :global(a.chip.selected:visited) {
    color: var(--white);
  }

  :global(.page-head) {
    justify-content: space-between;
    align-items: center;
    gap: var(--vs-base);
    margin-block-end: var(--vs-l);
  }

  :global(.page-head h1) {
    margin: 0;
    font-size: 1.5rem;
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
