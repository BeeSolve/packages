<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    text,
    placement = "top",
    children,
  }: {
    text: string;
    placement?: "top" | "bottom";
    children: Snippet;
  } = $props();

  const uid = $props.id();
  const anchorName = `--tooltip-${uid}`;
  const tipId = `tooltip-${uid}`;

  let popover = $state<HTMLElement | null>(null);

  const supportsPopover =
    typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

  function open(): void {
    if (!supportsPopover) return;
    popover?.showPopover();
  }

  function close(): void {
    if (!supportsPopover) return;
    popover?.hidePopover();
  }
</script>

<button
  type="button"
  class="tooltip-trigger"
  aria-describedby={supportsPopover ? tipId : undefined}
  title={supportsPopover ? undefined : text}
  style="anchor-name: {anchorName}"
  onmouseenter={open}
  onmouseleave={close}
  onfocusin={open}
  onfocusout={close}
>
  {@render children()}
</button>

{#if supportsPopover}
  <div
    bind:this={popover}
    id={tipId}
    popover="manual"
    role="tooltip"
    class="tooltip-tip {placement}"
    style="position-anchor: {anchorName}"
  >
    {text}
  </div>
{/if}

<style>
  .tooltip-trigger {
    display: inline-block;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: inherit;
    cursor: help;
  }

  /* Rendered in the top layer via the Popover API, so it escapes any ancestor
     `overflow` clipping (e.g. the scrollable `.table` wrapper). Styling mirrors
     graffiti's `.tip` surface, built on graffiti tokens. */
  .tooltip-tip {
    position: absolute;
    margin: 0;
    inline-size: max-content;
    max-inline-size: 30ch;
    padding: var(--pad-xs) var(--pad-s);
    background: var(--bg);
    border: var(--border-1);
    border-radius: var(--br-s);
    box-shadow: var(--shadow-3);
    color: var(--fg-1);
    font-size: 0.8rem;
    text-align: center;
    position-area: block-start center;
    margin-block-end: var(--vs-xs);
  }

  .tooltip-tip.bottom {
    position-area: block-end center;
    margin-block-end: 0;
    margin-block-start: var(--vs-xs);
  }

  .tooltip-tip:popover-open {
    overflow: visible;
  }
</style>
