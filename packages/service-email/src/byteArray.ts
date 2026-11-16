export function toArrayBuffer(byteArray: Uint8Array): ArrayBufferLike {
  return byteArray.slice().buffer;
}
