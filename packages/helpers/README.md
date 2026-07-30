# @beesolve/helpers

Shared TypeScript utilities used across `@beesolve/*` packages.

## Installation

```bash
npm install @beesolve/helpers
```

## Utilities

### `uuid7` / `uuid7ToDate`

UUIDv7 generator with base36 encoding. Sortable by creation time, 24 characters long, case-insensitive safe.

```ts
import { uuid7, uuid7ToDate } from "@beesolve/helpers";

const id = uuid7(); // "0j3k7m2p4q8r1s5t6u9v0w3x"
const date = uuid7ToDate(id); // Date when the UUID was created
```

### `encodeToStringifiable` / `decodeFromStringifiable`

Encode complex JavaScript values (Date, BigInt, Buffer, Infinity, NaN, FormData) into JSON-safe objects and decode them back. Useful for serializing rich types over JSON boundaries.

```ts
import { encodeToStringifiable, decodeFromStringifiable } from "@beesolve/helpers";

const encoded = encodeToStringifiable({ createdAt: new Date(), count: 42n });
const json = JSON.stringify(encoded);

const decoded = decodeFromStringifiable(JSON.parse(json));
// decoded.createdAt is a Date, decoded.count is a BigInt
```

### `base36Encode` / `base36Decode`

Low-level base36 encoding/decoding for `Uint8Array` data.

```ts
import { base36Encode, base36Decode } from "@beesolve/helpers";

const encoded = base36Encode(new Uint8Array([0xff, 0x00]));
const decoded = base36Decode(encoded);
```

### General utilities

```ts
import {
  assertUnreachable,
  isNotNil,
  toRecordByProperty,
  splitArrayToChunks,
  toggleInArray,
  delay,
  capitalizeFirstLetter,
} from "@beesolve/helpers";
```

| Function                          | Description                                                           |
| --------------------------------- | --------------------------------------------------------------------- |
| `assertUnreachable(value: never)` | Exhaustive check for switch/union narrowing                           |
| `isNotNil(value)`                 | Type guard — filters out `null` and `undefined`                       |
| `toRecordByProperty(array, key)`  | Convert an array to a keyed `Record` by property or selector function |
| `splitArrayToChunks(array, size)` | Split array into chunks (useful for DynamoDB batch limits)            |
| `toggleInArray(value, array)`     | Add or remove a value from an array                                   |
| `delay(ms)`                       | Promise-based delay                                                   |
| `capitalizeFirstLetter(str)`      | Capitalize the first letter of a string                               |

### Bun utilities

```ts
import { parseArgs } from "@beesolve/helpers/bun";
```

Parses CLI arguments using Bun's `util.parseArgs` and validates them with a Valibot schema.

## License

[MIT](../../LICENSE)
