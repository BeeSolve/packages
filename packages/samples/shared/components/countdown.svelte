<script lang="ts">
  import { onDestroy } from "svelte";

  interface Props {
    seconds: number;
    onComplete?: () => void;
  }

  let { seconds, onComplete }: Props = $props();

  let remaining = $state(seconds);

  const interval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(interval);
      onComplete?.();
    }
  }, 1000);

  onDestroy(() => clearInterval(interval));
</script>

{#if remaining > 0}
  <span class="countdown">{remaining}s</span>
{/if}
