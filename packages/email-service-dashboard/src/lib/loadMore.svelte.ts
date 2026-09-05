import { page } from "$app/state";

/**
 * Load-more pagination accumulator (SSR-first, explicit click, no scroll-fetch).
 *
 * Each `+page.server.ts` load returns one page of `items` plus an optional
 * `cursor`. A "Load more" link navigates to the same URL with `?cursor=<cursor>`;
 * when that param is present the incoming page is the *next* page and is
 * appended, otherwise (fresh visit / month change / filter reset) it replaces
 * the list.
 *
 * The accumulation is derived, not synced via `$effect`: `$derived.by` recomputes
 * `items` from the current `page.data` and the running accumulator whenever the
 * SvelteKit page store changes, so there is no state-syncing side effect.
 *
 * Usage:
 * ```svelte
 * const paginator = createLoadMore(() => data.items, () => data.cursor);
 * // paginator.items — accumulated list
 * // paginator.loadMoreHref — string | null (null hides the button)
 * ```
 */
export function createLoadMore<Item>(
  getPageItems: () => ReadonlyArray<Item>,
  getCursor: () => string | undefined,
  extraParams: () => Record<string, string> = () => ({}),
): {
  readonly items: ReadonlyArray<Item>;
  readonly loadMoreHref: string | null;
} {
  // Accumulated pages that precede the current one. Rebuilt entirely from the
  // page store on every navigation, so nothing needs to be mutated in an effect.
  let accumulated: Array<Item> = [];
  let lastKey: string | null = null;

  const items = $derived.by(() => {
    const hasCursor = page.url.searchParams.get("cursor") != null;
    // A key that changes when the *base* query (everything except cursor) changes,
    // so switching month/filter resets the accumulation.
    const params = new URLSearchParams(page.url.searchParams);
    params.delete("cursor");
    const baseKey = `${page.url.pathname}?${params.toString()}`;
    const pageItems = getPageItems();

    if (!hasCursor || baseKey !== lastKey) {
      accumulated = [];
      lastKey = baseKey;
      return [...pageItems];
    }

    accumulated = [...accumulated, ...pageItems];
    return accumulated;
  });

  const loadMoreHref = $derived.by(() => {
    const cursor = getCursor();
    if (cursor == null) return null;
    const params = new URLSearchParams(page.url.searchParams);
    for (const [key, value] of Object.entries(extraParams())) {
      params.set(key, value);
    }
    params.set("cursor", cursor);
    return `${page.url.pathname}?${params.toString()}`;
  });

  return {
    get items() {
      return items;
    },
    get loadMoreHref() {
      return loadMoreHref;
    },
  };
}
