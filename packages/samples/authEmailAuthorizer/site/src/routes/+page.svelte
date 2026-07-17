<script lang="ts">
  let { data } = $props();
</script>

<h1>Dashboard</h1>
<p>You are signed in. Session: {data.sessionId}</p>
<a href="/sign-out">Sign out</a>
