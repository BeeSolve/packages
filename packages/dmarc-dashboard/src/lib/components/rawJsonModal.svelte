<script lang="ts">
  let { open = $bindable(false), json }: { open: boolean; json: unknown } = $props();

  const formatted = $derived(JSON.stringify(json, null, 2));

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      open = false;
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      open = false;
    }
  }

  async function copyToClipboard() {
    await navigator.clipboard.writeText(formatted);
  }
</script>

{#if open}
  <div
    class="backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Raw JSON report data"
    tabindex="-1"
    onkeydown={handleKeydown}
    onclick={handleBackdropClick}
  >
    <div class="modal">
      <header class="modal-header">
        <h2>Raw Report (JSON)</h2>
        <div class="modal-actions">
          <button class="button mini ghost" onclick={copyToClipboard}>Copy</button>
          <button class="button minimal btn-close" onclick={() => (open = false)} aria-label="Close">
            &times;
          </button>
        </div>
      </header>
      <div class="modal-body">
        <pre><code>{formatted}</code></pre>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in oklab, var(--black, #000) 50%, transparent);
    padding: 2rem;
  }

  /* Gap: graffiti's overlay patterns (drawer, bottom-sheet) don't cover a
     centered modal dialog, so the shell is custom — on graffiti tokens. */
  .modal {
    display: flex;
    flex-direction: column;
    max-width: 900px;
    max-height: 80vh;
    width: 100%;
    background: var(--bg);
    border-radius: var(--br-l);
    border: var(--border-1);
    box-shadow: var(--shadow-3, 0 20px 60px rgba(0, 0, 0, 0.15));
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--pad-l) var(--vs-base);
    border-bottom: var(--border-1);
    flex-shrink: 0;
  }

  .modal-header h2 {
    font-size: 1.1rem;
    margin: 0;
  }

  .modal-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .modal-body {
    overflow: auto;
    padding: var(--vs-base);
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--fg);
  }

  .btn-close {
    font-size: 1.5rem;
    line-height: 1;
  }
</style>
