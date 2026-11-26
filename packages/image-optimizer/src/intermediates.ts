import { S3Client } from "bun";

import { isNotFoundError } from "./source";

export interface IntermediateStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

export interface IntermediateKeyProps {
  sourceKey: string;
  sourceEtag: string;
  bucket: number;
}

/**
 * The ETag is part of the key, so overwriting the original makes older intermediates
 * unreachable. The lifecycle rule of the bucket removes them.
 */
export function intermediateKey(props: IntermediateKeyProps): string {
  const etag = props.sourceEtag.replaceAll('"', "");
  return `v1/${props.sourceKey}/${etag}/${props.bucket}`;
}

export interface BunIntermediateStoreProps {
  bucket: string;
}

export function createBunIntermediateStore(props: BunIntermediateStoreProps): IntermediateStore {
  const client = new S3Client({ bucket: props.bucket });

  return {
    async get(key) {
      try {
        return new Uint8Array(await client.file(key).arrayBuffer());
      } catch (error) {
        if (isNotFoundError(error)) return undefined;
        throw error;
      }
    },
    async put(key, bytes) {
      await client.write(key, bytes, { type: "image/webp" });
    },
  };
}
