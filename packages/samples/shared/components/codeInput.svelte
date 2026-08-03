<script lang="ts">
  interface Props {
    length?: number;
    buttonText?: string;
    disabled?: boolean;
    onsubmit?: (event: SubmitEvent) => void;
  }

  let { length = 6, buttonText = "Verify", disabled = false, onsubmit }: Props = $props();

  let value = $state("");

  function handleInput(event: Event) {
    const input = event.target as HTMLInputElement;
    value = input.value.replace(/[^0-9]/g, "").slice(0, length);
    input.value = value;
  }
</script>

{#if onsubmit}
  <form method="POST" {onsubmit}>
    <label>
      Verification code
      <input
        type="text"
        name="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]*"
        minlength={length}
        maxlength={length}
        required
        {disabled}
        oninput={handleInput}
        value={value}
      />
    </label>
    <button type="submit" {disabled}>{buttonText}</button>
  </form>
{:else}
  <form method="POST">
    <label>
      Verification code
      <input
        type="text"
        name="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]*"
        minlength={length}
        maxlength={length}
        required
        {disabled}
        oninput={handleInput}
        value={value}
      />
    </label>
    <button type="submit" {disabled}>{buttonText}</button>
  </form>
{/if}
