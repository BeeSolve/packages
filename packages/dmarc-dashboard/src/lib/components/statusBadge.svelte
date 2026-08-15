<script lang="ts">
  let { rate }: { rate: number } = $props();

  const status = $derived(rate >= 95 ? "pass" : rate >= 80 ? "warn" : "fail");
</script>

<span class="badge badge-{status}">{rate}%</span>

<style>
  .badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.8rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .badge-pass {
    background: var(--color-pass-bg, #dcfce7);
    color: var(--color-pass, #166534);
  }

  .badge-warn {
    background: var(--color-warn-bg, #fef9c3);
    color: var(--color-warn, #854d0e);
  }

  .badge-fail {
    background: var(--color-fail-bg, #fee2e2);
    color: var(--color-fail, #991b1b);
  }
</style>
