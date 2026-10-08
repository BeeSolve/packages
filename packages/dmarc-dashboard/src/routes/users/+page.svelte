<script lang="ts">
  import { deleteUser, listUsers } from "#lib/remote/users.remote.js";
</script>

<h1>Users</h1>

<p><a href="/users/invite">Invite user</a></p>

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
            <th>Domains</th>
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
              <td>{record.type === "admin" ? "All" : record.domains.join(", ") || "None"}</td>
              <td>{new Date(record.createdAt).toLocaleDateString()}</td>
              <td>
                {#if record.type !== "admin"}
                  <span class="actions">
                    <a href="/users/{record.email}/edit">Edit</a>
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
