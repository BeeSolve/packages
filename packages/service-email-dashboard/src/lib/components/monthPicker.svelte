<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  let {
    year,
    month,
    startDate,
  }: { year: number; month: number; startDate: string } = $props();

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const startBound = $derived.by(() => {
    const parsed = new Date(startDate);
    return { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1 };
  });
  const startYear = $derived(startBound.year);
  const startMonth = $derived(startBound.month);

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const years = $derived(
    Array.from({ length: currentYear - startYear + 1 }, (_unused, index) => startYear + index),
  );

  // A year+month combination is in the future when it is strictly after the
  // current calendar month; those combinations must never be selectable.
  function isFuture(candidateYear: number, candidateMonth: number): boolean {
    if (candidateYear > currentYear) return true;
    if (candidateYear === currentYear && candidateMonth > currentMonth) return true;
    return false;
  }

  function isBefore(candidateYear: number, candidateMonth: number): boolean {
    if (candidateYear < startYear) return true;
    if (candidateYear === startYear && candidateMonth < startMonth) return true;
    return false;
  }

  const atCurrentMonth = $derived(year === currentYear && month === currentMonth);
  const atStartMonth = $derived(year === startYear && month === startMonth);

  function navigate(nextYear: number, nextMonth: number): void {
    if (isFuture(nextYear, nextMonth)) return;
    if (isBefore(nextYear, nextMonth)) return;

    // Preserve existing query params, reset pagination cursor, and set the
    // selected year/month.
    const params = new URLSearchParams(page.url.searchParams);
    params.set("year", String(nextYear));
    params.set("month", String(nextMonth));
    params.delete("cursor");

    void goto(`${page.url.pathname}?${params.toString()}`);
  }

  function goPrevious(): void {
    if (month === 1) {
      navigate(year - 1, 12);
      return;
    }
    navigate(year, month - 1);
  }

  function goNext(): void {
    if (month === 12) {
      navigate(year + 1, 1);
      return;
    }
    navigate(year, month + 1);
  }

  function onYearChange(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    navigate(Number(target.value), month);
  }

  function onMonthChange(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    navigate(year, Number(target.value));
  }
</script>

<div class="month-picker">
  <button
    type="button"
    class="button mini ghost"
    onclick={goPrevious}
    disabled={atStartMonth}
    aria-label="Previous month"
  >
    ‹
  </button>

  <select value={String(year)} onchange={onYearChange} aria-label="Year">
    {#each years as yearOption}
      <option value={String(yearOption)} disabled={isBefore(yearOption, month) || isFuture(yearOption, month)}>
        {yearOption}
      </option>
    {/each}
  </select>

  <select value={String(month)} onchange={onMonthChange} aria-label="Month">
    {#each monthNames as name, index}
      <option value={String(index + 1)} disabled={isBefore(year, index + 1) || isFuture(year, index + 1)}>
        {name}
      </option>
    {/each}
  </select>

  <button
    type="button"
    class="button mini ghost"
    onclick={goNext}
    disabled={atCurrentMonth}
    aria-label="Next month"
  >
    ›
  </button>
</div>

<style>
  .month-picker {
    display: flex;
    align-items: center;
    gap: var(--vs-s);
    flex-wrap: wrap;
  }

  .month-picker select {
    margin: 0;
  }

  .month-picker button[type="button"] {
    margin-block-start: 0;
  }
</style>
