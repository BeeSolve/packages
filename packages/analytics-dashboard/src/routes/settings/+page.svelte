<script lang="ts">
  import { formatPattern } from "#lib/labels.js";
  import { deleteUser, inviteUser, listUsers } from "#lib/remote/users.remote.js";
  import {
    addWatch,
    deleteWatch,
    getSitemapConfig,
    listWatchConfig,
    setSitemapUrl,
    setWatchStatus,
  } from "#lib/remote/watchConfig.remote.js";

  let inviteDialog = $state<HTMLDialogElement | null>(null);

  function openInvite(): void {
    inviteDialog?.showModal();
  }

  function closeInvite(): void {
    inviteDialog?.close();
  }
</script>

<h1>Settings</h1>

<div class="stack">
  <section class="card">
    <header class="cluster section-head">
      <h2>User management</h2>
      <button type="button" class="button primary" onclick={openInvite}>Invite user</button>
    </header>

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
          placeholder="/blog* or /docs+ or /about"
          disabled={addWatch.pending > 0}
        />
      </label>
      <p class="hint">
        <code>/path</code> watches one exact URL. <code>/prefix*</code> (split) tracks each path
        under the prefix as its own bucket. <code>/prefix+</code> (group) collapses everything
        under the prefix into one bucket. The slash before <code>*</code>/<code>+</code> is
        optional (<code>/blog*</code> and <code>/blog/*</code> both work). Patterns must start with
        <code>/</code>.
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
                  <td><code>{formatPattern(entry)}</code></td>
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

<dialog bind:this={inviteDialog} class="invite-dialog">
  <div class="cluster invite-head">
    <h2>Invite user</h2>
    <button type="button" class="button mini ghost" onclick={closeInvite}>Close</button>
  </div>

  <p class="invite-blurb">
    The invitee receives an email and can sign in with their address at any time — a one-time code
    verifies their identity.
  </p>

  {#each inviteUser.fields.allIssues() ?? [] as issue (issue.message)}
    <p class="error">{issue.message}</p>
  {/each}

  <form {...inviteUser.enhance(async (form) => {
    await form.submit();
    if (form.result?.ok === true) closeInvite();
  })}>
    <label>
      Email address
      <input {...inviteUser.fields.email.as("email")} required disabled={inviteUser.pending > 0} />
    </label>

    <div class="cluster invite-actions">
      <button type="button" class="button minimal" onclick={closeInvite}>Cancel</button>
      <button type="submit" class="button primary" disabled={inviteUser.pending > 0}>
        {inviteUser.pending > 0 ? "Inviting..." : "Send invite"}
      </button>
    </div>
  </form>
</dialog>

<style>
  .section-head {
    justify-content: space-between;
    align-items: center;
    gap: var(--vs-base);
  }

  .section-head h2 {
    margin: 0;
  }

  .section-head button {
    margin-block-start: 0;
  }

  .invite-dialog {
    max-inline-size: 32rem;
  }

  .invite-head {
    justify-content: space-between;
    align-items: center;
    gap: var(--vs-base);
    margin-block-end: var(--vs-s);
  }

  .invite-head h2 {
    margin: 0;
  }

  .invite-head button {
    margin-block-start: 0;
  }

  .invite-blurb {
    margin: 0 0 var(--vs-base);
    color: var(--fg-7);
    font-size: 0.875rem;
  }

  .invite-actions {
    justify-content: flex-end;
    gap: var(--vs-base);
    margin-block-start: var(--vs-base);
  }

  .invite-actions button {
    margin-block-start: 0;
  }

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
