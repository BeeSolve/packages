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

    <label>
      User type
      <select {...updateUser.fields.type.as("select")} disabled={updateUser.pending > 0}>
        {#each data.userTypes as userType (userType)}
          <option value={userType} selected={data.targetUser.type === userType}>
            {userType}
          </option>
        {/each}
      </select>
    </label>

    <button type="submit" class="button primary" disabled={updateUser.pending > 0}>
      {updateUser.pending > 0 ? "Saving..." : "Save changes"}
    </button>
  </form>
</svelte:boundary>

<p><a href="/users">Back to users</a></p>
