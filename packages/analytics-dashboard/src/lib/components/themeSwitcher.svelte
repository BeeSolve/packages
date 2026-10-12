<script lang="ts">
  import { onMount } from "svelte";

  type Scheme = "light" | "dark";

  function prefersDark(): boolean {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  function readStored(): Scheme | null {
    if (typeof localStorage === "undefined") return null;
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark" ? saved : null;
  }

  // Stored override: "light" | "dark" | null (null = follow system).
  // Per https://lea.verou.me/blog/2026/dark-mode-toggles/ the model has three
  // states but the toggle only ever shows two: it flips to the opposite of the
  // resolved scheme, and reverts to system default when the target matches the
  // OS preference (rather than silently pinning).
  //
  // Initialise synchronously from the real values so the first render (and the
  // very first click) never sees a stale default.
  let override = $state<Scheme | null>(readStored());
  let systemScheme = $state<Scheme>(prefersDark() ? "dark" : "light");

  // What the user actually sees right now.
  const resolved = $derived<Scheme>(override ?? systemScheme);

  // Clicking targets the opposite of what's on screen.
  const target = $derived<Scheme>(resolved === "dark" ? "light" : "dark");

  function applyScheme(): void {
    document.documentElement.style.setProperty(
      "color-scheme",
      override == null ? "light dark" : override,
    );
  }

  onMount(() => {
    // Keep the icon in sync if the OS scheme changes, but never touch the
    // stored override here — re-evaluation must only happen on user click.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      systemScheme = event.matches ? "dark" : "light";
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  });

  function toggle(): void {
    // Read the OS preference live so the decision can never be stale.
    const system: Scheme = prefersDark() ? "dark" : "light";
    systemScheme = system;
    const next: Scheme = (override ?? system) === "dark" ? "light" : "dark";

    // If the target matches the OS preference, revert to system default and
    // drop the stored value. Otherwise pin the target as an override.
    if (next === system) {
      override = null;
      try {
        localStorage.removeItem("theme");
      } catch {
        // ignore storage failures (private mode, etc.)
      }
    } else {
      override = next;
      try {
        localStorage.setItem("theme", next);
      } catch {
        // ignore storage failures
      }
    }
    applyScheme();
  }

  const label = $derived(
    override == null
      ? `Switch to ${target} mode`
      : `Switch to ${target} mode (system default)`,
  );
</script>

<button
  type="button"
  class="button minimal theme-toggle"
  onclick={toggle}
  title={label}
  aria-label={label}
>
  {#if resolved === "light"}
    <!-- sun: light is active -->
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  {:else}
    <!-- moon: dark is active -->
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  {/if}
</button>

<style>
  /* Single-icon two-state toggle (see component comment). Composes graffiti's
     .button.minimal for the interactive base; we only size it as an icon. */
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.35rem;
    line-height: 0;
    color: var(--fg-7);
  }

  .theme-toggle:hover {
    color: var(--fg);
  }

  .theme-toggle svg {
    width: 1.15rem;
    height: 1.15rem;
  }
</style>
