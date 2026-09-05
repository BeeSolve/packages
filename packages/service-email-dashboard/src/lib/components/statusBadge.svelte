<script lang="ts">
  let { rate }: { rate: number } = $props();

  const status = $derived(rate >= 95 ? "pass" : rate >= 80 ? "warn" : "fail");
</script>

<span class="tag status-{status}">{rate}%</span>

<style>
  /* graffiti .tag renders the pill; we only point --tag-color at the right
     semantic token so it derives the correct background/border/text. */
  .status-pass {
    --tag-color: var(--success);
  }

  .status-warn {
    --tag-color: var(--warning);
  }

  .status-fail {
    --tag-color: var(--error);
  }

  .tag {
    font-variant-numeric: tabular-nums;
    padding-inline: var(--pad-m);
  }
</style>
