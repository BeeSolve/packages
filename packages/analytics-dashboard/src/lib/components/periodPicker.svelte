<script lang="ts">
  import { parsePeriodKey } from "@beesolve/analytics-processor";

  import type { View } from "#lib/labels.js";

  let {
    view,
    value,
    startKey,
    onchange,
  }: {
    view: View;
    value: string;
    startKey: string;
    onchange: (periodKey: string) => void;
  } = $props();

  const now = new Date();

  const minDate = $derived(parsePeriodKey(startKey));
  const selected = $derived(parsePeriodKey(value));

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  function pad2(input: number): string {
    return input.toString().padStart(2, "0");
  }

  function pad4(input: number): string {
    return input.toString().padStart(4, "0");
  }

  function keyFor(date: Date): string {
    const year = pad4(date.getUTCFullYear());
    const month = pad2(date.getUTCMonth() + 1);
    const day = pad2(date.getUTCDate());
    const hour = pad2(date.getUTCHours());
    if (view === "year") return year;
    if (view === "month") return `${year}-${month}`;
    if (view === "day") return `${year}-${month}-${day}`;
    return `${year}-${month}-${day}-${hour}`;
  }

  function stepMs(): number {
    if (view === "hour") return 60 * 60 * 1000;
    return 24 * 60 * 60 * 1000;
  }

  function clamp(date: Date): Date {
    if (date.getTime() < minDate.getTime()) return new Date(minDate.getTime());
    if (date.getTime() > now.getTime()) return new Date(now.getTime());
    return date;
  }

  function shift(direction: "prev" | "next"): Date {
    const next = new Date(selected.getTime());
    const delta = direction === "next" ? 1 : -1;
    if (view === "hour") {
      next.setUTCHours(next.getUTCHours() + delta);
    } else if (view === "day") {
      next.setUTCDate(next.getUTCDate() + delta);
    } else if (view === "month") {
      next.setUTCMonth(next.getUTCMonth() + delta);
    } else {
      next.setUTCFullYear(next.getUTCFullYear() + delta);
    }
    return next;
  }

  // A step is disabled when the next bucket in that direction would fall
  // outside the [min, now] range for the current grain, so the user can never
  // navigate before the first record or into the future.
  const atStart = $derived(keyFor(selected) <= keyFor(clamp(minDate)));
  const atEnd = $derived(keyFor(selected) >= keyFor(clamp(now)));

  function emit(date: Date): void {
    onchange(keyFor(clamp(date)));
  }

  function goPrev(): void {
    if (atStart) return;
    emit(shift("prev"));
  }

  function goNext(): void {
    if (atEnd) return;
    emit(shift("next"));
  }

  const years = $derived.by(() => {
    const first = minDate.getUTCFullYear();
    const last = now.getUTCFullYear();
    return Array.from({ length: last - first + 1 }, (_unused, index) => first + index);
  });

  function withYear(year: number): Date {
    const next = new Date(selected.getTime());
    next.setUTCFullYear(year);
    return next;
  }

  function withMonth(monthIndex: number): Date {
    const next = new Date(selected.getTime());
    next.setUTCMonth(monthIndex);
    return next;
  }

  function withDay(day: number): Date {
    const next = new Date(selected.getTime());
    next.setUTCDate(day);
    return next;
  }

  function withHour(hour: number): Date {
    const next = new Date(selected.getTime());
    next.setUTCHours(hour);
    return next;
  }

  const daysInSelectedMonth = $derived(
    new Date(
      Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + 1, 0),
    ).getUTCDate(),
  );

  function outOfRange(date: Date): boolean {
    const key = keyFor(date);
    return key < keyFor(clamp(minDate)) || key > keyFor(clamp(now));
  }

  function onYear(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    emit(withYear(Number(target.value)));
  }

  function onMonth(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    emit(withMonth(Number(target.value)));
  }

  function onDay(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    emit(withDay(Number(target.value)));
  }

  function onHour(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    emit(withHour(Number(target.value)));
  }
</script>

<div class="cluster period-picker" role="group" aria-label="Period">
  <button
    type="button"
    class="button mini ghost"
    onclick={goPrev}
    disabled={atStart}
    aria-label="Previous {view}"
  >
    ‹
  </button>

  <select value={String(selected.getUTCFullYear())} onchange={onYear} aria-label="Year">
    {#each years as yearOption (yearOption)}
      <option value={String(yearOption)} disabled={outOfRange(withYear(yearOption))}>
        {yearOption}
      </option>
    {/each}
  </select>

  {#if view !== "year"}
    <select value={String(selected.getUTCMonth())} onchange={onMonth} aria-label="Month">
      {#each monthNames as name, monthIndex (name)}
        <option value={String(monthIndex)} disabled={outOfRange(withMonth(monthIndex))}>
          {name}
        </option>
      {/each}
    </select>
  {/if}

  {#if view === "day" || view === "hour"}
    <select value={String(selected.getUTCDate())} onchange={onDay} aria-label="Day">
      {#each Array.from({ length: daysInSelectedMonth }, (_unused, index) => index + 1) as dayOption (dayOption)}
        <option value={String(dayOption)} disabled={outOfRange(withDay(dayOption))}>
          {dayOption}
        </option>
      {/each}
    </select>
  {/if}

  {#if view === "hour"}
    <select value={String(selected.getUTCHours())} onchange={onHour} aria-label="Hour">
      {#each Array.from({ length: 24 }, (_unused, index) => index) as hourOption (hourOption)}
        <option value={String(hourOption)} disabled={outOfRange(withHour(hourOption))}>
          {pad2(hourOption)}:00
        </option>
      {/each}
    </select>
  {/if}

  <button
    type="button"
    class="button mini ghost"
    onclick={goNext}
    disabled={atEnd}
    aria-label="Next {view}"
  >
    ›
  </button>
</div>

<style>
  .period-picker {
    align-items: center;
    gap: var(--vs-s);
    flex-wrap: nowrap;
  }

  .period-picker select {
    margin: 0;
    min-width: 0;
  }

  .period-picker button[type="button"] {
    margin-block-start: 0;
    flex: 0 0 auto;
  }
</style>
