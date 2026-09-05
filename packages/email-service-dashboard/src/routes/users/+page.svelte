<script lang="ts">
  import { enhance } from "$app/forms";

  let { data, form } = $props();
</script>

<h1>Users</h1>

{#if form?.error}
  <p class="error">{form.error}</p>
{/if}

<p><a href="/users/invite">Invite user</a></p>

{#if data.users.length === 0}
  <p>No users found.</p>
{:else}
  <div class="table-scroll">
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
        {#each data.users as record}
          <tr>
            <td>{record.email}</td>
            <td>{record.type}</td>
            <td>{new Date(record.createdAt).toLocaleDateString()}</td>
            <td>
              {#if record.email !== data.currentUserEmail}
                <span class="actions">
                  <a href="/users/{encodeURIComponent(record.email)}/edit">Edit</a>
                  <form method="POST" use:enhance>
                    <input type="hidden" name="email" value={record.email} />
                    <button type="submit" class="button mini error">Delete</button>
                  </form>
                </span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

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
