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
          <button class="btn btn-secondary" onclick={copyToClipboard}>Copy</button>
          <button class="btn btn-close" onclick={() => (open = false)} aria-label="Close">
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
    background: rgba(0, 0, 0, 0.5);
    padding: 2rem;
  }

  .modal {
    display: flex;
    flex-direction: column;
    max-width: 900px;
    max-height: 80vh;
    width: 100%;
    background: var(--surface-0, #fff);
    border-radius: 0.75rem;
    border: 1px solid var(--border, #e2e8f0);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border, #e2e8f0);
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
    padding: 1.5rem;
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--text-1, #1a202c);
  }

  .btn {
    border: none;
    border-radius: 0.35rem;
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-secondary {
    background: var(--surface-1, #f8f9fa);
    border: 1px solid var(--border, #e2e8f0);
    color: var(--text-1, #1a202c);
  }

  .btn-secondary:hover {
    background: var(--surface-2, #edf2f7);
  }

  .btn-close {
    background: none;
    font-size: 1.5rem;
    line-height: 1;
    padding: 0.25rem 0.5rem;
    color: var(--text-2, #64748b);
  }

  .btn-close:hover {
    color: var(--text-1, #1a202c);
  }
</style>
