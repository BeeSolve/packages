<script lang="ts">
  import { createCooldown } from "$shared/utils/cooldown.svelte";

  interface Props {
    targetTime: string;
  }

  let { targetTime }: Props = $props();

  const cooldown = createCooldown(() => targetTime);
</script>

{#if cooldown.active}
  <span class="countdown">{cooldown.remaining}s</span>
{/if}
