<script lang="ts">
  let {
    currentMonth,
    selectedDate,
    domain,
  }: { currentMonth: string; selectedDate: string | null; domain: string } = $props();

  const year = $derived(Number(currentMonth.slice(0, 4)));
  const month = $derived(Number(currentMonth.slice(5, 7)));

  const prevMonth = $derived(() => {
    const d = new Date(year, month - 2, 1);
    return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const nextMonth = $derived(() => {
    const d = new Date(year, month, 1);
    return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const monthLabel = $derived(
    new Date(year, month - 1, 1).toLocaleDateString("en-US", { year: "numeric", month: "long" }),
  );

  const days = $derived(() => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();

    const cells: Array<{ day: number; date: string } | null> = [];

    for (let i = 0; i < firstDay; i++) {
      cells.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells.push({ day, date });
    }

    return cells;
  });

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
</script>

<div class="calendar">
  <div class="calendar-header">
    <a href="/domains/{domain}?month={prevMonth()}" class="nav-btn">&lsaquo;</a>
    <span class="month-label">{monthLabel}</span>
    <a href="/domains/{domain}?month={nextMonth()}" class="nav-btn">&rsaquo;</a>
  </div>

  <div class="calendar-grid">
    {#each weekdays as weekday}
      <div class="weekday">{weekday}</div>
    {/each}

    {#each days() as cell}
      {#if cell == null}
        <div class="cell empty"></div>
      {:else}
        <a
          href="/domains/{domain}?date={cell.date}"
          class="cell"
          class:selected={selectedDate === cell.date}
        >
          {cell.day}
        </a>
      {/if}
    {/each}
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

  .cell:hover:not(.empty) {
    background: var(--surface-1, #f8f9fa);
    text-decoration: none;
  }

  .cell.selected {
    background: #2563eb;
    color: #fff;
    font-weight: 600;
  }

  .cell.empty {
    pointer-events: none;
  }
</style>
