<script lang="ts">
  import MessageStatusBadge from "$lib/components/messageStatusBadge.svelte";
  import MonthPicker from "$lib/components/monthPicker.svelte";
  import { createLoadMore } from "$lib/loadMore.svelte";

  let { data } = $props();

  const paginator = createLoadMore(
    () => data.items,
    () => data.cursor ?? undefined,
    () => ({ year: String(data.year), month: String(data.month) }),
  );

  let searchEmail = $state("");
  let recipientEmails = $state<Array<string>>([]);
  let loaded = $state(false);

  async function loadRecipientEmails(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const response = await fetch("/recipients/keys");
    if (response.ok) recipientEmails = await response.json();
  }

  function onSearch(event: SubmitEvent): void {
    event.preventDefault();
    const trimmed = searchEmail.trim().toLowerCase();
    if (trimmed.length === 0) return;
    window.location.href = `/recipients/${encodeURIComponent(trimmed)}`;
  }

  function formatDateTime(value: string): string {
    return new Date(value).toLocaleString();
  }
</script>

<h1>Messages</h1>

<div class="cluster toolbar" style="--gap: var(--vs-base);">
  <MonthPicker year={data.year} month={data.month} startDate={data.startDate} />

  <form class="cluster search" style="--gap: var(--vs-s);" onsubmit={onSearch}>
    <input
      type="email"
      name="email"
      list="recipient-emails"
      placeholder="Search by recipient email"
      bind:value={searchEmail}
      onfocus={loadRecipientEmails}
      aria-label="Recipient email"
    />
    <datalist id="recipient-emails">
      {#each recipientEmails as email}
        <option value={email}></option>
      {/each}
    </datalist>
    <button type="submit" class="button mini">Search</button>
  </form>
</div>

{#if paginator.items.length === 0}
  <p>No messages for this month.</p>
{:else}
  <div class="table">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Recipients</th>
          <th>Subject</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {#each paginator.items as message}
          <tr>
            <td>{formatDateTime(message.createdAt)}</td>
            <td>{message.recipients.join(", ")}</td>
            <td><a href="/messages/{message.id}">{message.subject}</a></td>
            <td><MessageStatusBadge status={message.status} /></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if paginator.loadMoreHref != null}
    <div class="load-more">
      <a href={paginator.loadMoreHref} class="button ghost" data-sveltekit-noscroll>Load more</a>
    </div>
  {/if}
{/if}

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1.25rem;
  }

  .toolbar {
    justify-content: space-between;
    margin-bottom: var(--vs-base);
  }

  .search input {
    margin: 0;
  }

  .search button[type="submit"] {
    margin-block-start: 0;
  }

  .load-more {
    margin-top: var(--vs-base);
    display: flex;
    justify-content: center;
  }
</style>
