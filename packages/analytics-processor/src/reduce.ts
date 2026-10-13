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

export function topNWithOther({
  items,
  n,
  otherValue,
}: {
  items: Array<BreakdownRow>;
  n: number;
  otherValue: string;
}): Array<BreakdownRow> {
  const sorted = [...items].sort((left, right) => right.hits - left.hits);
  const top = sorted.slice(0, n);
  const remainder = sorted.slice(n);

  if (remainder.length === 0) return top;

  const other = remainder.reduce<BreakdownRow>(
    (accumulator, item) => ({
      value: otherValue,
      hits: accumulator.hits + item.hits,
      bytes: accumulator.bytes + item.bytes,
    }),
    { value: otherValue, hits: 0, bytes: 0 },
  );

  return [...top, other];
}
