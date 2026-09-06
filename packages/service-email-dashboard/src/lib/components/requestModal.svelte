<script lang="ts">
  let { open = $bindable(false), json }: { open: boolean; json: unknown } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);

  const formatted = $derived(JSON.stringify(json, null, 2));

  $effect(() => {
    const element = dialog;
    if (element == null) return;
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  });

  async function copyToClipboard() {
    await navigator.clipboard.writeText(formatted);
  }
</script>

<dialog bind:this={dialog} class="request-dialog" onclose={() => (open = false)} aria-label="Email request JSON">
  <button class="button close" onclick={() => (open = false)} aria-label="Close">&times;</button>
  <header class="modal-header">
    <h2>Email request (JSON)</h2>
    <button class="button mini ghost" onclick={copyToClipboard}>Copy</button>
  </header>
  <div class="modal-body">
    <pre><code>{formatted}</code></pre>
  </div>
</dialog>

<style>
  .request-dialog {
    max-inline-size: 900px;
    inline-size: calc(100% - var(--pad-xxl) * 2);
    max-block-size: 80vh;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .request-dialog:not([open]) {
    display: none;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--vs-base);
    padding: var(--pad-l) var(--vs-base);
    border-bottom: var(--border-1);
    flex-shrink: 0;
  }

  .modal-header h2 {
    font-size: 1.1rem;
    margin: 0;
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

  .close {
    font-size: 1.5rem;
    line-height: 1;
  }
</style>
