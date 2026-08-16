<script lang="ts">
  import { browser } from "$app/environment";
  import { signOut } from "$shared/utils/authClient";
  import { registerPasskey } from "$shared/utils/passkeyClient";

  let { data } = $props();

  let passkeyMessage = $state("");
  let passkeyError = $state("");
  let loading = $state(false);
  let passkeySupported = $state(false);

  if (browser) {
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then((available) => {
      passkeySupported = available;
    });
  }

  async function handleSignOut() {
    await signOut();
  }

  async function handleRegisterPasskey() {
    passkeyMessage = "";
    passkeyError = "";
    loading = true;

    try {
      const result = await registerPasskey();
      passkeyMessage = `Passkey registered! Credential ID: ${result.credentialId}`;
    } catch (error) {
      passkeyError = error instanceof Error ? error.message : "Failed to register passkey.";
    } finally {
      loading = false;
    }
  }
</script>

<h1>Dashboard</h1>
<p>You are signed in. Session: {data.sessionId}</p>

{#if passkeySupported}
  <button onclick={handleRegisterPasskey} disabled={loading}>
    {loading ? "Registering..." : "Register a passkey"}
  </button>

  {#if passkeyMessage}
    <p class="success">{passkeyMessage}</p>
  {/if}

  {#if passkeyError}
    <p class="error">{passkeyError}</p>
  {/if}
{/if}

<!-- For apps that want to show/manage credentials, use getPasskeysByUserId from the auth service SDK -->

<hr />
<button onclick={handleSignOut}>Sign out</button>
