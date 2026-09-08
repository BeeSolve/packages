<script lang="ts">
  import { enhance } from "$app/forms";
  import MessageStatusBadge from "$lib/components/messageStatusBadge.svelte";
  import RequestModal from "$lib/components/requestModal.svelte";

  let { data, form } = $props();

  let requesting = $state(false);
  let modalOpen = $state(false);

  function formatDateTime(value: string): string {
    return new Date(value).toLocaleString();
  }

  const recipientEntries = $derived(Object.entries(data.message.logByRecipient));
</script>

<a href="/messages" class="back">← Messages</a>

<h1>{data.message.subject}</h1>

<div class="meta">
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
  <form
    method="POST"
    use:enhance={() => {
      requesting = true;
      return async ({ update, result }) => {
        await update();
        requesting = false;
        if (result.type === "success" && result.data?.request != null) {
          modalOpen = true;
        }
      };
    }}
  >
    <button type="submit" class="button" disabled={requesting}>
      {requesting ? "Requesting…" : "Request message body"}
    </button>
  </form>

  {#if form?.bodyUnavailable}
    <p class="error">Message body no longer available.</p>
  {/if}
</section>

{#if form?.request != null}
  <RequestModal bind:open={modalOpen} json={form.request} />
{/if}

<h2>Per-recipient timeline</h2>

{#each recipientEntries as [recipient, entries]}
  <section class="recipient-timeline">
    <h3>
      <a href="/recipients/{encodeURIComponent(recipient)}">{recipient}</a>
    </h3>
    <ol class="timeline">
      {#each entries as entry}
        <li class="timeline-item">
          <div class="timeline-content">
            <div class="timeline-head">
              <span class="timeline-badge"><MessageStatusBadge status={entry.status} /></span>
              <span class="timeline-time">{formatDateTime(entry.timestamp)}</span>
            </div>
            <p class="timeline-detail">
              {#if entry.status === "delivered"}
                Delivered in {(entry.deliveryMs / 1000).toFixed(1)}s
                (at {formatDateTime(entry.deliveredAt)})
              {:else if entry.status === "bounced"}
                {entry.bounceType} / {entry.bounceSubType}
                {#if entry.diagnosticCode != null}— {entry.diagnosticCode}{/if}
                (at {formatDateTime(entry.at)})
              {:else if entry.status === "complained"}
                {entry.feedbackType ?? "complaint"} (at {formatDateTime(entry.at)})
              {:else if entry.status === "rejected"}
                {entry.reason} (at {formatDateTime(entry.at)})
              {:else if entry.status === "requested"}
                Request {entry.requestId}
              {/if}
            </p>
          </div>
        </li>
      {/each}
    </ol>
  </section>
{/each}

<style>
  .back {
    display: inline-block;
    margin-bottom: var(--vs-base);
    font-size: 0.875rem;
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
    display: grid;
    gap: 0.35rem;
    padding: var(--pad-m);
    border: var(--border-1);
    border-radius: var(--br-m);
    margin-bottom: var(--vs-base);
    font-size: 0.9rem;
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

  .body-request form {
    display: inline;
  }

  .body-request form button[type="submit"] {
    margin-block-start: 0;
  }

  .recipient-timeline {
    margin-top: var(--vs-m);
    padding: var(--pad-m) var(--pad-l);
    border: var(--border-05);
    border-radius: var(--br-m);
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
    color: inherit;
    text-decoration: none;
  }

  .recipient-timeline h3 a:hover {
    text-decoration: underline;
  }

  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    border-left: var(--border-1);
  }

  .timeline-item {
    position: relative;
    padding: 0 0 var(--vs-s) var(--vs-base);
  }

  .timeline-item:last-child {
    padding-bottom: 0;
  }

  .timeline-item::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.35rem;
    width: 0.5rem;
    height: 0.5rem;
    transform: translateX(-50%);
    border-radius: 50%;
    background: var(--primary);
    box-shadow: 0 0 0 2px var(--bg);
  }

  .timeline-content {
    min-width: 0;
  }

  .timeline-head {
    display: flex;
    align-items: center;
    gap: var(--vs-s);
    flex-wrap: wrap;
  }

  .timeline-badge {
    display: inline-flex;
  }

  .timeline-time {
    font-size: 0.8rem;
    color: var(--fg-5);
    font-variant-numeric: tabular-nums;
  }

  .timeline-detail {
    margin: var(--vs-xs) 0 0;
    font-size: 0.85rem;
    color: var(--fg-7);
  }

  .error {
    margin-top: var(--vs-base);
  }
</style>
