<script lang="ts">
  let { label, value, subtitle }: { label: string; value: string | number; subtitle?: string } =
    $props();
</script>

<div class="stat-card">
  <strong>{value}</strong>
  <small class="stat-label">{label}</small>
  {#if subtitle}
    <small class="stat-subtitle">{subtitle}</small>
  {/if}
</div>

<style>
  /* .stat-card supplies surface, border, radius, padding and the
     strong/small typography. We only tweak the label casing and the
     optional subtitle tone — no graffiti equivalent for those. */
  .stat-label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-subtitle {
    color: var(--fg-5);
    font-weight: var(--fw-normal, 400);
  }
</style>
