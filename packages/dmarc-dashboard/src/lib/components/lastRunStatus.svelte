<script lang="ts">
  interface LastRun {
    status: "pending" | "started" | "finished" | "failed";
    startedAt: string;
    finishedAt?: string;
    ipsEnriched?: number;
    selectorsChecked?: number;
  }

  let {
    lastRun,
    count,
    unit,
  }: { lastRun: LastRun | undefined; count?: number; unit: string } = $props();
</script>

{#if lastRun != null}
  <span class="last-run">
    {#if lastRun.status === "started" || lastRun.status === "pending"}
      In progress…
    {:else if lastRun.status === "finished"}
      Updated{#if count != null}
        · {count.toLocaleString()}
        {unit}{/if}{#if lastRun.finishedAt != null}
        · {new Date(lastRun.finishedAt).toLocaleDateString()}{/if}
    {:else if lastRun.status === "failed"}
      Last refresh failed
    {/if}
  </span>
{/if}

<style>
  .last-run {
    font-size: 0.8rem;
    color: var(--fg-5);
    white-space: nowrap;
  }
</style>
