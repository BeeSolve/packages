<footer class="app-footer">
  <span>
    Made with ❤️ by
    <a href="https://beesolve.com" target="_blank" rel="noopener noreferrer">BeeSolve s.r.o.</a>
  </span>
  <span class="version">v{__APP_VERSION__}</span>
</footer>

<style>
  .app-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--vs-xs, 0.4rem) var(--vs-base);
    padding: var(--pad-m);
    border-top: var(--border-1);
    color: var(--fg-5);
    font-size: 0.75rem;
  }

  .version {
    font-variant-numeric: tabular-nums;
    color: var(--fg-7);
  }
</style>
