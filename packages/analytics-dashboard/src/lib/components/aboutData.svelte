<script lang="ts">
  interface Props {
    readonly processingLagHours: number;
    readonly hourlyRetentionDays: number;
    readonly notes?: ReadonlyArray<NoteKey>;
  }

  export type NoteKey =
    | "processingLag"
    | "hourlyRetention"
    | "sitemap"
    | "watchForward"
    | "uniqueVisitors"
    | "bucketStates";

  let {
    processingLagHours,
    hourlyRetentionDays,
    notes = ["processingLag", "hourlyRetention", "sitemap", "watchForward", "uniqueVisitors", "bucketStates"],
  }: Props = $props();

  const uid = $props.id();
  const popoverId = `about-data-${uid}`;

  const copy = $derived<Record<NoteKey, { term: string; detail: string }>>({
    processingLag: {
      term: "Processing lag",
      detail: `Data is ~${processingLagHours}h delayed, so the most recent hour(s) are legitimately empty until they are processed.`,
    },
    hourlyRetention: {
      term: "Hourly retention",
      detail: `Hourly-grain data is kept for the last ${hourlyRetentionDays} days. Older periods are available at daily or monthly grain.`,
    },
    sitemap: {
      term: "Sitemap",
      detail: "Re-fetched once per day, and immediately when the sitemap URL is changed in Settings.",
    },
    watchForward: {
      term: "Watch-forward",
      detail: "Watched URLs start collecting from when they are added. There is no retroactive backfill of history.",
    },
    uniqueVisitors: {
      term: "Unique visitors",
      detail: "Approximate and computed per period. Not summable across periods, and not available at the year grain or per country.",
    },
    bucketStates: {
      term: "Bucket states",
      detail: "Final (sealed, finished and rolled up), In progress (partial, still accumulating), Awaiting processing (pending).",
    },
  });

  const visibleNotes = $derived(notes.map((key) => ({ key, ...copy[key] })));
</script>

<button type="button" class="chip mini about-trigger" popovertarget={popoverId}>
  <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" />
    <circle cx="8" cy="4.5" r="0.9" fill="currentColor" />
    <path d="M8 7v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>
  About this data
</button>

<div id={popoverId} popover="auto" class="about-popover bordered">
  <div class="cluster about-head">
    <strong>About this data</strong>
    <button type="button" class="button mini ghost" popovertarget={popoverId} popovertargetaction="hide">
      Close
    </button>
  </div>
  <dl>
    {#each visibleNotes as note (note.key)}
      <div class="note">
        <dt>{note.term}</dt>
        <dd>{note.detail}</dd>
      </div>
    {/each}
  </dl>
</div>

<style>
  .about-trigger svg {
    color: var(--fg-5);
  }

  .about-popover {
    max-inline-size: 36rem;
    inline-size: calc(100vw - 2rem);
    margin: auto;
    padding: var(--pad-l);
    border-radius: var(--br-m);
    background: var(--bg);
    box-shadow: var(--shadow-4);
    font-size: 0.8125rem;
  }

  .about-popover::backdrop {
    background: rgba(0, 0, 0, 0.35);
  }

  .about-head {
    justify-content: space-between;
    align-items: center;
    margin-block-end: var(--vs-base);
  }

  .about-head strong {
    font-size: 0.95rem;
  }

  .about-head button {
    margin-block-start: 0;
  }

  .about-popover dl {
    display: flex;
    flex-direction: column;
    gap: var(--vs-s);
    margin: 0;
  }

  .about-popover .note {
    display: grid;
    grid-template-columns: minmax(8rem, max-content) 1fr;
    gap: var(--vs-xs, 0.25rem) var(--vs-base);
    align-items: baseline;
  }

  .about-popover dt {
    font-weight: var(--fw-medium);
    color: var(--fg);
  }

  .about-popover dd {
    margin: 0;
    color: var(--fg-7);
    line-height: 1.5;
  }

  @media (max-width: 34rem) {
    .about-popover .note {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }
</style>
