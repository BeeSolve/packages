export * from "./src/stringifiable";
export * from "./src/uuid";

// oxlint-disable-next-line beesolve/prefer-props-object
export function assertUnreachable(value: never, message: string = JSON.stringify(value)): never {
  throw Error("An unreachable state reached!\n" + message);
}

export function asNull(): null {
  return null;
}

export function call<T>(fn: () => T): T {
  return fn();
}

export function isNotNil<T>(value: T | null | undefined): value is T {
  return value != null;
}

// oxlint-disable-next-line beesolve/prefer-props-object
export function toggleInArray<T extends string | number>(value: T, array: Array<T>): Array<T> {
  if (array.includes(value)) return array.filter((item) => item !== value);
  return [...array, value];
}

/**
 * Picks only `string` properties in a given T type.
 *
 * @example: Sample usage
 * ```ts
 *    type Result = PickStringProps<{ a: string, b: number }>
 *
 *    Result === { a: string }
 * ```
 */
export type PickStringProps<T> = Pick<
  T,
  { [P in keyof T]: T[P] extends string ? P : never }[keyof T]
>;

/**
 * Create new record from an array based on either a selected `string` property or a key selector function.
 *
 * @example Sample usage
 * ```ts
 *    const result = toRecordByProperty(
 *        [
 *            { id: '123', name: 'Jozko' },
 *            { id: '234', name: 'Ferko' }
 *        ],
 *        'id'
 *    );
 *
 *    result === {
 *        '123': { id: '123', name: 'Jozko' },
 *        '234': { id: '234', name: 'Ferko' }
 *    }
 * ```
 *
 * @example Use key selector function
 * ```ts
 *    const result = toRecordByProperty(
 *        [
 *            { groupId: 'g-123', userId: 'u-123', role: 'admin' },
 *            { groupId: 'g-123', userId: 'u-234', role: 'reader' }
 *        ],
 *        value => `${value.groupId}|${value.userId}`
 *    );
 *
 *    result === {
 *        'g-123|u-123': { groupId: 'g-123', userId: 'u-123', role: 'admin' },
 *        'g-123|u-234': { groupId: 'g-123', userId: 'u-234', role: 'reader' }
 *    }
 * ```
 *
 * @example Use string transformations on key
 * ```ts
 *    const result = toRecordByProperty(
 *        [
 *            { id: '123', name: 'Jozko Maly' },
 *            { id: '234', name: 'Ferko Velky' }
 *        ],
 *        'name',
 *        key => key.replaceAll(' ', '_').toLowerCase()
 *    );
 *
 *    result === {
 *        'jozko_maly': { id: '123', name: 'Jozko Maly' },
 *        'ferko_velky': { id: '234', name: 'Ferko Velky' }
 *    }
 * ```
 *
 * When needed the object can be converted back to an array by calling Object.values(object).
 */
// oxlint-disable-next-line beesolve/prefer-props-object typescript/no-explicit-any
export function toRecordByProperty<T extends { [key: string]: any }>(
  input: Array<T>,
  key: keyof PickStringProps<T> | ((value: T) => string),
  keyTransformer: (key: string) => string = (key) => key,
): Record<string, T> {
  return Object.fromEntries(
    input.map((item) => [keyTransformer(typeof key === "function" ? key(item) : item[key]), item]),
  );
}

/**
 * Split array to chunks of chunkSize
 *
 * May be used for batch actions which have limit for instance in DynamoDB
 */
// oxlint-disable-next-line beesolve/prefer-props-object
export function splitArrayToChunks<T>(data: Array<T>, chunkSize = 100): Array<Array<T>> {
  const result: Array<Array<T>> = [];
  const count = Math.ceil(data.length / chunkSize);
  let start = 0;
  let end = chunkSize;
  for (let i = 0; i < count; i++) {
    result.push(data.slice(start, end));
    start += chunkSize;
    end += chunkSize;
  }

  return result;
}

export function delay(delayInMilliseconds: number = 500): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayInMilliseconds);
  });
}

// oxlint-disable-next-line beesolve/prefer-props-object
export function capitalizeFirstLetter(
  [first = "", ...rest]: string,
  locale: Intl.LocalesArgument = "en",
): string {
  return [first.toLocaleUpperCase(locale), ...rest].join("");
}

export function stableJsonStringify<T extends Record<string, unknown>>(value: T): string {
  return JSON.stringify(sortObjectKeysRecursively(value));
}

export function sortObjectKeysRecursively<T>(value: T): T {
  if (Array.isArray(value)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return value.map(sortObjectKeysRecursively) as T;
  }
  if (value != null && typeof value === "object") {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        .map((key) => [key, sortObjectKeysRecursively((value as Record<string, unknown>)[key])]),
    ) as T;
  }
  return value;
}
