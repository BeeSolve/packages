export function decodeCbor(data: Uint8Array): unknown {
  if (data.length === 0) {
    throw new Error("CBOR: empty input");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const [value] = decodeItem(view, 0, data.byteLength);
  return value;
}

function decodeItem(view: DataView, offset: number, end: number): [unknown, number] {
  if (offset >= end) {
    throw new Error("CBOR: unexpected end of input");
  }

  const initialByte = view.getUint8(offset);
  const majorType = initialByte >> 5;
  const additionalInfo = initialByte & 0x1f;
  offset += 1;

  if (majorType === 0) {
    const [value, nextOffset] = readArgument(view, offset, end, additionalInfo);
    return [value, nextOffset];
  }

  if (majorType === 1) {
    const [value, nextOffset] = readArgument(view, offset, end, additionalInfo);
    return [-1 - Number(value), nextOffset];
  }

  if (majorType === 2) {
    const [length, nextOffset] = readArgument(view, offset, end, additionalInfo);
    const byteLength = Number(length);
    if (nextOffset + byteLength > end) {
      throw new Error("CBOR: byte string length exceeds available data");
    }
    const bytes = new Uint8Array(view.buffer, view.byteOffset + nextOffset, byteLength);
    return [bytes.slice(), nextOffset + byteLength];
  }

  if (majorType === 3) {
    const [length, nextOffset] = readArgument(view, offset, end, additionalInfo);
    const byteLength = Number(length);
    if (nextOffset + byteLength > end) {
      throw new Error("CBOR: text string length exceeds available data");
    }
    const bytes = new Uint8Array(view.buffer, view.byteOffset + nextOffset, byteLength);
    const text = new TextDecoder().decode(bytes);
    return [text, nextOffset + byteLength];
  }

  if (majorType === 4) {
    const [count, nextOffset] = readArgument(view, offset, end, additionalInfo);
    const arrayLength = Number(count);
    const result: Array<unknown> = [];
    let currentOffset = nextOffset;
    for (let index = 0; index < arrayLength; index++) {
      const [item, itemOffset] = decodeItem(view, currentOffset, end);
      result.push(item);
      currentOffset = itemOffset;
    }
    return [result, currentOffset];
  }

  if (majorType === 5) {
    const [count, nextOffset] = readArgument(view, offset, end, additionalInfo);
    const mapSize = Number(count);
    const result = new Map<number | string, unknown>();
    let currentOffset = nextOffset;
    for (let index = 0; index < mapSize; index++) {
      const [key, keyOffset] = decodeItem(view, currentOffset, end);
      const [value, valueOffset] = decodeItem(view, keyOffset, end);
      if (typeof key !== "number" && typeof key !== "string") {
        throw new Error("CBOR: map keys must be integers or text strings");
      }
      result.set(key, value);
      currentOffset = valueOffset;
    }
    return [result, currentOffset];
  }

  if (majorType === 7) {
    if (additionalInfo === 20) {
      return [false, offset];
    }
    if (additionalInfo === 21) {
      return [true, offset];
    }
    if (additionalInfo === 22) {
      return [null, offset];
    }
    throw new Error(`CBOR: unsupported simple value ${additionalInfo}`);
  }

  throw new Error(`CBOR: unsupported major type ${majorType}`);
}

function readArgument(
  view: DataView,
  offset: number,
  end: number,
  additionalInfo: number,
): [number, number] {
  if (additionalInfo < 24) {
    return [additionalInfo, offset];
  }
  if (additionalInfo === 24) {
    if (offset + 1 > end) {
      throw new Error("CBOR: unexpected end of input reading 1-byte argument");
    }
    return [view.getUint8(offset), offset + 1];
  }
  if (additionalInfo === 25) {
    if (offset + 2 > end) {
      throw new Error("CBOR: unexpected end of input reading 2-byte argument");
    }
    return [view.getUint16(offset), offset + 2];
  }
  if (additionalInfo === 26) {
    if (offset + 4 > end) {
      throw new Error("CBOR: unexpected end of input reading 4-byte argument");
    }
    return [view.getUint32(offset), offset + 4];
  }
  if (additionalInfo === 27) {
    if (offset + 8 > end) {
      throw new Error("CBOR: unexpected end of input reading 8-byte argument");
    }
    const high = view.getUint32(offset);
    const low = view.getUint32(offset + 4);
    return [high * 0x100000000 + low, offset + 8];
  }
  throw new Error(`CBOR: unsupported additional info ${additionalInfo}`);
}
