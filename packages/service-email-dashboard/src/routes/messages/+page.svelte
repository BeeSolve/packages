<script lang="ts">
  import { page } from "$app/state";

  import MessageStatusBadge from "#lib/components/messageStatusBadge.svelte";
  import MonthPicker from "#lib/components/monthPicker.svelte";
  import { listMessages } from "#lib/remote/messages.remote.js";
  import { listRecipientEmails } from "#lib/remote/recipients.remote.js";

  let { data } = $props();

  const yearParam = $derived(
    toInt(page.url.searchParams.get("year")) ?? new Date().getUTCFullYear(),
  );
  const monthParam = $derived(
    toInt(page.url.searchParams.get("month")) ?? new Date().getUTCMonth() + 1,
  );
  const cursorParam = $derived(page.url.searchParams.get("cursor") ?? undefined);

  let searchEmail = $state("");
  let recipientEmails = $state<Array<string>>([]);
  let loaded = $state(false);

  async function loadRecipientEmails(): Promise<void> {
    if (loaded) return;
    loaded = true;
    recipientEmails = await listRecipientEmails();
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

<h1>Messages</h1>

<svelte:boundary>
  {#snippet pending()}
    <p>Loading messages…</p>
  {/snippet}

  {@const messages = await listMessages({ year: yearParam, month: monthParam, cursor: cursorParam })}

  <div class="cluster toolbar" style="--gap: var(--vs-base);">
    <MonthPicker year={messages.year} month={messages.month} startDate={data.startDate} />

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

  {#if messages.items.length === 0}
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
          {#each messages.items as message}
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

    {#if messages.cursor != null}
      <div class="load-more">
        <a href={loadMoreHref(messages.cursor)} class="button ghost" data-sveltekit-noscroll>Load more</a>
      </div>
    {/if}
  {/if}
</svelte:boundary>

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
