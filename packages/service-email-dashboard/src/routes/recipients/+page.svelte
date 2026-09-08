<script lang="ts">
  import { createLoadMore } from "$lib/loadMore.svelte";

  let { data } = $props();

  const paginator = createLoadMore(
    () => data.items,
    () => data.cursor ?? undefined,
  );
</script>

<h1>Recipients</h1>

{#if paginator.items.length === 0}
  <p>No recipients found.</p>
{:else}
  <div class="table">
    <table>
      <thead>
        <tr>
          <th>Recipient</th>
          <th class="num">Received</th>
          <th class="num">Sent</th>
          <th class="num">Delivered</th>
          <th class="num">Bounced</th>
          <th class="num">Complained</th>
          <th class="num">Rejected</th>
          <th class="num">Failed</th>
        </tr>
      </thead>
      <tbody>
        {#each paginator.items as recipient}
          <tr>
            <td><a href="/recipients/{encodeURIComponent(recipient.email)}">{recipient.email}</a></td>
            <td class="num">{recipient.received.toLocaleString()}</td>
            <td class="num">{recipient.sent.toLocaleString()}</td>
            <td class="num">{recipient.delivered.toLocaleString()}</td>
            <td class="num">{recipient.bounced.toLocaleString()}</td>
            <td class="num">{recipient.complained.toLocaleString()}</td>
            <td class="num">{recipient.rejected.toLocaleString()}</td>
            <td class="num">{recipient.failed.toLocaleString()}</td>
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

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .load-more {
    margin-top: var(--vs-base);
    display: flex;
    justify-content: center;
  }
</style>
