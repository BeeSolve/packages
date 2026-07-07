<script lang="ts">
  interface Props {
    label?: string;
    buttonText?: string;
    disabled?: boolean;
  }

  let { label = "Email address", buttonText = "Continue", disabled = false }: Props = $props();
</script>

<form method="POST">
  <label>
    {label}
    <input type="email" name="email" required autocomplete="email" {disabled} />
  </label>
  <button type="submit" {disabled}>{buttonText}</button>
</form>
