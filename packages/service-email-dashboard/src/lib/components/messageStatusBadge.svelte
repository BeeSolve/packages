<script lang="ts">
  import type { MessageStatus } from "$lib/server/messages";

  // Message lifecycle status (sent/delivered/bounced/complained/rejected/
  // requested), rendered as a small graffiti `.tag` pill. This is distinct
  // from statusBadge.svelte, which renders a numeric rate percentage.
  let { status }: { status: MessageStatus | "requested" } = $props();

  const tone = $derived.by(() => {
    if (status === "delivered") return "success";
    if (status === "bounced" || status === "rejected") return "error";
    if (status === "complained") return "warning";
    return "neutral";
  });
</script>

<span class="tag status-{tone}">{status}</span>

<style>
  .status-success {
    --tag-color: var(--success);
  }

  .status-warning {
    --tag-color: var(--warning);
  }

  .status-error {
    --tag-color: var(--error);
  }

  .status-neutral {
    --tag-color: var(--fg-5);
  }

  .tag {
    padding-inline: var(--pad-m);
  }
</style>
