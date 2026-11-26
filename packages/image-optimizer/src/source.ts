import { S3Client } from "bun";

export interface SourceStat {
  etag: string;
  size: number;
  contentType: string;
}

export interface ReadRangeProps {
  key: string;
  length: number;
}

export interface ImageSource {
  /** Returns `undefined` when the object does not exist. */
  stat(key: string): Promise<SourceStat | undefined>;
  /** Reads the first `length` bytes (or the whole object when it is shorter). */
  readRange(props: ReadRangeProps): Promise<Uint8Array>;
  read(key: string): Promise<Uint8Array>;
  stream(key: string): ReadableStream<Uint8Array>;
}

export interface BunImageSourceProps {
  bucket: string;
}

export function createBunImageSource(props: BunImageSourceProps): ImageSource {
  const client = new S3Client({ bucket: props.bucket });

  return {
    async stat(key) {
      try {
        const stat = await client.file(key).stat();
        return { etag: stat.etag, size: stat.size, contentType: stat.type };
      } catch (error) {
        if (isNotFoundError(error)) return undefined;
        throw error;
      }
    },
    async readRange(rangeProps) {
      const buffer = await client.file(rangeProps.key).slice(0, rangeProps.length).arrayBuffer();
      return new Uint8Array(buffer);
    },
    async read(key) {
      return new Uint8Array(await client.file(key).arrayBuffer());
    },
    stream(key) {
      return client.file(key).stream();
    },
  };
}

export function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error == null || !("code" in error)) return false;
  return error.code === "NoSuchKey" || error.code === "NotFound";
}
