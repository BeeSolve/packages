<script lang="ts">
  import { enhance } from "$app/forms";
  import { signOut } from "$shared/utils/authClient";

  let { data, form } = $props();

  async function handleStopImpersonating() {
    await fetch("/auth/endImpersonation", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ redirectTo: "/" }),
    });
    location.reload();
  }

  async function handleSignOut() {
    await signOut();
  }
</script>

<h1>Users</h1>

{#if data.identity.impersonating}
  <div class="banner">
    <span>
      Impersonating {data.identity.userId} (as {data.identity.impersonatedBy})
    </span>
    <button type="button" onclick={handleStopImpersonating}>Stop impersonating</button>
  </div>
{/if}

<button type="button" onclick={handleSignOut}>Sign out</button>

{#if form?.error}
  <p class="error">{form.error}</p>
{/if}

{#if data.users.length === 0}
  <p>No users found.</p>
{:else}
  <div class="table">
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Registered</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {#each data.users as record}
          <tr>
            <td>{record.email}</td>
            <td>{new Date(record.createdAt).toLocaleDateString()}</td>
            <td>
              {#if record.userId === data.identity.userId}
                You
              {:else}
                <form method="POST" use:enhance>
                  <input type="hidden" name="targetUserId" value={record.userId} />
                  <button type="submit">Impersonate</button>
                </form>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    margin-block-end: 1rem;
    border: 1px solid currentColor;
    border-radius: 0.5rem;
  }

  .table form {
    display: inline;
    margin: 0;
  }
</style>
