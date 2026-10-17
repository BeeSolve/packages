<script lang="ts">
  import { addToWatchlist, listUrls } from "#lib/remote/urls.remote.js";

  let { data } = $props();

  const isAdmin = $derived(data.user?.type === "admin");
</script>

<h1>URLs</h1>

<p class="caption">Every distinct URL CloudFront has served, with the day it first appeared.</p>

<svelte:boundary>
  {#snippet pending()}
    <p>Loading URLs…</p>
  {/snippet}

  {@const result = await listUrls()}

  {#if result.items.length === 0}
    <p>No URLs recorded yet.</p>
  {:else}
    <div class="table">
      <table>
        <thead>
          <tr>
            <th>URL</th>
            <th>First seen</th>
            {#if isAdmin}
              <th>Action</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each result.items as item (item.url)}
            {@const addForm = addToWatchlist.for(item.url)}
            <tr>
              <td>{item.url}</td>
              <td>{item.firstSeen}</td>
              {#if isAdmin}
                <td>
                  <form {...addForm}>
                    <input {...addForm.fields.url.as("hidden", item.url)} />
                    <button type="submit" class="button mini">Add to watchlist</button>
                  </form>
                  {#each addForm.fields.allIssues() ?? [] as issue (issue.message)}
                    <p class="error">{issue.message}</p>
                  {/each}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</svelte:boundary>

<style>
  h1 {
    font-size: 1.5rem;
    margin: 0 0 1rem;
  }

  .caption {
    margin: 0 0 var(--vs-l);
    color: var(--fg-7);
    font-size: 0.875rem;
  }

  .table form {
    display: inline;
    margin: 0;
  }

  .table form button[type="submit"] {
    margin-block-start: 0;
  }
</style>
