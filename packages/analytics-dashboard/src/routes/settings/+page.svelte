<script lang="ts">
  import { getSitemapConfig, setSitemapUrl } from "#lib/remote/sitemapConfig.remote.js";
  import { deleteUser, listUsers } from "#lib/remote/users.remote.js";
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
</style>
