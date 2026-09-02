<script lang="ts">
  let {
    displayMonth,
    currentMonth,
    today,
    selectedDate,
    domain,
  }: {
    displayMonth: string;
    currentMonth: string;
    today: string;
    selectedDate: string | null;
    domain: string;
  } = $props();

  const year = $derived(Number(displayMonth.slice(0, 4)));
  const month = $derived(Number(displayMonth.slice(5, 7)));

  const prevMonth = $derived(() => {
    const date = new Date(Date.UTC(year, month - 2, 1));
    return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });

  const nextMonth = $derived(() => {
    const date = new Date(Date.UTC(year, month, 1));
    return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });

  const atCurrentMonth = $derived(displayMonth >= currentMonth);

  const monthLabel = $derived(
    new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    }),
  );

  const days = $derived(() => {
    const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const cells: Array<{ day: number; date: string; future: boolean } | null> = [];

    for (let index = 0; index < firstDay; index++) {
      cells.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells.push({ day, date, future: date > today });
    }

    return cells;
  });

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
</script>

<div class="calendar">
  <div class="calendar-header">
    <a href="/domains/{domain}?month={prevMonth()}" class="nav-btn" aria-label="Previous month">
      &lsaquo;
    </a>
    <span class="month-label">{monthLabel}</span>
    {#if atCurrentMonth}
      <span class="nav-btn disabled" aria-hidden="true">&rsaquo;</span>
    {:else}
      <a href="/domains/{domain}?month={nextMonth()}" class="nav-btn" aria-label="Next month">
        &rsaquo;
      </a>
    {/if}
  </div>

  <div class="calendar-grid">
    {#each weekdays as weekday}
      <div class="weekday">{weekday}</div>
    {/each}

    {#each days() as cell}
      {#if cell == null}
        <div class="cell empty"></div>
      {:else if cell.future}
        <span class="cell future" aria-disabled="true">{cell.day}</span>
      {:else}
        <a
          href="/domains/{domain}?date={cell.date}"
          class="cell"
          class:selected={selectedDate === cell.date}
          class:today={selectedDate == null && cell.date === today}
        >
          {cell.day}
        </a>
      {/if}
    {/each}
  </div>

  <div class="calendar-footer">
    {#if selectedDate != null}
      <span class="range-label">Showing {selectedDate}</span>
      <a href="/domains/{domain}?month={displayMonth}" class="clear-link">Show all dates</a>
    {:else}
      <span class="range-label">Showing all dates — pick a day to filter</span>
    {/if}
  </div>
</div>

<style>
  /* Gap: graffiti has no calendar/date-picker component, so the grid is
     custom — but built entirely on graffiti design tokens. */
  .calendar {
    border: var(--border-1);
    border-radius: var(--br-l);
    padding: var(--pad-m);
    width: fit-content;
  }

  .calendar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .month-label {
    font-size: 0.875rem;
    font-weight: var(--fw-semibold);
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--br-s);
    font-size: 1.1rem;
    color: var(--fg-7);
    text-decoration: none;
  }

  .nav-btn:hover {
    background: var(--fg-05);
    text-decoration: none;
  }

  .nav-btn.disabled {
    color: var(--fg-2);
    cursor: not-allowed;
  }

  .nav-btn.disabled:hover {
    background: none;
  }

  .calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, 2rem);
    gap: 0.15rem;
  }

  .weekday {
    text-align: center;
    font-size: 0.65rem;
    font-weight: var(--fw-semibold);
    text-transform: uppercase;
    color: var(--fg-5);
    padding-bottom: 0.25rem;
  }

  .cell {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--br-s);
    font-size: 0.8rem;
    color: var(--fg);
    text-decoration: none;
  }

  a.cell:hover {
    background: var(--fg-05);
    text-decoration: none;
  }

  .cell.selected {
    background: var(--primary);
    color: var(--white, #fff);
    font-weight: var(--fw-semibold);
  }

  .cell.today {
    border: 1px solid var(--primary);
    color: var(--primary);
    font-weight: var(--fw-semibold);
  }

  .cell.future {
    color: var(--fg-3);
    cursor: not-allowed;
  }

  .cell.empty {
    pointer-events: none;
  }

  .calendar-footer {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: var(--border-1);
    text-align: center;
    font-size: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .range-label {
    color: var(--fg-5);
  }

  .clear-link {
    color: var(--primary);
    text-decoration: none;
  }

  .clear-link:hover {
    text-decoration: underline;
  }
</style>
