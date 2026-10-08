<script lang="ts">
  import { page } from "$app/state";

  import MessageStatusBadge from "#lib/components/messageStatusBadge.svelte";
  import MonthPicker from "#lib/components/monthPicker.svelte";
  import SummaryCard from "#lib/components/summaryCard.svelte";
  import { getRecipient } from "#lib/remote/recipients.remote.js";

  let { data } = $props();

  const email = $derived(page.params.email ?? "");
  const yearParam = $derived(
    toInt(page.url.searchParams.get("year")) ?? new Date().getUTCFullYear(),
  );
  const monthParam = $derived(
    toInt(page.url.searchParams.get("month")) ?? new Date().getUTCMonth() + 1,
  );
  const cursorParam = $derived(page.url.searchParams.get("cursor") ?? undefined);

  function formatDateTime(value: string): string {
    return new Date(value).toLocaleString();
  }

  function loadMoreHref(cursor: string): string {
    const params = new URLSearchParams(page.url.search);
    params.set("cursor", cursor);
    return `${page.url.pathname}?${params.toString()}`;
  }

  function toInt(value: string | null): number | undefined {
    if (value == null) return undefined;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return undefined;
    return parsed;
  }
</script>

<svelte:boundary>
  {#snippet pending()}
    <p>Loading recipient…</p>
  {/snippet}

  {@const recipient = await getRecipient({ email, year: yearParam, month: monthParam, cursor: cursorParam })}
  {@const selectedPrefix = `${recipient.year}-${String(recipient.month).padStart(2, "0")}`}
  {@const visible = recipient.items.filter((message) => message.createdAt.slice(0, 7) === selectedPrefix)}

  <nav class="breadcrumbs">
    <ul>
      <li><a href="/recipients">Recipients</a></li>
      <li aria-current="page">{recipient.email}</li>
    </ul>
  </nav>

  <h1>{recipient.email}</h1>

  <div class="layout-card summary-cards" style="--min-card-width: 9rem; --gap: var(--vs-base);">
    <SummaryCard label="Received" value={recipient.stats.received.toLocaleString()} />
    <SummaryCard label="Sent" value={recipient.stats.sent.toLocaleString()} />
    <SummaryCard label="Delivered" value={recipient.stats.delivered.toLocaleString()} />
    <SummaryCard label="Bounced" value={recipient.stats.bounced.toLocaleString()} />
    <SummaryCard label="Complained" value={recipient.stats.complained.toLocaleString()} />
    <SummaryCard label="Rejected" value={recipient.stats.rejected.toLocaleString()} />
    <SummaryCard label="Failed" value={recipient.stats.failed.toLocaleString()} />
  </div>

  <div class="cluster" style="--gap: var(--vs-base);">
    <MonthPicker year={recipient.year} month={recipient.month} startDate={data.startDate} />
  </div>

  <h2>Message history</h2>

  {#if visible.length === 0}
    <p>No messages for this month in the loaded pages.</p>
  {:else}
    <div class="table">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Subject</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#each visible as message}
            <tr>
              <td>{formatDateTime(message.createdAt)}</td>
              <td><a href="/messages/{message.id}">{message.subject}</a></td>
              <td><MessageStatusBadge status={message.status} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if recipient.cursor != null}
    <div class="load-more">
      <a href={loadMoreHref(recipient.cursor)} class="button ghost" data-sveltekit-noscroll>Load more</a>
    </div>
  {/if}
</svelte:boundary>

<style>
  .breadcrumbs > ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  h1 {
    font-size: 1.5rem;
    margin: 0 0 1.25rem;
    word-break: break-word;
  }

  h2 {
    font-size: 1.15rem;
    margin: var(--vs-l) 0 var(--vs-base);
  }

  .summary-cards {
    margin-bottom: var(--vs-base);
  }

  .load-more {
    margin-top: var(--vs-base);
    display: flex;
    justify-content: center;
  }
</style>
