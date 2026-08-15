<script lang="ts">
  let { label, value, subtitle }: { label: string; value: string | number; subtitle?: string } =
    $props();
</script>

<div class="summary-card">
  <span class="summary-card-value">{value}</span>
  <span class="summary-card-label">{label}</span>
  {#if subtitle}
    <span class="summary-card-subtitle">{subtitle}</span>
  {/if}
</div>

<style>
  .summary-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1.25rem 1.5rem;
    border-radius: 0.5rem;
    background: var(--surface-1, #f8f9fa);
    border: 1px solid var(--border, #e2e8f0);
    min-width: 140px;
  }

  .summary-card-value {
    font-size: 1.75rem;
    font-weight: 700;
    line-height: 1;
    color: var(--text-1, #1a202c);
  }

  .summary-card-label {
    font-size: 0.8rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2, #64748b);
  }

  .summary-card-subtitle {
    font-size: 0.8rem;
    color: var(--text-3, #94a3b8);
  }
</style>
