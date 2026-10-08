<script lang="ts">
  import { page } from "$app/state";

  import MessageStatusBadge from "#lib/components/messageStatusBadge.svelte";
  import RequestModal from "#lib/components/requestModal.svelte";
  import { getMessage, loadMessageBody } from "#lib/remote/messages.remote.js";
  import type { EmailRequest } from "#lib/server/requests.js";

  const messageId = $derived(page.params.messageId ?? "");

  let requesting = $state(false);
  let modalOpen = $state(false);
  let loadedRequest = $state<EmailRequest | null>(null);
  let bodyUnavailable = $state(false);

  async function previewMessage() {
    requesting = true;
    bodyUnavailable = false;
    try {
      const result = await loadMessageBody({ messageId });
      if (result.bodyUnavailable === true) {
        bodyUnavailable = true;
      } else {
        loadedRequest = result.request;
        modalOpen = true;
      }
    } finally {
      requesting = false;
    }
  }

  function formatDateTime(value: string): string {
    return new Date(value).toLocaleString();
  }

  function timelineTone(status: string): string {
    if (status === "delivered") return "success";
    if (status === "bounced" || status === "rejected") return "error";
    if (status === "complained") return "warning";
    return "info";
  }
</script>

<svelte:boundary>
  {#snippet pending()}
    <p>Loading message…</p>
  {/snippet}

  {@const data = await getMessage({ messageId })}
  {@const recipientEntries = Object.entries(data.message.logByRecipient)}

  <nav class="breadcrumbs">
    <ul>
      <li><a href="/messages">Messages</a></li>
      <li aria-current="page">{data.message.subject}</li>
    </ul>
  </nav>

  <h1>{data.message.subject}</h1>

  <div class="card meta">
    <div><span class="meta-label">From</span> {data.message.sender}</div>
    <div><span class="meta-label">Status</span> <MessageStatusBadge status={data.message.status} /></div>
    <div><span class="meta-label">Created</span> {formatDateTime(data.message.createdAt)}</div>
    <div><span class="meta-label">Updated</span> {formatDateTime(data.message.updatedAt)}</div>
    <div>
      <span class="meta-label">Recipients</span>
      {#each data.message.recipients as recipient, index}
        <a href="/recipients/{encodeURIComponent(recipient)}">{recipient}</a>{#if index < data.message.recipients.length - 1},
        {/if}
      {/each}
    </div>
  </div>

  <section class="body-request">
    <button type="button" class="button" onclick={previewMessage} disabled={requesting}>
      {requesting ? "Loading…" : "Preview message"}
    </button>

    {#if bodyUnavailable}
      <p class="error">Message body no longer available.</p>
    {/if}
  </section>

  {#if loadedRequest != null}
    <RequestModal bind:open={modalOpen} request={loadedRequest} />
  {/if}

  <h2>Per-recipient timeline</h2>

  {#each recipientEntries as [recipient, entries]}
    <section class="card recipient-timeline">
      <h3>
        <a href="/recipients/{encodeURIComponent(recipient)}">{recipient}</a>
      </h3>
      <ol class="timeline">
        {#each entries as entry}
          <li class={timelineTone(entry.status)}>
            <span class="marker"></span>
            <div class="timeline-body">
              <MessageStatusBadge status={entry.status} />
              <time class="timeline-time">{formatDateTime(entry.timestamp)}</time>
              {#if entry.status === "delivered"}
                <span class="timeline-detail">Delivered in {(entry.deliveryMs / 1000).toFixed(1)}s</span>
              {:else if entry.status === "bounced"}
                <span class="timeline-detail">
                  {entry.bounceType} / {entry.bounceSubType}{#if entry.diagnosticCode != null}
                    — {entry.diagnosticCode}{/if}
                </span>
              {:else if entry.status === "complained"}
                <span class="timeline-detail">{entry.feedbackType ?? "complaint"}</span>
              {:else if entry.status === "rejected"}
                <span class="timeline-detail">{entry.reason}</span>
              {:else if entry.status === "requested"}
                <span class="timeline-detail">Request {entry.requestId}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    </section>
  {/each}
</svelte:boundary>

<style>
  .breadcrumbs > ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  h1 {
    font-size: 1.5rem;
    margin: 0 0 1rem;
  }

  h2 {
    font-size: 1.15rem;
    margin: var(--vs-l) 0 var(--vs-base);
  }

  .meta {
    --gap: 0.35rem;
    margin-bottom: var(--vs-base);
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }

  .meta > div {
    min-width: 0;
  }

  .meta-label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-5);
    margin-right: 0.35rem;
  }

  .body-request {
    margin-bottom: var(--vs-l);
  }

  .body-request button {
    margin-block-start: 0;
  }

  .recipient-timeline {
    margin-top: var(--vs-m);
  }

  .recipient-timeline:first-of-type {
    margin-top: 0;
  }

  .recipient-timeline h3 {
    font-size: 0.95rem;
    font-weight: var(--fw-medium);
    margin: 0 0 var(--vs-s);
  }

  .recipient-timeline h3 a {
    color: var(--primary);
    text-decoration: underline;
  }

  .recipient-timeline h3 a:hover {
    text-decoration: underline;
  }

  /* Uses graffiti's built-in .timeline component (marker + connecting line +
     grid layout). We tune the marker down to a small dot and lay the badge,
     timestamp, and detail out inline on a single row so graffiti's marker
     alignment keeps the dot level with the row. */
  .timeline {
    --timeline-marker-size: 0.75rem;
    --timeline-gap: var(--vs-base);
  }

  .timeline .marker {
    border: none;
    box-shadow: none;
    background: var(--timeline-marker-color, var(--fg-5));
  }

  .timeline-body {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--vs-s);
    min-width: 0;
  }

  .timeline-time {
    font-size: 0.8rem;
    color: var(--fg-5);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .timeline-detail {
    font-size: 0.85rem;
    color: var(--fg-7);
    min-width: 0;
  }

  .error {
    margin-top: var(--vs-base);
  }
</style>
