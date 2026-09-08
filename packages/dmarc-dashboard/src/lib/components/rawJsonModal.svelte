<script lang="ts">
  let { open = $bindable(false), json }: { open: boolean; json: unknown } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  const formatted = $derived(JSON.stringify(json, null, 2));

  // Drive the native <dialog> from the bound `open` prop so callers keep using
  // bind:open. showModal()/close() give real modality, backdrop, focus
  // trapping and Escape-to-close for free; graffiti styles <dialog> directly.
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
    try {
      await navigator.clipboard.writeText(formatted);
    } catch {
      return;
    }
    copied = true;
    if (copiedTimer != null) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied = false;
      copiedTimer = null;
    }, 1500);
  }
</script>

<dialog bind:this={dialog} class="raw-json-dialog" onclose={() => (open = false)} aria-label="Raw JSON report data">
  <button class="button close" onclick={() => (open = false)} aria-label="Close">&times;</button>
  <header class="modal-header">
    <button
      class="button mini ghost tip bottom"
      aria-label={copied ? "Copied" : null}
      onclick={copyToClipboard}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
    <h2>Raw Report (JSON)</h2>
  </header>
  <div class="modal-body">
    <pre><code>{formatted}</code></pre>
  </div>
</dialog>

<style>
  /* graffiti styles <dialog> (centering, backdrop, radius, shadow, open/close
     animation) and `> .close`, which it pins top-right at
     `inset-inline-end: var(--pad-m)`. Copy sits at the header's left edge and
     the header reserves a right gutter, so the pinned × never overlaps it. We
     only widen the dialog for the JSON payload — the default dialog is capped
     at 40ch — and lay out the body. */
  .raw-json-dialog {
    max-inline-size: 900px;
    inline-size: calc(100% - var(--pad-xxl) * 2);
    max-block-size: 80vh;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .raw-json-dialog:not([open]) {
    display: none;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--vs-base);
    padding: var(--pad-l) var(--vs-base);
    padding-inline-end: var(--pad-xxl);
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
