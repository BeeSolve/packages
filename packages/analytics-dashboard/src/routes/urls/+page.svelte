<script lang="ts">
  import { addToWatchlist, listUrls } from "#lib/remote/urls.remote.js";

  let { data } = $props();

  const isAdmin = $derived(data.user?.type === "admin");
</script>

<h1>URLs</h1>

<svelte:boundary>
  {#snippet pending()}
    <p>Loading URLs…</p>
  {/snippet}

  {@const result = await listUrls()}

  <p class="caption">
    <strong>{result.items.length.toLocaleString()}</strong>
    distinct {result.items.length === 1 ? "URL" : "URLs"} CloudFront has served, with the day each first appeared.
  </p>

  {#if result.items.length === 0}
    <p>No URLs recorded yet.</p>
  {:else}
    <div class="table">
      <table>
        <thead>
          <tr>
            <th class="col-url">URL</th>
            <th class="col-firstseen">First seen</th>
            {#if isAdmin}
              <th class="col-action">Action</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each result.items as item (item.url)}
            {@const addForm = addToWatchlist.for(item.url)}
            <tr>
              <td class="col-url">{item.url}</td>
              <td class="col-firstseen">{item.firstSeen}</td>
              {#if isAdmin}
                <td class="col-action">
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
    white-space: nowrap;
  }

  /* The URL column absorbs the slack so the date and action columns size to
     their content; without this the narrow columns wrap "2026-10-17" and the
     button onto two lines. */
  .col-url {
    width: 100%;
    word-break: break-all;
  }

  .col-firstseen {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .col-action {
    white-space: nowrap;
  }
</style>
