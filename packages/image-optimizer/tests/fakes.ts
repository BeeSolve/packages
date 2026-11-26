import type { IntermediateStore } from "../src/intermediates";
import type { ImageSource } from "../src/source";

export interface FakeFile {
  bytes: Uint8Array;
  etag: string;
  contentType: string;
}

export interface FakeSourceStats {
  stat: number;
  readRange: number;
  rangeBytes: number;
  read: number;
  stream: number;
}

export interface FakeSource {
  source: ImageSource;
  files: Record<string, FakeFile>;
  stats: FakeSourceStats;
}

export function createFakeSource(files: Record<string, FakeFile>): FakeSource {
  const stats: FakeSourceStats = { stat: 0, readRange: 0, rangeBytes: 0, read: 0, stream: 0 };

  const source: ImageSource = {
    async stat(key) {
      stats.stat++;
      const file = files[key];
      if (file == null) return undefined;
      return { etag: file.etag, size: file.bytes.length, contentType: file.contentType };
    },
    async readRange(props) {
      stats.readRange++;
      const bytes = files[props.key]?.bytes;
      if (bytes == null) throw new Error(`Missing ${props.key}`);
      const range = bytes.slice(0, props.length);
      stats.rangeBytes += range.length;
      return range;
    },
    async read(key) {
      stats.read++;
      const bytes = files[key]?.bytes;
      if (bytes == null) throw new Error(`Missing ${key}`);
      return bytes.slice();
    },
    stream(key) {
      stats.stream++;
      const bytes = files[key]?.bytes;
      if (bytes == null) throw new Error(`Missing ${key}`);
      return new Response(bytes.slice()).body ?? new ReadableStream<Uint8Array>();
    },
  };
  return { source, files, stats };
}

export interface FakeStore {
  store: IntermediateStore;
  items: Record<string, Uint8Array>;
  stats: { get: number; put: number };
}

export function createFakeStore(): FakeStore {
  const items: Record<string, Uint8Array> = {};
  const stats = { get: 0, put: 0 };

  const store: IntermediateStore = {
    async get(key) {
      stats.get++;
      return items[key];
    },
    async put(key, bytes) {
      stats.put++;
      items[key] = bytes;
    },
  };
  return { store, items, stats };
}
