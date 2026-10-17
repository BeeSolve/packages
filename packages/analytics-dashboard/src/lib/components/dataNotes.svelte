<script lang="ts">
  interface Props {
    readonly processingLagHours: number;
    readonly hourlyRetentionDays: number;
  }

  let { processingLagHours, hourlyRetentionDays }: Props = $props();
</script>

<details class="bordered data-notes">
  <summary>About this data</summary>
  <dl>
    <div class="note">
      <dt>Processing lag</dt>
      <dd>
        Data is ~{processingLagHours}h delayed, so the most recent hour(s) are legitimately empty
        until they are processed.
      </dd>
    </div>
    <div class="note">
      <dt>Hourly retention</dt>
      <dd>
        Hourly-grain data is kept for the last {hourlyRetentionDays} days. Older periods are
        available at daily or monthly grain.
      </dd>
    </div>
    <div class="note">
      <dt>Sitemap</dt>
      <dd>Re-fetched once per day, and immediately when the sitemap URL is changed in Settings.</dd>
    </div>
    <div class="note">
      <dt>Watch-forward</dt>
      <dd>
        Watched URLs start collecting from when they are added. There is no retroactive backfill of
        history.
      </dd>
    </div>
    <div class="note">
      <dt>Unique visitors</dt>
      <dd>
        Approximate and computed per period. Not summable across periods, and not available at the
        year grain or per country.
      </dd>
    </div>
    <div class="note">
      <dt>Bucket states</dt>
      <dd>
        Final (sealed, finished and rolled up), In progress (partial, still accumulating), Awaiting
        processing (pending).
      </dd>
    </div>
  </dl>
</details>

<style>
  .data-notes {
    margin-block-start: var(--vs-l);
    font-size: 0.8125rem;
  }

  .data-notes summary {
    font-weight: var(--fw-medium);
  }

  .data-notes dl {
    display: flex;
    flex-direction: column;
    gap: var(--vs-s);
  }

  .data-notes .note {
    display: grid;
    grid-template-columns: minmax(8rem, max-content) 1fr;
    gap: var(--vs-xs, 0.25rem) var(--vs-base);
    align-items: baseline;
  }

  .data-notes dt {
    font-weight: var(--fw-medium);
    color: var(--fg);
  }

  .data-notes dd {
    margin: 0;
    color: var(--fg-7);
    line-height: 1.5;
  }

  @media (max-width: 34rem) {
    .data-notes .note {
      grid-template-columns: 1fr;
      gap: 0;
    }
  }
</style>
