<script lang="ts">
  interface Props {
    label?: string;
    buttonText?: string;
    disabled?: boolean;
    onsubmit?: (event: SubmitEvent) => void;
  }

  let { label = "Email address", buttonText = "Continue", disabled = false, onsubmit }: Props = $props();
</script>

{#if onsubmit}
  <form method="POST" {onsubmit}>
    <label>
      {label}
      <input type="email" name="email" required autocomplete="email" {disabled} />
    </label>
    <button type="submit" {disabled}>{buttonText}</button>
  </form>
{:else}
  <form method="POST">
    <label>
      {label}
      <input type="email" name="email" required autocomplete="email" {disabled} />
    </label>
    <button type="submit" {disabled}>{buttonText}</button>
  </form>
{/if}
