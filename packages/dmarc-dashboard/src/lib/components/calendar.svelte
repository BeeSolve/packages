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
  .calendar {
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 0.5rem;
    padding: 0.75rem;
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
    font-weight: 600;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.25rem;
    font-size: 1.1rem;
    color: var(--text-2, #64748b);
    text-decoration: none;
  }

  .nav-btn:hover {
    background: var(--surface-1, #f8f9fa);
    text-decoration: none;
  }

  .nav-btn.disabled {
    color: var(--border, #e2e8f0);
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
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-3, #94a3b8);
    padding-bottom: 0.25rem;
  }

  .cell {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.25rem;
    font-size: 0.8rem;
    color: var(--text-1, #1a202c);
    text-decoration: none;
  }

  a.cell:hover {
    background: var(--surface-1, #f8f9fa);
    text-decoration: none;
  }

  .cell.selected {
    background: #2563eb;
    color: #fff;
    font-weight: 600;
  }

  .cell.today {
    border: 1px solid #2563eb;
    color: #2563eb;
    font-weight: 600;
  }

  .cell.future {
    color: var(--text-3, #cbd5e1);
    cursor: not-allowed;
  }

  .cell.empty {
    pointer-events: none;
  }

  .calendar-footer {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border, #e2e8f0);
    text-align: center;
    font-size: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .range-label {
    color: var(--text-3, #94a3b8);
  }

  .clear-link {
    color: #2563eb;
    text-decoration: none;
  }

  .clear-link:hover {
    text-decoration: underline;
  }
</style>
