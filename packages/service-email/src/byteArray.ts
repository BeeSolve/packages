export function toArrayBuffer(byteArray: Uint8Array): ArrayBufferLike {
  return byteArray.buffer.slice(byteArray.byteOffset, byteArray.byteOffset + byteArray.byteLength);
}
