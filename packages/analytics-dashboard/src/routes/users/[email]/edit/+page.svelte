<script lang="ts">
  import { page } from "$app/state";

  import { getEditUser, updateUser } from "#lib/remote/users.remote.js";

  const email = $derived(decodeURIComponent(page.params.email ?? ""));
</script>

<h1>Edit User</h1>

<svelte:boundary>
  {#snippet pending()}
    <p>Loading…</p>
  {/snippet}

  {@const data = await getEditUser({ email })}

  <p>Editing <strong>{data.targetUser.email}</strong></p>

  {#each updateUser.fields.allIssues() ?? [] as issue (issue.message)}
    <p class="error">{issue.message}</p>
  {/each}

  <form {...updateUser}>
    <input {...updateUser.fields.email.as("hidden", data.targetUser.email)} />

    <fieldset>
      <legend>Role</legend>
      {#each data.userTypes as userType (userType)}
        <label>
          <input
            {...updateUser.fields.type.as("radio", userType)}
            checked={data.targetUser.type === userType}
          />
          {userType}
        </label>
      {/each}
    </fieldset>

    <button type="submit" class="button primary" disabled={updateUser.pending > 0}>
      {updateUser.pending > 0 ? "Saving..." : "Save changes"}
    </button>
  </form>
</svelte:boundary>

<p><a href="/users">Back to users</a></p>
