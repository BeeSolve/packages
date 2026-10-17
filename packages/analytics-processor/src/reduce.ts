export interface BreakdownRow {
  readonly value: string;
  readonly hits: number;
  readonly bytes: number;
}

export interface SummedTotals {
  readonly hits: number;
  readonly success: number;
  readonly errors: number;
  readonly errors4xx: number;
  readonly errors5xx: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheErrors: number;
}

export function sumTotals(items: Array<SummedTotals>): SummedTotals {
  const summed: SummedTotals = {
    hits: 0,
    success: 0,
    errors: 0,
    errors4xx: 0,
    errors5xx: 0,
    bytesSent: 0,
    bytesReceived: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheErrors: 0,
  };

  return items.reduce<SummedTotals>(
    (accumulator, item) => ({
      hits: accumulator.hits + item.hits,
      success: accumulator.success + item.success,
      errors: accumulator.errors + item.errors,
      errors4xx: accumulator.errors4xx + item.errors4xx,
      errors5xx: accumulator.errors5xx + item.errors5xx,
      bytesSent: accumulator.bytesSent + item.bytesSent,
      bytesReceived: accumulator.bytesReceived + item.bytesReceived,
      cacheHits: accumulator.cacheHits + item.cacheHits,
      cacheMisses: accumulator.cacheMisses + item.cacheMisses,
      cacheErrors: accumulator.cacheErrors + item.cacheErrors,
    }),
    summed,
  );
}

export function sumBreakdown(items: Array<BreakdownRow>): Array<BreakdownRow> {
  const byValue: Record<string, BreakdownRow> = {};

  for (const item of items) {
    const existing = byValue[item.value];
    if (existing == null) {
      byValue[item.value] = { value: item.value, hits: item.hits, bytes: item.bytes };
    } else {
      byValue[item.value] = {
        value: item.value,
        hits: existing.hits + item.hits,
        bytes: existing.bytes + item.bytes,
      };
    }
  }

  return Object.values(byValue);
}
