<script lang="ts">
  let {
    label,
    value,
    subtitle,
    warn,
    flagged = false,
  }: {
    label: string;
    value: string | number;
    subtitle?: string;
    warn?: string;
    flagged?: boolean;
  } = $props();
</script>

<div class="stat-card" class:stat-card--flagged={flagged}>
  <strong>{value}</strong>
  <small class="stat-label">{label}</small>
  {#if subtitle}
    <small class="stat-subtitle">{subtitle}</small>
  {/if}
  {#if warn}
    <small class="stat-warn">{warn}</small>
  {/if}
</div>

<style>
  .stat-label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-subtitle {
    color: var(--fg-5);
    font-weight: var(--fw-normal, 400);
  }

  .stat-card--flagged {
    border-color: var(--error);
    background: color-mix(in oklab, var(--error) 8%, var(--bg));
  }

  .stat-warn {
    color: var(--error);
  }
</style>
