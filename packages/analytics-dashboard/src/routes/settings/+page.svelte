<script lang="ts">
  import { deleteUser, listUsers } from "#lib/remote/users.remote.js";
  import {
    addWatch,
    deleteWatch,
    getSitemapConfig,
    listWatchConfig,
    setSitemapUrl,
    setWatchStatus,
  } from "#lib/remote/watchConfig.remote.js";
</script>

<h1>Settings</h1>

<div class="stack">
  <section class="card">
    <header>
      <h2>User management</h2>
    </header>

    <p><a href="/settings/users/invite">Invite user</a></p>

    <svelte:boundary>
      {#snippet pending()}
        <p>Loading users…</p>
      {/snippet}

      {@const data = await listUsers()}

      {#if data.users.length === 0}
        <p>No users found.</p>
      {:else}
        <div class="table">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Type</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each data.users as record (record.email)}
                {@const deleteForm = deleteUser.for(record.email)}
                <tr>
                  <td>{record.email}</td>
                  <td>{record.type}</td>
                  <td>{new Date(record.createdAt).toLocaleDateString()}</td>
                  <td>
                    {#if record.type !== "admin"}
                      <span class="actions">
                        <a href="/settings/users/{record.email}/edit">Edit</a>
                        <form {...deleteForm}>
                          <input {...deleteForm.fields.email.as("hidden", record.email)} />
                          <button type="submit" class="button mini error">Delete</button>
                        </form>
                      </span>
                      {#each deleteForm.fields.allIssues() ?? [] as issue (issue.message)}
                        <p class="error">{issue.message}</p>
                      {/each}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </svelte:boundary>
  </section>

  <section class="card">
    <header>
      <h2>Sitemap</h2>
    </header>

    <svelte:boundary>
      {#snippet pending()}
        <p>Loading sitemap configuration…</p>
      {/snippet}

      {@const sitemap = await getSitemapConfig()}

      {#each setSitemapUrl.fields.allIssues() ?? [] as issue (issue.message)}
        <p class="error">{issue.message}</p>
      {/each}

      <form {...setSitemapUrl}>
        <label>
          Sitemap URL
          <input
            {...setSitemapUrl.fields.sitemapUrl.as("url", sitemap.sitemapUrl ?? "")}
            placeholder="https://example.com/sitemap.xml"
            disabled={setSitemapUrl.pending > 0}
          />
        </label>

        <button type="submit" class="button primary" disabled={setSitemapUrl.pending > 0}>
          {setSitemapUrl.pending > 0 ? "Saving..." : "Save sitemap URL"}
        </button>
      </form>
    </svelte:boundary>
  </section>

  <section class="card">
    <header>
      <h2>Watchlist</h2>
    </header>

    {#each addWatch.fields.allIssues() ?? [] as issue (issue.message)}
      <p class="error">{issue.message}</p>
    {/each}

    <form {...addWatch}>
      <label>
        Add pattern
        <input
          {...addWatch.fields.pattern.as("text")}
          placeholder="/blog/* or /docs/+ or /about"
          disabled={addWatch.pending > 0}
        />
      </label>
      <p class="hint">
        <code>/path</code> watches one exact URL. <code>/prefix/*</code> (split) tracks each path
        under the prefix as its own bucket. <code>/prefix/+</code> (group) collapses everything
        under the prefix into one bucket. Patterns must start with <code>/</code>.
      </p>
      <button type="submit" class="button primary" disabled={addWatch.pending > 0}>
        {addWatch.pending > 0 ? "Adding..." : "Add pattern"}
      </button>
    </form>

    <svelte:boundary>
      {#snippet pending()}
        <p>Loading watchlist…</p>
      {/snippet}

      {@const watch = await listWatchConfig()}

      {#if watch.items.length === 0}
        <p>No watch entries configured.</p>
      {:else}
        <div class="table">
          <table>
            <thead>
              <tr>
                <th>Matcher</th>
                <th>Mode</th>
                <th>Source</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each watch.items as entry (entry.matcher)}
                {@const statusForm = setWatchStatus.for(entry.matcher)}
                {@const deleteForm = deleteWatch.for(entry.matcher)}
                {@const nextStatus = entry.status === "active" ? "stopped" : "active"}
                <tr>
                  <td>{entry.matcher}</td>
                  <td>{entry.mode}</td>
                  <td>{entry.source}</td>
                  <td>
                    <span class="tag" class:stopped={entry.status === "stopped"}>
                      {entry.status}
                    </span>
                  </td>
                  <td>
                    <span class="actions">
                      <form {...statusForm}>
                        <input {...statusForm.fields.matcher.as("hidden", entry.matcher)} />
                        <input {...statusForm.fields.status.as("hidden", nextStatus)} />
                        <button type="submit" class="button mini">
                          {entry.status === "active" ? "Stop" : "Resume"}
                        </button>
                      </form>
                      {#if entry.source === "manual"}
                        <form {...deleteForm}>
                          <input {...deleteForm.fields.matcher.as("hidden", entry.matcher)} />
                          <button type="submit" class="button mini error">Delete</button>
                        </form>
                      {/if}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </svelte:boundary>
  </section>
</div>

<style>
  .actions {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-m);
  }

  .actions form {
    display: inline;
    margin: 0;
  }

  .actions button[type="submit"] {
    margin-block-start: 0;
  }

  .hint {
    margin: var(--vs-s) 0 0;
    color: var(--fg-5);
    font-size: 0.8rem;
  }

  .tag.stopped {
    --tag-color: var(--fg-5);
  }
</style>
