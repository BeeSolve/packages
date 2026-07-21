<script lang="ts">
  import { enhance } from "$app/forms";

  let { form } = $props();
</script>

<h1>Contact us</h1>

{#if form?.error}
  <p class="error">{form.error}</p>
{/if}

<form method="POST" use:enhance>
  <label>
    Name
    <input type="text" name="name" required value={form?.name ?? ""} />
  </label>

  <label>
    Email
    <input type="email" name="email" required autocomplete="email" value={form?.email ?? ""} />
  </label>

  <label>
    Subject
    <input type="text" name="subject" required value={form?.subject ?? ""} />
  </label>

  <label>
    Message
    <textarea name="message" required minlength={10}>{form?.message ?? ""}</textarea>
  </label>

  <button type="submit">Send message</button>
</form>
