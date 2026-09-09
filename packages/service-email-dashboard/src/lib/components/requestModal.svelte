<script lang="ts">
  import type { EmailRequest } from "$lib/server/requests";

  let { open = $bindable(false), request }: { open: boolean; request: EmailRequest } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);

  // Wrap the email HTML in a minimal document with a light CSP that blocks
  // script/plugin execution (defense in depth on top of the sandboxed iframe)
  // while still allowing images and styles so the email renders as sent.
  const srcdoc = $derived(
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; frame-src 'none'; object-src 'none'"><base target="_blank"></head><body>${request.html}</body></html>`,
  );

  $effect(() => {
    const element = dialog;
    if (element == null) return;
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  });
</script>

<dialog bind:this={dialog} class="request-dialog" onclose={() => (open = false)} aria-label="Email preview">
  <button class="button close" onclick={() => (open = false)} aria-label="Close">&times;</button>
  <header class="modal-header">
    <h2>{request.subject}</h2>
  </header>
  <div class="modal-body">
    <iframe
      class="email-preview"
      title="Email HTML preview"
      sandbox=""
      referrerpolicy="no-referrer"
      {srcdoc}
    ></iframe>
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
    overflow: hidden;
    padding: var(--vs-base);
    display: flex;
    min-block-size: 0;
  }

  .email-preview {
    inline-size: 100%;
    min-block-size: 240px;
    block-size: 60vh;
    border: none;
    background: #fff;
  }

  .close {
    font-size: 1.5rem;
    line-height: 1;
  }
</style>
