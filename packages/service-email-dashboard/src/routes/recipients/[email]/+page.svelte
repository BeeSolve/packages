<script lang="ts">
  import MessageStatusBadge from "$lib/components/messageStatusBadge.svelte";
  import MonthPicker from "$lib/components/monthPicker.svelte";
  import SummaryCard from "$lib/components/summaryCard.svelte";
  import { createLoadMore } from "$lib/loadMore.svelte";

  let { data } = $props();

  const paginator = createLoadMore(
    () => data.items,
    () => data.cursor ?? undefined,
    () => ({ year: String(data.year), month: String(data.month) }),
  );

  // note: messageManyByRecipient is NOT month-filtered in the model (it lists
  // all the recipient's messages newest-first). We keep the MonthPicker for UI
  // consistency and filter the already-fetched pages client-side by matching
  // the createdAt "YYYY-MM" prefix. "Load more" continues to page the full
  // underlying cursor stream.
  const selectedPrefix = $derived(`${data.year}-${String(data.month).padStart(2, "0")}`);
  const visible = $derived(
    paginator.items.filter((message) => message.createdAt.slice(0, 7) === selectedPrefix),
  );

  function formatDateTime(value: string): string {
    return new Date(value).toLocaleString();
  }
</script>

<nav class="breadcrumbs">
  <ul>
    <li><a href="/recipients">Recipients</a></li>
    <li aria-current="page">{data.email}</li>
  </ul>
</nav>

<h1>{data.email}</h1>

<div class="layout-card summary-cards" style="--min-card-width: 9rem; --gap: var(--vs-base);">
  <SummaryCard label="Received" value={data.stats.received.toLocaleString()} />
  <SummaryCard label="Sent" value={data.stats.sent.toLocaleString()} />
  <SummaryCard label="Delivered" value={data.stats.delivered.toLocaleString()} />
  <SummaryCard label="Bounced" value={data.stats.bounced.toLocaleString()} />
  <SummaryCard label="Complained" value={data.stats.complained.toLocaleString()} />
  <SummaryCard label="Rejected" value={data.stats.rejected.toLocaleString()} />
  <SummaryCard label="Failed" value={data.stats.failed.toLocaleString()} />
</div>

<div class="cluster" style="--gap: var(--vs-base);">
  <MonthPicker year={data.year} month={data.month} startDate={data.startDate} />
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

{#if paginator.loadMoreHref != null}
  <div class="load-more">
    <a href={paginator.loadMoreHref} class="button ghost" data-sveltekit-noscroll>Load more</a>
  </div>
{/if}

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
